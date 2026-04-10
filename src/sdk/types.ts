import type { TraceEvent, TraceSink } from "../lib/trace.js";
import type { BirdEvidencePayload, BirdSourceRequest } from "./sources/bird.js";
import type { Context7EvidencePayload } from "./sources/context7.js";
import type { DeepWikiEvidencePayload } from "./sources/deepwiki.js";
import type { DocsEvidencePayload, DocsSourceRequest } from "./sources/docs-qmd.js";
import type { ExaCodeEvidencePayload, ExaCodeSourceRequest } from "./sources/exa-code.js";
import type { ExaEvidencePayload, ExaSourceRequest } from "./sources/exa.js";
import type { FetchEvidencePayload } from "./sources/fetch-content.js";
import type { FliEvidencePayload, FliSourceRequest } from "./sources/fli.js";
import type { GeminiEvidencePayload, GeminiSourceRequest } from "./sources/gemini.js";
import type { PerplexityEvidencePayload } from "./sources/perplexity.js";
import type { SeatsAeroEvidencePayload, SeatsAeroSourceRequest } from "./sources/seats-aero.js";
import type { AgenticStrategy } from "./agent.js";
import type { BraveEvidencePayload } from "./sources/brave.js";

export type NonEmptyArray<T> = [T, ...T[]];

export type Provenance =
  | { kind: "web"; url: string; transport: string; timestamp: number; cached: boolean }
  | { kind: "api"; api: string; transport: string; timestamp: number; cached: boolean }
  | { kind: "local"; path: string; timestamp: number }
  | { kind: "clone"; repo: string; localPath: string; timestamp: number; cached: boolean };

export type Evidence<T = unknown> = {
  source: string;
  domain: string;
  query: string;
  provenance: Provenance;
  payload: T;
};

export type ProviderAttempt =
  | { provider: string; status: "success"; transport: string; durationMs: number; evidenceCount: number }
  | { provider: string; status: "skipped"; reason: string }
  | { provider: string; status: "failed"; error: string; durationMs: number };

export type RunSummary = {
  totalEvidence: number;
  sourceBreakdown: Record<string, number>;
  attempts: NonEmptyArray<ProviderAttempt>;
  durationMs: number;
};

export type RunSuccess<T = unknown> = {
  kind: "success";
  domain: string;
  strategy: string;
  evidence: NonEmptyArray<Evidence<T>>;
  summary: RunSummary;
  trace: TraceEvent[];
  suggestions?: string[];
};

export type RunEmpty = {
  kind: "empty";
  domain: string;
  strategy: string;
  summary: RunSummary;
  trace: TraceEvent[];
  suggestions: NonEmptyArray<string>;
};

export type RunError = {
  kind: "error";
  domain: string;
  strategy: string;
  error: { message: string; code: string };
  trace: TraceEvent[];
  suggestions: NonEmptyArray<string>;
};

export type RunResult<T = unknown> = RunSuccess<T> | RunEmpty | RunError;

export type SourceRequest = {
  query: string;
  signal?: AbortSignal;
};

export interface SecretResolver {
  resolve(name: string): Promise<string | null>;
}

export interface HttpClient {
  fetch: typeof fetch;
}

export type SourceContext = {
  secrets: SecretResolver;
  trace: TraceSink;
  http: HttpClient;
};

export type Source<
  TRequest extends SourceRequest = SourceRequest,
  TPayload = unknown
> = {
  name: string;
  domain: string;
  capabilities: NonEmptyArray<string>;
  traits: string[];
  transports: NonEmptyArray<string>;
  run: (req: TRequest, ctx: SourceContext) => Promise<Evidence<TPayload>[]>;
};

export type AnySource = Source<any, unknown>;

export type StrategyRequest = {
  query: string;
  target?: string;
  signal?: AbortSignal;
};

export type RunRequest = StrategyRequest & {
  domain: string;
  strategy?: string;
};

export type SearchFn = {
  <TRequest extends SourceRequest, TPayload>(
    source: Source<TRequest, TPayload>,
    req: TRequest
  ): Promise<Evidence<TPayload>[]>;
  (sourceName: "bird", req: BirdSourceRequest): Promise<Evidence<BirdEvidencePayload>[]>;
  (sourceName: "brave", req: import("./sources/web-shared.js").WebSourceRequest): Promise<Evidence<BraveEvidencePayload>[]>;
  (sourceName: "context7", req: SourceRequest): Promise<Evidence<Context7EvidencePayload>[]>;
  (sourceName: "deepwiki", req: SourceRequest): Promise<Evidence<DeepWikiEvidencePayload>[]>;
  (sourceName: "docs-qmd", req: DocsSourceRequest): Promise<Evidence<DocsEvidencePayload>[]>;
  (sourceName: "exa", req: ExaSourceRequest): Promise<Evidence<ExaEvidencePayload>[]>;
  (sourceName: "exa-code", req: ExaCodeSourceRequest): Promise<Evidence<ExaCodeEvidencePayload>[]>;
  (sourceName: "fetch-content", req: SourceRequest): Promise<Evidence<FetchEvidencePayload>[]>;
  (sourceName: "fli", req: FliSourceRequest): Promise<Evidence<FliEvidencePayload>[]>;
  (sourceName: "gemini", req: GeminiSourceRequest): Promise<Evidence<GeminiEvidencePayload>[]>;
  (sourceName: "perplexity", req: import("./sources/web-shared.js").WebSourceRequest): Promise<Evidence<PerplexityEvidencePayload>[]>;
  (sourceName: "seats-aero", req: SeatsAeroSourceRequest): Promise<Evidence<SeatsAeroEvidencePayload>[]>;
  (sourceName: string, req: SourceRequest): Promise<Evidence[]>;
};

export type StrategyContext = SourceContext & {
  sources: {
    get(name: string): AnySource;
    list(): AnySource[];
  };
  strategies: {
    get(name: string): AnyStrategy;
    list(): AnyStrategy[];
  };
  search: SearchFn;
  merge: (...results: Evidence[][]) => Evidence[];
};

export type StaticStrategy<
  TRequest extends StrategyRequest = StrategyRequest,
  TResult extends RunResult = RunResult
> = {
  kind: "static";
  name: string;
  domain: string;
  run: (req: TRequest, ctx: StrategyContext) => Promise<TResult>;
};

export type AnyStrategy =
  | StaticStrategy<StrategyRequest, RunResult>
  | AgenticStrategy<StrategyRequest, RunResult>;

export type Domain = {
  name: string;
  defaultStrategy: string;
  strategies: NonEmptyArray<string>;
  sources: NonEmptyArray<string>;
  capabilities: NonEmptyArray<string>;
  subdomains: string[];
};

export type Module = {
  name: string;
  sources: AnySource[];
  strategies: AnyStrategy[];
  domains: Domain[];
};

export type SrchConfig = {
  sources?: AnySource[];
  strategies?: AnyStrategy[];
  domains?: Domain[];
  modules?: Module[];
  defaults?: {
    domain?: string;
    strategy?: string;
  };
};

export type SourceHealth =
  | { name: string; status: "healthy" }
  | { name: string; status: "unavailable"; reason: string };

export type RecentRun = {
  domain: string;
  query: string;
  ago: string;
};

export type SrchStatus = {
  domains: NonEmptyArray<string>;
  sources: SourceHealth[];
  summary: { healthy: number; total: number };
  recentRuns: RecentRun[];
};
