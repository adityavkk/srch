import { defineStrategy } from "../define.js";
import type { Evidence, ProviderAttempt, RunResult, StaticStrategy, StrategyRequest } from "../types.js";
import type { DocsSourceRequest } from "../sources/docs-qmd.js";

export type DocsStrategyRequest = StrategyRequest & DocsSourceRequest;

function sourceBreakdown(evidence: Evidence[]): Record<string, number> {
  return evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.source] = (acc[item.source] ?? 0) + 1;
    return acc;
  }, {});
}

export const docsDefaultStrategy: StaticStrategy<DocsStrategyRequest> = defineStrategy({
  kind: "static",
  name: "docs/default",
  domain: "docs",
  async run(req, ctx): Promise<RunResult> {
    const startedAt = Date.now();
    if (!req.query.trim()) {
      return { kind: "error", domain: "docs", strategy: "docs/default", error: { code: "invalid_query", message: "Query must not be empty" }, trace: [], suggestions: ["Run `search docs \"query\"`"] };
    }

    const evidence = await ctx.search("docs-qmd", { query: req.query, signal: req.signal, limit: req.limit } as never);
    const attempts: [ProviderAttempt] = [{ provider: "docs-qmd", status: "success", transport: "qmd-sdk", durationMs: Date.now() - startedAt, evidenceCount: evidence.length }];

    if (evidence.length === 0) {
      return {
        kind: "empty",
        domain: "docs",
        strategy: "docs/default",
        summary: { totalEvidence: 0, sourceBreakdown: {}, attempts, durationMs: Date.now() - startedAt },
        trace: [],
        suggestions: ["Run `search docs index status` to inspect the local index", "Run `search docs index update` to refresh docs"]
      };
    }

    return {
      kind: "success",
      domain: "docs",
      strategy: "docs/default",
      evidence: [evidence[0]!, ...evidence.slice(1)],
      summary: { totalEvidence: evidence.length, sourceBreakdown: sourceBreakdown(evidence), attempts, durationMs: Date.now() - startedAt },
      trace: []
    };
  }
});
