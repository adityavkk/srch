import { searchFlights, FlightPricingUnavailableError, type FlightOffer, type FliFlightSearchOptions, type FlightSearchResult } from "../../lib/flights/fli.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";

export type FliSourceRequest = SourceRequest & {
  origin: string;
  destination: string;
  dateFrom: string;
  options?: FliFlightSearchOptions;
};

export type FliEvidencePayload = {
  kind: "flight-offer";
  offer: FlightOffer;
  search: FlightSearchResult;
  summary: string;
};

export const fliSource: Source<FliSourceRequest, FliEvidencePayload> = defineSource({
  name: "fli",
  domain: "flights",
  capabilities: ["search"],
  traits: ["optional-backend"],
  transports: ["fli-sdk"],
  async run(req, ctx) {
    ctx.trace.step("source.fli", `${req.origin}-${req.destination}`, { dateFrom: req.dateFrom });
    const result = await searchFlights(req.origin, req.destination, req.dateFrom, req.options);
    if (!result.result.offers.length && result.result.status === "pricing_unavailable") {
      throw new FlightPricingUnavailableError(
        result.result.warnings?.join(" ") || "Prices are unavailable for the requested party; seat availability is unknown.",
        result.result.search_url
      );
    }
    return result.result.offers.map((offer, index) => ({
      source: "fli",
      domain: "flights",
      query: req.query,
      provenance: {
        kind: "api",
        api: "fli",
        transport: "fli-sdk",
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "flight-offer",
        offer,
        search: result.result,
        summary: result.offerSummaries[index] ?? ""
      }
    }));
  }
});
