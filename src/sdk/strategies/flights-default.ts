import { defineStrategy } from "../define.js";
import type { ProviderAttempt, RunResult, StaticStrategy, StrategyRequest } from "../types.js";
import type { FliFlightSearchOptions } from "../../lib/flights/fli.js";

export type FlightsStrategyRequest = StrategyRequest & {
  options?: FliFlightSearchOptions;
};

function parseQuery(query: string) {
  const [origin, destination, dateFrom] = query.trim().split(/\s+/);
  return { origin, destination, dateFrom };
}

export const flightsDefaultStrategy: StaticStrategy<FlightsStrategyRequest> = defineStrategy({
  kind: "static",
  name: "flights/default",
  domain: "flights",
  async run(req, ctx): Promise<RunResult> {
    const startedAt = Date.now();
    const { origin, destination, dateFrom } = parseQuery(req.query);
    if (!origin || !destination || !dateFrom) {
      return { kind: "error", domain: "flights", strategy: "flights/default", error: { code: "invalid_query", message: "Expected: <origin> <destination> <date>" }, trace: [], suggestions: ["Run `search flights JFK DEL 2026-05-15`"] };
    }

    try {
      const evidence = await ctx.search("fli", { query: req.query, origin, destination, dateFrom, options: req.options, signal: req.signal } as never);
      const attempts: [ProviderAttempt] = [{ provider: "fli", status: "success", transport: "fli-sdk", durationMs: Date.now() - startedAt, evidenceCount: evidence.length }];
      if (evidence.length === 0) {
        return { kind: "empty", domain: "flights", strategy: "flights/default", summary: { totalEvidence: 0, sourceBreakdown: {}, attempts, durationMs: Date.now() - startedAt }, trace: [], suggestions: ["Try different dates", "Try nearby airports"] };
      }
      return { kind: "success", domain: "flights", strategy: "flights/default", evidence: [evidence[0]!, ...evidence.slice(1)], summary: { totalEvidence: evidence.length, sourceBreakdown: { fli: evidence.length }, attempts, durationMs: Date.now() - startedAt }, trace: [] };
    } catch (error) {
      return { kind: "error", domain: "flights", strategy: "flights/default", error: { code: "flights_unavailable", message: error instanceof Error ? error.message : String(error) }, trace: [], suggestions: ["Run `search install flights` to install the optional backend"] };
    }
  }
});
