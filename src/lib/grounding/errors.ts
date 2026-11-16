import type { GroundingErrorCode, TransportAttempt } from "./types.js";

const RECOVERY: Record<GroundingErrorCode, string> = {
  auth_unavailable: "Sign in with `/login antigravity` in Pi, or configure geminiApiKey for the Gemini API transport",
  auth_expired: "Open Pi to refresh the Antigravity session, or run `/login antigravity`",
  auth_rejected: "Run `/login antigravity` again; the account was rejected or lacks access",
  quota_exhausted: "Wait for the quota window to reset, or use another provider",
  model_unavailable: "Update pi-antigravity or choose another grounding model",
  upstream_unavailable: "Retry later or use another provider",
  invalid_response: "Retry, or report the response shape if it persists",
  uncited_answer: "Retry the query, or use a retrieval provider that returns source links",
  unsupported_request: "Remove the unsupported option or select another provider"
};

/** Typed grounding failure. Messages never include credentials. */
export class GroundingError extends Error {
  readonly recovery: string;

  constructor(
    readonly code: GroundingErrorCode,
    message: string,
    readonly details: { httpStatus?: number; retryAfterMs?: number; attempts?: TransportAttempt[] } = {}
  ) {
    super(message);
    this.name = "GroundingError";
    this.recovery = RECOVERY[code];
  }

  /** Copy with the attempts collected by a transport chain. */
  withAttempts(attempts: TransportAttempt[]): GroundingError {
    const error = new GroundingError(this.code, this.message, { ...this.details, attempts });
    error.stack = this.stack;
    return error;
  }
}

export function isGroundingError(error: unknown): error is GroundingError {
  return error instanceof GroundingError;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Upstream error bodies are untrusted; keep a short, single-line excerpt. */
export function upstreamMessage(body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // Not JSON.
  }
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Classify a non-2xx grounding response. */
export function errorForStatus(status: number, body: string, retryAfter: string | null): GroundingError {
  const message = upstreamMessage(body) || `HTTP ${status}`;
  const details = { httpStatus: status, retryAfterMs: parseRetryAfter(retryAfter) };
  if (status === 401 || status === 403) return new GroundingError("auth_rejected", message, details);
  if (status === 429) return new GroundingError("quota_exhausted", message, details);
  if (status === 404 || (status === 400 && /model|invalid argument|thinking/i.test(message))) {
    return new GroundingError("model_unavailable", message, details);
  }
  if (status >= 500) return new GroundingError("upstream_unavailable", message, details);
  return new GroundingError("unsupported_request", message, details);
}
