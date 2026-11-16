import { createAntigravityTransport } from "./antigravity-transport.js";
import { GroundingError, isGroundingError } from "./errors.js";
import { createGeminiApiTransport } from "./gemini-api-transport.js";
import { mergeRequestedUrls, parseGroundingResponse } from "./parse.js";
import { resolveGroundingSources } from "./redirects.js";
import { validateGroundingRequest } from "./request.js";
import type { GroundingContext, GroundingTransport } from "./transport.js";
import type { GroundedAnswer, GroundingRequest, GroundingTransportName, TransportAttempt } from "./types.js";

export type GroundingTransportSelection = "auto" | GroundingTransportName;

/** Signed-in account first; the API key transport covers hosts without Pi. */
export const defaultGroundingTransports: readonly GroundingTransport[] = [createAntigravityTransport(), createGeminiApiTransport()];

export function selectTransports(transports: readonly GroundingTransport[], selection: GroundingTransportSelection = "auto"): GroundingTransport[] {
  if (selection === "auto") return [...transports];
  const match = transports.filter((transport) => transport.name === selection);
  if (match.length === 0) throw new GroundingError("unsupported_request", `Unknown grounding transport: ${selection}`);
  return match;
}

/**
 * Run Google Search Grounding over the first transport that produces a cited answer.
 * An uncited or malformed answer counts as a failed attempt, never as success.
 */
export async function runGrounding(
  request: GroundingRequest,
  ctx: GroundingContext,
  options: { transports?: readonly GroundingTransport[]; transport?: GroundingTransportSelection } = {}
): Promise<GroundedAnswer> {
  validateGroundingRequest(request);
  const candidates = selectTransports(options.transports ?? defaultGroundingTransports, options.transport);
  const explicit = options.transport !== undefined && options.transport !== "auto";
  const attempts: TransportAttempt[] = [];
  let last: GroundingError | undefined;

  for (const transport of candidates) {
    request.signal?.throwIfAborted();
    const startedAt = Date.now();
    // An explicit selection reports its own credential error instead of a generic skip.
    if (!explicit && !await transport.available(ctx, request.signal)) {
      const skipped = new GroundingError("auth_unavailable", `${transport.name} has no credentials`);
      // A failure from a transport that was actually tried explains more than a skip.
      last ??= skipped;
      attempts.push({ transport: transport.name, status: "failed", code: skipped.code, message: skipped.message, durationMs: 0 });
      continue;
    }
    try {
      const response = await transport.generate(request, ctx);
      attempts.push(...response.attempts);
      const parsed = parseGroundingResponse(response.data);
      if (parsed.sources.length === 0) {
        throw new GroundingError("uncited_answer", `${transport.name} returned ${parsed.text ? "an answer" : "a response"} without source URLs`);
      }
      const sources = await resolveGroundingSources(parsed.sources, ctx.http.fetch, request.signal);
      return {
        ...parsed,
        sources,
        urlRetrievals: mergeRequestedUrls(request.urls ?? [], parsed.urlRetrievals),
        transport: transport.name,
        model: response.model,
        attempts
      };
    } catch (error) {
      request.signal?.throwIfAborted();
      if (!isGroundingError(error)) throw error;
      last = error;
      const recorded = error.details.attempts;
      if (recorded?.length) attempts.push(...recorded);
      else attempts.push({ transport: transport.name, status: "failed", code: error.code, message: error.message, durationMs: Date.now() - startedAt });
    }
  }
  throw (last ?? new GroundingError("auth_unavailable", "No grounding transport is configured")).withAttempts(attempts);
}
