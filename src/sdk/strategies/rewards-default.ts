import { defineStrategy } from "../define.js";
import type { RewardsCabin, RewardsFlightSearchOptions } from "../../lib/rewards-flights/seats-aero.js";
import type { ProviderAttempt, RunResult, StaticStrategy, StrategyRequest } from "../types.js";

export type RewardsStrategyRequest = StrategyRequest & Partial<RewardsFlightSearchOptions> & {
  date?: string;
};

function parseQuery(query: string) {
  const [originAirport, destinationAirport] = query.trim().split(/\s+/);
  return { originAirport, destinationAirport };
}

export const rewardsDefaultStrategy: StaticStrategy<RewardsStrategyRequest> = defineStrategy({
  kind: "static",
  name: "rewards-flights/default",
  domain: "rewards-flights",
  async run(req, ctx): Promise<RunResult> {
    const startedAt = Date.now();
    const { originAirport, destinationAirport } = parseQuery(req.query);
    if (!originAirport || !destinationAirport) {
      return { kind: "error", domain: "rewards-flights", strategy: "rewards-flights/default", error: { code: "invalid_query", message: "Expected: <origin> <destination>" }, trace: [], suggestions: ["Run `search rewards-flights JFK CDG --date 2026-07-01`"] };
    }

    try {
      const evidence = await ctx.search("seats-aero", {
        query: req.query,
        originAirport,
        destinationAirport,
        startDate: req.date ?? req.startDate,
        endDate: req.date ?? req.endDate,
        cabins: req.cabins,
        sources: req.sources,
        carriers: req.carriers,
        take: req.take,
        skip: req.skip,
        includeTrips: req.includeTrips,
        includeFiltered: req.includeFiltered,
        includeZeroSeats: req.includeZeroSeats,
        minSeats: req.minSeats,
        onlyDirectFlights: req.onlyDirectFlights,
        orderBy: req.orderBy,
        signal: req.signal
      } as never);
      const attempts: [ProviderAttempt] = [{ provider: "seats-aero", status: "success", transport: "seats-aero", durationMs: Date.now() - startedAt, evidenceCount: evidence.length }];
      if (evidence.length === 0) {
        return { kind: "empty", domain: "rewards-flights", strategy: "rewards-flights/default", summary: { totalEvidence: 0, sourceBreakdown: {}, attempts, durationMs: Date.now() - startedAt }, trace: [], suggestions: ["Try `--include-zero-seats`", "Broaden date range"] };
      }
      return { kind: "success", domain: "rewards-flights", strategy: "rewards-flights/default", evidence: [evidence[0]!, ...evidence.slice(1)], summary: { totalEvidence: evidence.length, sourceBreakdown: { "seats-aero": evidence.length }, attempts, durationMs: Date.now() - startedAt }, trace: [] };
    } catch (error) {
      return { kind: "error", domain: "rewards-flights", strategy: "rewards-flights/default", error: { code: "rewards_unavailable", message: error instanceof Error ? error.message : String(error) }, trace: [], suggestions: ["Configure `seatsAeroApiKey`", "Run `search rewards-flights auth status`"] };
    }
  }
});
