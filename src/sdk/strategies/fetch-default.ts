import { defineStrategy } from "../define.js";
import type { FetchContentOptions } from "../../lib/core/types.js";
import type { FetchEvidencePayload } from "../sources/fetch-content.js";
import type { Evidence, NonEmptyArray, ProviderAttempt, RunResult, StaticStrategy, StrategyRequest } from "../types.js";

export type FetchStrategyRequest = StrategyRequest & FetchContentOptions;

type FetchAttempt = { record: ProviderAttempt } & (
  | { kind: "ok"; evidence: NonEmptyArray<Evidence<FetchEvidencePayload>> }
  | { kind: "failed"; error: string }
);

const FAILURE_SUGGESTIONS: NonEmptyArray<string> = ["Check the URL", "Try `search web \"site query\"` to find an alternate source"];

async function attempt(provider: string, transport: string, run: () => Promise<Evidence<FetchEvidencePayload>[]>): Promise<FetchAttempt> {
  const startedAt = Date.now();
  try {
    const [first, ...rest] = (await run()).filter((item) => item.payload.content.trim());
    if (first) {
      return { kind: "ok", evidence: [first, ...rest], record: { provider, status: "success", transport, durationMs: Date.now() - startedAt, evidenceCount: rest.length + 1 } };
    }
    const error = `${provider} returned no text`;
    return { kind: "failed", error, record: { provider, status: "failed", error, durationMs: Date.now() - startedAt } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "failed", error: message, record: { provider, status: "failed", error: message, durationMs: Date.now() - startedAt } };
  }
}

function success(evidence: NonEmptyArray<Evidence<FetchEvidencePayload>>, attempts: NonEmptyArray<ProviderAttempt>, startedAt: number): RunResult {
  return {
    kind: "success",
    domain: "fetch",
    strategy: "fetch/default",
    evidence,
    summary: { totalEvidence: evidence.length, sourceBreakdown: { [evidence[0].source]: evidence.length }, attempts, durationMs: Date.now() - startedAt },
    trace: []
  };
}

function failure(code: string, message: string, suggestions: NonEmptyArray<string>): RunResult {
  return { kind: "error", domain: "fetch", strategy: "fetch/default", error: { code, message }, trace: [], suggestions };
}

export const fetchDefaultStrategy: StaticStrategy<FetchStrategyRequest> = defineStrategy({
  kind: "static",
  name: "fetch/default",
  domain: "fetch",
  async run(req, ctx): Promise<RunResult> {
    const startedAt = Date.now();
    if (!req.query.trim()) {
      return failure("invalid_url", "URL must not be empty", ["Run `search fetch <url>`"]);
    }

    const request = {
      query: req.query,
      signal: req.signal,
      downloadImagesDir: req.downloadImagesDir,
      describeImages: req.describeImages
    };
    const primary = await attempt("fetch-content", "http|jina|gemini|github", () => ctx.search("fetch-content", request));
    const attempts: NonEmptyArray<ProviderAttempt> = [primary.record];
    if (primary.kind === "ok") return success(primary.evidence, attempts, startedAt);
    if (req.signal?.aborted) return failure("fetch_failed", primary.error, FAILURE_SUGGESTIONS);

    // Exa's crawler often reads pages the local fetch cannot: blocked, JS-rendered or empty.
    const fallback = await attempt("exa-fetch", "exa-mcp", () => ctx.search("exa-fetch", request));
    attempts.push(fallback.record);
    if (fallback.kind === "ok") return success(fallback.evidence, attempts, startedAt);
    return failure("fetch_failed", `${primary.error} (exa-fetch: ${fallback.error})`, FAILURE_SUGGESTIONS);
  }
});
