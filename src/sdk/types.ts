import type { TraceEvent, TraceSink } from "../lib/trace.js";

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

export type AnySource = Source<SourceRequest, unknown>;

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
