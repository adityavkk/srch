import { searchRewardFlights, type RewardsFlightSearchOptions, type RewardsFlightSearchResult } from "../../lib/rewards-flights/seats-aero.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";

export type SeatsAeroSourceRequest = SourceRequest & RewardsFlightSearchOptions;

export type SeatsAeroEvidencePayload = {
  kind: "award-availability";
  item: unknown;
  summary: string;
  result: RewardsFlightSearchResult;
};

export const seatsAeroSource: Source<SeatsAeroSourceRequest, SeatsAeroEvidencePayload> = defineSource({
  name: "seats-aero",
  domain: "rewards-flights",
  capabilities: ["search"],
  traits: ["api-key-required"],
  transports: ["seats-aero"],
  async run(req, ctx) {
    ctx.trace.step("source.seats-aero", `${req.originAirport}-${req.destinationAirport}`);
    const result = await searchRewardFlights({
      originAirport: req.originAirport,
      destinationAirport: req.destinationAirport,
      startDate: req.startDate,
      endDate: req.endDate,
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
      orderBy: req.orderBy
    });

    return result.items.map((item, index) => ({
      source: "seats-aero",
      domain: "rewards-flights",
      query: req.query,
      provenance: {
        kind: "api",
        api: "seats-aero",
        transport: "seats-aero",
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "award-availability",
        item,
        summary: result.summaries[index] ?? "",
        result
      }
    }));
  }
});
