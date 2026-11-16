import { withTimeout } from "../core/http.js";
import { errorForStatus, GroundingError } from "./errors.js";
import type { GroundingRequest, GroundingTransportName, TransportAttempt } from "./types.js";

/** Per-request ceiling; the caller's signal bounds the whole chain. */
export const ATTEMPT_TIMEOUT_MS = 45_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;

/** Dependencies a transport needs; matches the SDK source context. */
export type GroundingContext = {
  http: { fetch: typeof fetch };
  secrets: { resolve(name: string, signal?: AbortSignal): Promise<string | null> };
  allowLocalAuth?: boolean;
};

export type TransportResponse = {
  data: unknown;
  model: string;
  attempts: TransportAttempt[];
};

export interface GroundingTransport {
  readonly name: GroundingTransportName;
  /** Local check for credentials. Must not make a network request. */
  available(ctx: GroundingContext, signal?: AbortSignal): Promise<boolean>;
  generate(request: GroundingRequest, ctx: GroundingContext): Promise<TransportResponse>;
}

/** Models that returned 429, per quota identity, so later calls skip them until the window passes. */
const cooldowns = new Map<string, number>();

export function clearCooldowns(): void {
  cooldowns.clear();
}

function host(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

const RETIRED_MODEL = /is no longer available\. Please switch/i;

function retiredModelText(data: unknown): string | undefined {
  const root = typeof data === "object" && data !== null && "response" in data ? (data as { response: unknown }).response : data;
  const text = (root as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> } | undefined)
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" && RETIRED_MODEL.test(text) ? text.slice(0, 160) : undefined;
}

export type ChainOptions = {
  transport: GroundingTransportName;
  /**
   * Non-secret identity of the quota a request draws on (e.g. a project ID or a key hash).
   * Cooldowns apply only within it, so one account's 429 never blocks another account.
   */
  quotaKey: string;
  models: readonly string[];
  endpoints: readonly string[];
  signal?: AbortSignal;
  send: (model: string, endpoint: string, signal: AbortSignal) => Promise<Response>;
  now?: () => number;
};

/**
 * Try models in order and endpoints within each model.
 * - 401/403 and malformed requests stop the chain: retrying cannot help.
 * - 429 cools the model down and moves to the next model.
 * - 404, retired models, 5xx, and network errors move on.
 */
export async function sendWithFallbacks(options: ChainOptions): Promise<TransportResponse> {
  const now = options.now ?? Date.now;
  const attempts: TransportAttempt[] = [];
  let last: GroundingError | undefined;
  const fail = (error: GroundingError, model: string | undefined, endpoint: string | undefined, startedAt: number) => {
    last = error;
    attempts.push({
      transport: options.transport, ...(model ? { model } : {}), ...(endpoint ? { endpoint: host(endpoint) } : {}), status: "failed",
      code: error.code, ...(error.details.httpStatus ? { httpStatus: error.details.httpStatus } : {}), message: error.message, durationMs: now() - startedAt
    });
  };

  models: for (const model of options.models) {
    const key = `${options.transport}:${options.quotaKey}:${model}`;
    const until = cooldowns.get(key);
    if (until !== undefined && until > now()) {
      fail(new GroundingError("quota_exhausted", `${model} is cooling down after a quota error`, { retryAfterMs: until - now() }), model, undefined, now());
      continue;
    }
    for (const endpoint of options.endpoints) {
      options.signal?.throwIfAborted();
      const startedAt = now();
      let response: Response;
      try {
        response = await options.send(model, endpoint, withTimeout(options.signal, ATTEMPT_TIMEOUT_MS));
      } catch (error) {
        options.signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        fail(new GroundingError("upstream_unavailable", `Request failed: ${message.slice(0, 200)}`), model, endpoint, startedAt);
        continue;
      }
      if (!response.ok) {
        const error = errorForStatus(response.status, await response.text().catch(() => ""), response.headers.get("retry-after"));
        fail(error, model, endpoint, startedAt);
        if (error.code === "auth_rejected" || error.code === "unsupported_request") throw error.withAttempts(attempts);
        if (error.code === "quota_exhausted") {
          cooldowns.set(key, now() + Math.min(error.details.retryAfterMs ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS));
          continue models;
        }
        if (error.code === "model_unavailable" && error.details.httpStatus !== 404) continue models;
        continue;
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        options.signal?.throwIfAborted();
        fail(new GroundingError("invalid_response", "Response was not JSON"), model, endpoint, startedAt);
        continue;
      }
      const retired = retiredModelText(data);
      if (retired) {
        fail(new GroundingError("model_unavailable", retired), model, endpoint, startedAt);
        continue models;
      }
      attempts.push({ transport: options.transport, model, endpoint: host(endpoint), status: "success", durationMs: now() - startedAt });
      return { data, model, attempts };
    }
  }
  throw (last ?? new GroundingError("upstream_unavailable", `No ${options.transport} model or endpoint is configured`)).withAttempts(attempts);
}
