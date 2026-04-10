export { createClient, type ClientSearch, type SrchClient } from "./sdk/client.js";
export { loadConfig, findConfigPath, resolveConfig, type CreateClientOptions, type LoadConfigOptions } from "./sdk/config.js";
export { defineConfig, defineDomain, defineModule, defineSource, defineStrategy } from "./sdk/define.js";
export { DomainRegistry } from "./sdk/domain.js";
export { defineModule as createModule } from "./sdk/define.js";
export { merge, dedupe, sort, filter } from "./sdk/operators.js";
export { SourceRegistry } from "./sdk/registry.js";
export { StrategyRegistry } from "./sdk/strategy.js";
export {
  birdSource,
  type BirdEvidencePayload,
  type BirdSourceRequest
} from "./sdk/sources/bird.js";
export {
  braveSource,
  type BraveEvidencePayload
} from "./sdk/sources/brave.js";
export {
  context7Source,
  type Context7EvidencePayload
} from "./sdk/sources/context7.js";
export {
  deepwikiSource,
  type DeepWikiEvidencePayload
} from "./sdk/sources/deepwiki.js";
export {
  docsQmdSource,
  type DocsEvidencePayload,
  type DocsSourceRequest
} from "./sdk/sources/docs-qmd.js";
export {
  exaCodeSource,
  type CodeTextEvidencePayload,
  type ExaCodeEvidencePayload,
  type ExaCodeSourceRequest
} from "./sdk/sources/exa-code.js";
export {
  fetchContentSource,
  type FetchEvidencePayload
} from "./sdk/sources/fetch-content.js";
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
export { codeDomain } from "./sdk/domains/code.js";
export { docsDomain } from "./sdk/domains/docs.js";
export { fetchDomain } from "./sdk/domains/fetch.js";
export { socialDomain } from "./sdk/domains/social.js";
export { webDomain } from "./sdk/domains/web.js";
export { coreModule } from "./sdk/modules/core.js";
export {
  codeDefaultStrategy,
  type CodeStrategyRequest
} from "./sdk/strategies/code-default.js";
export {
  docsDefaultStrategy,
  type DocsStrategyRequest
} from "./sdk/strategies/docs-default.js";
export { fetchDefaultStrategy } from "./sdk/strategies/fetch-default.js";
export {
  socialDefaultStrategy,
  type SocialStrategyRequest
} from "./sdk/strategies/social-default.js";
export {
  webDefaultStrategy,
  createWebDefaultStrategy,
  type WebStrategyDeps,
  type WebStrategyRequest
} from "./sdk/strategies/web-default.js";
export type {
  AnySource,
  AnyStrategy,
  Domain,
  Evidence,
  HttpClient,
  Module,
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
  SrchConfig,
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
