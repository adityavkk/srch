import { defineStrategy } from "../define.js";
import type { ProviderAttempt, RunResult, StaticStrategy, StrategyRequest } from "../types.js";

export const fetchDefaultStrategy: StaticStrategy<StrategyRequest> = defineStrategy({
  kind: "static",
  name: "fetch/default",
  domain: "fetch",
  async run(req, ctx): Promise<RunResult> {
    const startedAt = Date.now();
    if (!req.query.trim()) {
      return { kind: "error", domain: "fetch", strategy: "fetch/default", error: { code: "invalid_url", message: "URL must not be empty" }, trace: [], suggestions: ["Run `search fetch <url>`"] };
    }

    try {
      const evidence = await ctx.search("fetch-content", { query: req.query, signal: req.signal });
      const attempts: [ProviderAttempt] = [{ provider: "fetch-content", status: "success", transport: "http|jina|gemini|github", durationMs: Date.now() - startedAt, evidenceCount: evidence.length }];
      return {
        kind: "success",
        domain: "fetch",
        strategy: "fetch/default",
        evidence: [evidence[0]!, ...evidence.slice(1)],
        summary: { totalEvidence: evidence.length, sourceBreakdown: { "fetch-content": evidence.length }, attempts, durationMs: Date.now() - startedAt },
        trace: []
      };
    } catch (error) {
      return {
        kind: "error",
        domain: "fetch",
        strategy: "fetch/default",
        error: { code: "fetch_failed", message: error instanceof Error ? error.message : String(error) },
        trace: [],
        suggestions: ["Check the URL", "Try `search web \"site query\"` to find an alternate source"]
      };
    }
  }
});
