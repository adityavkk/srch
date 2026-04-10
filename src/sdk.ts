export { createClient, type ClientSearch, type SrchClient } from "./sdk/client.js";
export { defineSource, defineStrategy } from "./sdk/define.js";
export { merge, dedupe, sort, filter } from "./sdk/operators.js";
export { SourceRegistry } from "./sdk/registry.js";
export { StrategyRegistry } from "./sdk/strategy.js";
export {
  braveSource,
  type BraveEvidencePayload
} from "./sdk/sources/brave.js";
export {
  exaSource,
  createExaSource,
  type ExaEvidencePayload,
  type ExaSourceDeps,
  type ExaSourceRequest
} from "./sdk/sources/exa.js";
export {
  geminiSource,
  type GeminiEvidencePayload,
  type GeminiSourceRequest
} from "./sdk/sources/gemini.js";
export {
  perplexitySource,
  type PerplexityEvidencePayload
} from "./sdk/sources/perplexity.js";
export {
  webDefaultStrategy,
  createWebDefaultStrategy,
  type WebStrategyDeps,
  type WebStrategyRequest
} from "./sdk/strategies/web-default.js";
export type {
  AnySource,
  AnyStrategy,
  Evidence,
  HttpClient,
  NonEmptyArray,
  Provenance,
  ProviderAttempt,
  RecentRun,
  RunEmpty,
  RunError,
  RunRequest,
  RunResult,
  RunSuccess,
  RunSummary,
  SearchFn,
  SecretResolver,
  Source,
  SourceContext,
  SourceHealth,
  SourceRequest,
  SrchStatus,
  StaticStrategy,
  StrategyContext,
  StrategyRequest
} from "./sdk/types.js";

export {
  searchFlights,
  resolveFlightLocation,
  summarizeOffer,
  type FliFlightSearchOptions,
  type FlightOffer,
  type FlightSearchResult
} from "./lib/flights/fli.js";
