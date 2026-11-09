import { isBraveAvailable } from "../../lib/upstream/brave.js";
import { isGeminiApiAvailable } from "../../lib/upstream/gemini-api.js";
import { isPerplexityAvailable } from "../../lib/upstream/perplexity.js";
import { defineStrategy } from "../define.js";
import { merge } from "../operators.js";
import type { Evidence, ProviderAttempt, RunResult, RunSummary, StaticStrategy, StrategyContext, StrategyRequest } from "../types.js";
import { DEFAULT_WEB_TIMEOUT_MS, unsupportedWebOptions, validateWebOptions, WebOptionsError, type WebTransport } from "../../lib/search/web-options.js";
import type { WebSourceRequest } from "../sources/web-shared.js";

export type WebStrategyRequest = StrategyRequest & WebSourceRequest & {
  provider?: "auto" | "exa" | "brave" | "gemini" | "perplexity";
  hq?: boolean;
  timeoutMs?: number;
};

export type WebStrategyDeps = {
  isBraveAvailable: typeof isBraveAvailable;
  isGeminiApiAvailable: typeof isGeminiApiAvailable;
  isPerplexityAvailable: typeof isPerplexityAvailable;
};

const defaultDeps: WebStrategyDeps = {
  isBraveAvailable,
  isGeminiApiAvailable,
  isPerplexityAvailable
};

function requestFor(req: WebStrategyRequest): WebSourceRequest {
  return {
    query: req.query,
    signal: req.signal,
    numResults: req.numResults,
    includeContent: req.includeContent,
    recencyFilter: req.recencyFilter,
    domainFilter: req.domainFilter
  };
}

function sourceBreakdown(evidence: Evidence[]): Record<string, number> {
  return evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.source] = (acc[item.source] ?? 0) + 1;
    return acc;
  }, {});
}

function successResult(req: WebStrategyRequest, evidence: Evidence[], attempts: ProviderAttempt[], startedAt: number): RunResult {
  return {
    kind: "success",
    domain: "web",
    strategy: "web/default",
    evidence: [evidence[0]!, ...evidence.slice(1)],
    summary: {
      totalEvidence: evidence.length,
      sourceBreakdown: sourceBreakdown(evidence),
      attempts: [attempts[0]!, ...attempts.slice(1)],
      durationMs: Date.now() - startedAt
    },
    trace: [],
    suggestions: ["Run `search fetch <url>` to read a result in full"]
  };
}

function emptyResult(req: WebStrategyRequest, attempts: ProviderAttempt[], startedAt: number): RunResult {
  return {
    kind: "empty",
    domain: "web",
    strategy: "web/default",
    summary: {
      totalEvidence: 0,
      sourceBreakdown: {},
      attempts: [attempts[0]!, ...attempts.slice(1)],
      durationMs: Date.now() - startedAt
    },
    trace: [],
    suggestions: [
      `Try broader terms than "${req.query}"`,
      "Run `search web --hq \"query\"` for higher quality results"
    ]
  };
}

function errorResult(req: WebStrategyRequest, code: string, message: string): RunResult {
  return {
    kind: "error",
    domain: "web",
    strategy: "web/default",
    error: { code, message },
    trace: [],
    suggestions: ["Run `search --help` for usage", "Try `search web \"query\"`" ]
  };
}

function noEvidenceResult(req: WebStrategyRequest, attempts: ProviderAttempt[], startedAt: number): RunResult {
  const summary: RunSummary | undefined = attempts.length > 0 ? {
    totalEvidence: 0,
    sourceBreakdown: {},
    attempts: [attempts[0]!, ...attempts.slice(1)],
    durationMs: Date.now() - startedAt
  } : undefined;

  if (req.signal?.aborted) {
    const timedOut = req.signal.reason instanceof Error && req.signal.reason.name === "TimeoutError";
    return {
      kind: "error",
      domain: "web",
      strategy: "web/default",
      error: { code: timedOut ? "timeout" : "aborted", message: timedOut ? "Web search exceeded its time limit" : "Web search was cancelled" },
      summary,
      trace: [],
      suggestions: [timedOut ? "Increase timeoutMs or select a working provider" : "Retry the search with a new cancellation signal"]
    };
  }

  if (attempts.some((attempt) => attempt.status === "success")) {
    return emptyResult(req, attempts, startedAt);
  }

  const failures = attempts.flatMap((attempt) => attempt.status === "failed"
    ? [`${attempt.provider}${attempt.transport ? ` (${attempt.transport})` : ""}: ${attempt.error}`]
    : []);
  return {
    kind: "error",
    domain: "web",
    strategy: "web/default",
    error: {
      code: "web_unavailable",
      message: `No web search provider completed successfully${failures.length > 0 ? `: ${failures.join("; ")}` : ""}`
    },
    summary,
    trace: [],
    suggestions: [
      "Run `search inspect tools --json` to check provider availability",
      "Check network access and the failed provider's credentials or browser profile, then retry"
    ]
  };
}

