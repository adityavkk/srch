import { randomUUID } from "node:crypto";
import {
  defaultAuthDeps,
  hasAntigravityCredential,
  resolveAntigravityCredential,
  type AntigravityAuthDeps,
  type AntigravityCredential
} from "./antigravity-auth.js";
import { GroundingError, isGroundingError } from "./errors.js";
import { buildGenerateContentBody } from "./request.js";
import { sendWithFallbacks, type GroundingTransport, type TransportResponse } from "./transport.js";
import type { GroundingRequest } from "./types.js";

/** Fast grounding models first; later entries cover capacity limits and retirements. */
export const ANTIGRAVITY_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash"] as const;

/** Used only when pi-antigravity cannot be loaded; the installed package supplies current values. */
export const FALLBACK_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
] as const;
export const FALLBACK_USER_AGENT = "antigravity/cli/1.4.0 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)";

export type AntigravityTransportOptions = {
  models?: readonly string[];
  auth?: AntigravityAuthDeps;
};

type Wire = { endpoints: readonly string[]; userAgent: string };

async function wire(auth: AntigravityAuthDeps): Promise<Wire> {
  const load = await auth.loadRuntime();
  if (load.kind !== "available") return { endpoints: FALLBACK_ENDPOINTS, userAgent: FALLBACK_USER_AGENT };
  const endpoints = load.runtime.endpoints();
  return {
    endpoints: Array.isArray(endpoints) && endpoints.length > 0 ? endpoints : FALLBACK_ENDPOINTS,
    userAgent: load.runtime.userAgent() || FALLBACK_USER_AGENT
  };
}

/** Antigravity's Cloud Code envelope around a Gemini `generateContent` body. */
export function buildAntigravityBody(request: GroundingRequest, model: string, projectId: string): Record<string, unknown> {
  return {
    project: projectId,
    model,
    request: buildGenerateContentBody(request),
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent/${randomUUID()}/${Date.now()}/${randomUUID()}/1`
  };
}

/** Google Search Grounding through the signed-in Antigravity account. */
export function createAntigravityTransport(options: AntigravityTransportOptions = {}): GroundingTransport {
  const models = options.models ?? ANTIGRAVITY_MODELS;
  const auth = options.auth ?? defaultAuthDeps;

  const send = (request: GroundingRequest, credential: AntigravityCredential, target: Wire, fetcher: typeof fetch) => sendWithFallbacks({
    transport: "antigravity",
    models,
    endpoints: target.endpoints,
    signal: request.signal,
    send: (model, endpoint, signal) => fetcher(`${endpoint}/v1internal:generateContent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/json", "User-Agent": target.userAgent },
      body: JSON.stringify(buildAntigravityBody(request, model, credential.projectId)),
      signal
    })
  });

  return {
    name: "antigravity",
    available(ctx, signal) {
      return hasAntigravityCredential(ctx, auth, signal);
    },
    async generate(request, ctx): Promise<TransportResponse> {
      const credential = await resolveAntigravityCredential(ctx, { signal: request.signal }, auth);
      const target = await wire(auth);
      try {
        return await send(request, credential, target, ctx.http.fetch);
      } catch (error) {
        // A token can be revoked before its expiry; refresh once and retry.
        if (!isGroundingError(error) || error.code !== "auth_rejected" || !credential.refreshable) throw error;
        const earlier = error.details.attempts ?? [];
        let renewed: AntigravityCredential;
        try {
          renewed = await resolveAntigravityCredential(ctx, { forceRefresh: true, signal: request.signal }, auth);
        } catch (refreshError) {
          if (!isGroundingError(refreshError)) throw refreshError;
          throw new GroundingError("auth_rejected", `${error.message}; refresh failed: ${refreshError.message}`, { ...error.details, attempts: earlier });
        }
        try {
          const response = await send(request, renewed, target, ctx.http.fetch);
          return { ...response, attempts: [...earlier, ...response.attempts] };
        } catch (retryError) {
          if (!isGroundingError(retryError)) throw retryError;
          throw retryError.withAttempts([...earlier, ...(retryError.details.attempts ?? [])]);
        }
      }
    }
  };
}
