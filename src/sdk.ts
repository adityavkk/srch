export { createClient, type ClientSearch, type SrchClient } from "./sdk/client.js";
export { defineSource } from "./sdk/define.js";
export { SourceRegistry } from "./sdk/registry.js";
export {
  exaSource,
  createExaSource,
  type ExaEvidencePayload,
  type ExaSourceDeps,
  type ExaSourceRequest
} from "./sdk/sources/exa.js";
export type {
  AnySource,
  Evidence,
  HttpClient,
  NonEmptyArray,
  Provenance,
  RecentRun,
  RunEmpty,
  RunError,
  RunResult,
  RunSuccess,
  RunSummary,
  SecretResolver,
  Source,
  SourceContext,
  SourceHealth,
  SourceRequest,
  SrchStatus
} from "./sdk/types.js";

export {
  searchFlights,
  resolveFlightLocation,
  summarizeOffer,
  type FliFlightSearchOptions,
  type FlightOffer,
  type FlightSearchResult
} from "./lib/flights/fli.js";