type Candidate = {
  provider: "exa" | "brave" | "gemini" | "perplexity";
  transport: WebTransport;
  options?: { mode?: "api" | "mcp"; transport?: "api" | "web" };
  available?: (ctx: StrategyContext, signal?: AbortSignal) => Promise<boolean>;
};

function candidatesFor(req: WebStrategyRequest, deps: WebStrategyDeps): Candidate[] {
  const exa: Candidate = { provider: "exa", transport: req.hq ? "exa-api" : "exa-mcp", options: { mode: req.hq ? "api" : "mcp" } };
  const brave: Candidate = { provider: "brave", transport: "brave-search-api", available: deps.isBraveAvailable };
  const geminiWeb: Candidate = { provider: "gemini", transport: "gemini-web", options: { transport: "web" } };
  const geminiApi: Candidate = { provider: "gemini", transport: "gemini-api", options: { transport: "api" }, available: deps.isGeminiApiAvailable };
  const perplexity: Candidate = { provider: "perplexity", transport: "perplexity-api", available: deps.isPerplexityAvailable };
  if (req.provider === "exa") return [exa];
  if (req.provider === "brave") return [{ ...brave, available: undefined }];
  if (req.provider === "perplexity") return [{ ...perplexity, available: undefined }];
  if (req.provider === "gemini") return req.hq ? [{ ...geminiApi, available: undefined }] : [geminiWeb, geminiApi];
  return req.hq ? [exa] : [exa, brave, geminiWeb, geminiApi, perplexity];
}

// Bound even custom transports or secret resolvers that ignore AbortSignal.
function withSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); }
    );
  });
}

export function createWebDefaultStrategy(deps: WebStrategyDeps = defaultDeps): StaticStrategy<WebStrategyRequest> {
  return defineStrategy({
    kind: "static",
    name: "web/default",
    domain: "web",
    async run(request, ctx) {
      if (typeof request.query !== "string" || !request.query.trim()) {
        return errorResult(request, "invalid_query", "Query must be a non-empty string");
      }
      try {
        validateWebOptions(request);
      } catch (error) {
        if (error instanceof WebOptionsError) return errorResult(request, error.code, error.message);
        throw error;
      }
      const candidates = candidatesFor(request, deps);
      const explicit = request.provider !== undefined && request.provider !== "auto" || request.hq;
      if (explicit) {
        const reason = unsupportedWebOptions(candidates[0]!.transport, request);
        if (reason) return errorResult(request, "unsupported_option", reason);
      }
      if (candidates.every((candidate) => unsupportedWebOptions(candidate.transport, request))) {
        return errorResult(request, "unsupported_option", "No selected transport supports this combination of search options. Select Exa with hq for filtered full content.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException("Web search exceeded its time limit", "TimeoutError")), request.timeoutMs ?? DEFAULT_WEB_TIMEOUT_MS);
      const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
      const req = { ...request, signal };
      const startedAt = Date.now();
      const attempts: ProviderAttempt[] = [];
      try {
        for (const candidate of candidates) {
          if (signal.aborted) break;
          const { provider, transport } = candidate;
          const reason = unsupportedWebOptions(transport, req);
          if (reason) {
            attempts.push({ provider, transport, status: "skipped", reason });
            continue;
          }
          const attemptStarted = Date.now();
          try {
            if (candidate.available && !await withSignal(() => candidate.available!(ctx, signal), signal)) {
              attempts.push({ provider, transport, status: "skipped", reason: "missing API key" });
              continue;
            }
            const evidence = await withSignal(() => ctx.search(provider, { ...requestFor(req), ...candidate.options }), signal);
            if (signal.aborted) break;
            attempts.push({ provider, transport, status: "success", durationMs: Date.now() - attemptStarted, evidenceCount: evidence.length });
            if (evidence.length > 0) return successResult(req, explicit ? evidence : merge(evidence), attempts, startedAt);
          } catch (error) {
            attempts.push({ provider, transport, status: "failed", error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - attemptStarted });
          }
        }
        return noEvidenceResult(req, attempts, startedAt);
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export const webDefaultStrategy = createWebDefaultStrategy();
