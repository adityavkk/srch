import { isBraveAvailable } from "../../lib/upstream/brave.js";
import { isGeminiApiAvailable } from "../../lib/upstream/gemini-api.js";
import { isPerplexityAvailable } from "../../lib/upstream/perplexity.js";
import { defineStrategy } from "../define.js";
import { merge } from "../operators.js";
import type { AnySource, Evidence, ProviderAttempt, RunResult, RunSummary, SourceRequest, StaticStrategy, StrategyContext, StrategyRequest } from "../types.js";
import type { WebSourceRequest } from "../sources/web-shared.js";

export type WebStrategyRequest = StrategyRequest & WebSourceRequest & {
  provider?: "auto" | "exa" | "brave" | "gemini" | "perplexity";
  hq?: boolean;
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
    return {
      kind: "error",
      domain: "web",
      strategy: "web/default",
      error: { code: "aborted", message: "Web search was cancelled" },
      summary,
      trace: [],
      suggestions: ["Retry the search with a new cancellation signal"]
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

async function trySource<TRequest extends SourceRequest>(
  ctx: StrategyContext,
  attempts: ProviderAttempt[],
  source: string | AnySource,
  req: TRequest,
  meta: { provider: string; transport: string }
): Promise<Evidence[] | null> {
  const startedAt = Date.now();
  try {
    const evidence = typeof source === "string"
      ? await ctx.search(source, req)
      : await ctx.search(source, req);
    attempts.push({
      provider: meta.provider,
      status: "success",
      transport: meta.transport,
      durationMs: Date.now() - startedAt,
      evidenceCount: evidence.length
    });
    return evidence.length > 0 ? evidence : null;
  } catch (error) {
    attempts.push({
      provider: meta.provider,
      status: "failed",
      transport: meta.transport,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
    return null;
  }
}

export function createWebDefaultStrategy(deps: WebStrategyDeps = defaultDeps): StaticStrategy<WebStrategyRequest> {
  return defineStrategy({
    kind: "static",
    name: "web/default",
    domain: "web",
    async run(req, ctx) {
      if (!req.query.trim()) {
        return errorResult(req, "invalid_query", "Query must not be empty");
      }

      const startedAt = Date.now();
      const attempts: ProviderAttempt[] = [];
      if (req.signal?.aborted) return noEvidenceResult(req, attempts, startedAt);

      if (req.provider === "exa") {
        const evidence = await trySource(ctx, attempts, "exa", { ...requestFor(req), mode: req.hq ? "api" : "mcp" }, { provider: "exa", transport: req.hq ? "exa-api" : "exa-mcp" });
        return evidence ? successResult(req, evidence, attempts, startedAt) : noEvidenceResult(req, attempts, startedAt);
      }
      if (req.provider === "brave") {
        const evidence = await trySource(ctx, attempts, "brave", requestFor(req), { provider: "brave", transport: "brave-search-api" });
        return evidence ? successResult(req, evidence, attempts, startedAt) : noEvidenceResult(req, attempts, startedAt);
      }
      if (req.provider === "gemini") {
        const webEvidence = await trySource(ctx, attempts, "gemini", { ...requestFor(req), transport: req.hq ? "api" : "web" }, { provider: "gemini", transport: req.hq ? "gemini-api" : "gemini-web" });
        if (webEvidence) return successResult(req, webEvidence, attempts, startedAt);
        if (req.signal?.aborted) return noEvidenceResult(req, attempts, startedAt);
        if (!req.hq && await deps.isGeminiApiAvailable(ctx)) {
          const apiEvidence = await trySource(ctx, attempts, "gemini", { ...requestFor(req), transport: "api" }, { provider: "gemini", transport: "gemini-api" });
          if (apiEvidence) return successResult(req, apiEvidence, attempts, startedAt);
        }
        return noEvidenceResult(req, attempts, startedAt);
      }
      if (req.provider === "perplexity") {
        const evidence = await trySource(ctx, attempts, "perplexity", requestFor(req), { provider: "perplexity", transport: "perplexity-api" });
        return evidence ? successResult(req, evidence, attempts, startedAt) : noEvidenceResult(req, attempts, startedAt);
      }

      if (req.hq) {
        const evidence = await trySource(ctx, attempts, "exa", { ...requestFor(req), mode: "api" }, { provider: "exa", transport: "exa-api" });
        return evidence ? successResult(req, evidence, attempts, startedAt) : noEvidenceResult(req, attempts, startedAt);
      }

      const collected: Evidence[][] = [];

      const exa = await trySource(ctx, attempts, "exa", { ...requestFor(req), mode: "mcp" }, { provider: "exa", transport: "exa-mcp" });
      if (exa) collected.push(exa);
      if (collected.length > 0) return successResult(req, merge(...collected), attempts, startedAt);
      if (req.signal?.aborted) return noEvidenceResult(req, attempts, startedAt);

      if (await deps.isBraveAvailable(ctx)) {
        const brave = await trySource(ctx, attempts, "brave", requestFor(req), { provider: "brave", transport: "brave-search-api" });
        if (brave) collected.push(brave);
        if (collected.length > 0) return successResult(req, merge(...collected), attempts, startedAt);
        if (req.signal?.aborted) return noEvidenceResult(req, attempts, startedAt);
      } else {
        attempts.push({ provider: "brave", transport: "brave-search-api", status: "skipped", reason: "missing API key" });
      }

      const geminiWeb = await trySource(ctx, attempts, "gemini", { ...requestFor(req), transport: "web" }, { provider: "gemini", transport: "gemini-web" });
      if (geminiWeb) collected.push(geminiWeb);
      if (collected.length > 0) return successResult(req, merge(...collected), attempts, startedAt);
      if (req.signal?.aborted) return noEvidenceResult(req, attempts, startedAt);

      if (await deps.isGeminiApiAvailable(ctx)) {
        const geminiApi = await trySource(ctx, attempts, "gemini", { ...requestFor(req), transport: "api" }, { provider: "gemini", transport: "gemini-api" });
        if (geminiApi) collected.push(geminiApi);
        if (collected.length > 0) return successResult(req, merge(...collected), attempts, startedAt);
        if (req.signal?.aborted) return noEvidenceResult(req, attempts, startedAt);
      } else {
        attempts.push({ provider: "gemini", transport: "gemini-api", status: "skipped", reason: "missing API key" });
      }

      if (await deps.isPerplexityAvailable(ctx)) {
        const perplexity = await trySource(ctx, attempts, "perplexity", requestFor(req), { provider: "perplexity", transport: "perplexity-api" });
        if (perplexity) collected.push(perplexity);
        if (collected.length > 0) return successResult(req, merge(...collected), attempts, startedAt);
      } else {
        attempts.push({ provider: "perplexity", transport: "perplexity-api", status: "skipped", reason: "missing API key" });
      }

      return noEvidenceResult(req, attempts, startedAt);
    }
  });
}

export const webDefaultStrategy = createWebDefaultStrategy();
