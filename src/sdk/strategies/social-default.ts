import { defineStrategy } from "../define.js";
import type { Evidence, ProviderAttempt, RunResult, StaticStrategy, StrategyRequest } from "../types.js";
import type { BirdSourceRequest } from "../sources/bird.js";

export type SocialStrategyRequest = StrategyRequest & BirdSourceRequest;

function sourceBreakdown(evidence: Evidence[]): Record<string, number> {
  return evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.source] = (acc[item.source] ?? 0) + 1;
    return acc;
  }, {});
}

export const socialDefaultStrategy: StaticStrategy<SocialStrategyRequest> = defineStrategy({
  kind: "static",
  name: "social/default",
  domain: "social",
  async run(req, ctx): Promise<RunResult> {
    const startedAt = Date.now();
    if (!req.query.trim()) {
      return { kind: "error", domain: "social", strategy: "social/default", error: { code: "invalid_query", message: "Query must not be empty" }, trace: [], suggestions: ["Run `search social \"query\"`"] };
    }

    try {
      const evidence = await ctx.search("bird", { query: req.query, signal: req.signal, count: req.count } as never);
      const attempts: [ProviderAttempt] = [{ provider: "bird", status: "success", transport: "bird", durationMs: Date.now() - startedAt, evidenceCount: evidence.length }];
      if (evidence.length === 0) {
        return { kind: "empty", domain: "social", strategy: "social/default", summary: { totalEvidence: 0, sourceBreakdown: {}, attempts, durationMs: Date.now() - startedAt }, trace: [], suggestions: ["Try broader terms", "Increase `--count`"] };
      }

      return {
        kind: "success",
        domain: "social",
        strategy: "social/default",
        evidence: [evidence[0]!, ...evidence.slice(1)],
        summary: { totalEvidence: evidence.length, sourceBreakdown: sourceBreakdown(evidence), attempts, durationMs: Date.now() - startedAt },
        trace: []
      };
    } catch (error) {
      return { kind: "error", domain: "social", strategy: "social/default", error: { code: "social_unavailable", message: error instanceof Error ? error.message : String(error) }, trace: [], suggestions: ["Log into x.com in Chrome/Safari", "Try `search web \"query\"` instead"] };
    }
  }
});
