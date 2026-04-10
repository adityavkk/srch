import { defineStrategy } from "../define.js";
import { merge } from "../operators.js";
import type { ExaCodeSourceRequest } from "../sources/exa-code.js";
import type { Evidence, ProviderAttempt, RunResult, SearchFn, SourceRequest, StaticStrategy, StrategyRequest } from "../types.js";

export type CodeStrategyRequest = StrategyRequest & ExaCodeSourceRequest;

function sourceBreakdown(evidence: Evidence[]): Record<string, number> {
  return evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.source] = (acc[item.source] ?? 0) + 1;
    return acc;
  }, {});
}

function successResult(req: CodeStrategyRequest, evidence: Evidence[], attempts: ProviderAttempt[], startedAt: number): RunResult {
  return {
    kind: "success",
    domain: "code",
    strategy: "code/default",
    evidence: [evidence[0]!, ...evidence.slice(1)],
    summary: {
      totalEvidence: evidence.length,
      sourceBreakdown: sourceBreakdown(evidence),
      attempts: [attempts[0]!, ...attempts.slice(1)],
      durationMs: Date.now() - startedAt
    },
    trace: [],
    suggestions: ["Run `search web \"query\"` for broader context"]
  };
}

function emptyResult(req: CodeStrategyRequest, attempts: ProviderAttempt[], startedAt: number): RunResult {
  return {
    kind: "empty",
    domain: "code",
    strategy: "code/default",
    summary: {
      totalEvidence: 0,
      sourceBreakdown: {},
      attempts: [attempts[0]!, ...attempts.slice(1)],
      durationMs: Date.now() - startedAt
    },
    trace: [],
    suggestions: [
      `Try adding a repo name to \"${req.query}\"`,
      "Run `search web \"query\"` for broader results"
    ]
  };
}

async function trySource<TRequest extends SourceRequest>(
  search: SearchFn,
  attempts: ProviderAttempt[],
  sourceName: string,
  req: TRequest,
  transport: string
): Promise<Evidence[]> {
  const startedAt = Date.now();
  try {
    const evidence = await search(sourceName, req);
    attempts.push({
      provider: sourceName,
      status: "success",
      transport,
      durationMs: Date.now() - startedAt,
      evidenceCount: evidence.length
    });
    return evidence;
  } catch (error) {
    attempts.push({
      provider: sourceName,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
    return [];
  }
}

export const codeDefaultStrategy: StaticStrategy<CodeStrategyRequest> = defineStrategy({
  kind: "static",
  name: "code/default",
  domain: "code",
  async run(req, ctx) {
    if (!req.query.trim()) {
      return {
        kind: "error",
        domain: "code",
        strategy: "code/default",
        error: { code: "invalid_query", message: "Query must not be empty" },
        trace: [],
        suggestions: ["Run `search code \"query\"`"]
      };
    }

    const startedAt = Date.now();
    const attempts: ProviderAttempt[] = [];

    const [primary, context7, deepwiki] = await Promise.all([
      trySource(ctx.search, attempts, "exa-code", { query: req.query, signal: req.signal, maxTokens: req.maxTokens }, "exa-context-api|exa-mcp"),
      trySource(ctx.search, attempts, "context7", { query: req.query, signal: req.signal }, "context7-mcp"),
      trySource(ctx.search, attempts, "deepwiki", { query: req.query, signal: req.signal }, "deepwiki-mcp")
    ]);

    const evidence = merge(primary, context7, deepwiki);
    return evidence.length > 0
      ? successResult(req, evidence, attempts, startedAt)
      : emptyResult(req, attempts, startedAt);
  }
});
