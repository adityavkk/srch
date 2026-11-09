import { piMonoAgentAdapter } from "./adapters/pi-mono.js";
import type { AgentAdapter, AgenticStrategyContext } from "./agent.js";
import { resolveConfig, createSourceContext, type CreateClientOptions } from "./config.js";
import { DomainRegistry } from "./domain.js";
import { merge } from "./operators.js";
import { SourceRegistry } from "./registry.js";
import { StrategyRegistry } from "./strategy.js";
import type {
  AnySource,
  ProviderAttempt,
  RunError,
  RunRequest,
  RunResult,
  RunSummary,
  SearchFn,
  SourceRequest,
  SrchStatus,
  StrategyContext
} from "./types.js";
import type { CodeStrategyRequest } from "./strategies/code-default.js";
import type { DocsStrategyRequest } from "./strategies/docs-default.js";
import type { FlightsStrategyRequest } from "./strategies/flights-default.js";
import type { RewardsStrategyRequest } from "./strategies/rewards-default.js";
import type { SocialStrategyRequest } from "./strategies/social-default.js";
import type { WebStrategyRequest } from "./strategies/web-default.js";
import type { WebEvidencePayload } from "./sources/web-shared.js";
import type { CodeTextEvidencePayload } from "./sources/exa-code.js";
import type { DocsEvidencePayload } from "./sources/docs-qmd.js";
import type { FetchEvidencePayload } from "./sources/fetch-content.js";
import type { BirdEvidencePayload } from "./sources/bird.js";
import type { FliEvidencePayload } from "./sources/fli.js";
import type { SeatsAeroEvidencePayload } from "./sources/seats-aero.js";

export type ClientSearch = SearchFn;

type BuiltinDomain = "web" | "code" | "docs" | "fetch" | "social" | "flights" | "rewards-flights";
type DomainRunRequest<TDomain extends string> = { domain: TDomain; strategy?: string };

export type ClientRun = {
  (req: DomainRunRequest<"web"> & WebStrategyRequest): Promise<RunResult<WebEvidencePayload>>;
  (req: DomainRunRequest<"code"> & CodeStrategyRequest): Promise<RunResult<CodeTextEvidencePayload>>;
  (req: DomainRunRequest<"docs"> & DocsStrategyRequest): Promise<RunResult<DocsEvidencePayload>>;
  (req: DomainRunRequest<"fetch"> & RunRequest): Promise<RunResult<FetchEvidencePayload>>;
  (req: DomainRunRequest<"social"> & SocialStrategyRequest): Promise<RunResult<BirdEvidencePayload>>;
  (req: DomainRunRequest<"flights"> & FlightsStrategyRequest): Promise<RunResult<FliEvidencePayload>>;
  (req: DomainRunRequest<"rewards-flights"> & RewardsStrategyRequest): Promise<RunResult<SeatsAeroEvidencePayload>>;
  <const TRequest extends RunRequest>(req: TRequest & (
    Extract<BuiltinDomain, TRequest["domain"]> extends never ? unknown : never
  )): Promise<RunResult>;
};

export type SrchClient = {
  search: ClientSearch;
  run: ClientRun;
  status: () => Promise<SrchStatus>;
  registry: {
    sources: SourceRegistry;
    strategies: StrategyRegistry;
    domains: DomainRegistry;
  };
};

function toNonEmpty(items: string[]): [string, ...string[]] {
  if (items.length === 0) throw new Error("At least one domain required");
  return [items[0], ...items.slice(1)];
}

function makeError(req: RunRequest, code: string, message: string): RunError {
  return {
    kind: "error",
    domain: req.domain,
    strategy: req.strategy ?? "unknown",
    error: { code, message },
    trace: [],
    suggestions: ["Run `search --help` for usage", `Run \`search ${req.domain} \"query\"\``]
  };
}

function resultProblem(result: RunResult, domain: string, strategy: string): string | undefined {
  if (!result || !["success", "empty", "error"].includes(result.kind)) return "Strategy returned an unknown result kind";
  if (result.domain !== domain || result.strategy !== strategy) return "Strategy returned a result for a different domain or strategy";
  if (result.kind === "success" && (!Array.isArray(result.evidence) || result.evidence.length === 0
    || result.evidence.some((item) => !item || typeof item !== "object" || item.domain !== domain
      || typeof item.source !== "string" || typeof item.query !== "string" || !item.provenance || !("payload" in item)))) {
    return "Successful results must contain nonempty, valid evidence";
  }
  if (result.kind !== "error" && (!result.summary || !Array.isArray(result.summary.attempts)
    || result.summary.attempts.length === 0 || result.summary.attempts.some((attempt) => !attempt)
    || result.summary.totalEvidence !== (result.kind === "success" ? result.evidence.length : 0))) {
    return "Result summary must describe its evidence and provider attempts";
  }
  if (result.kind === "error" && (!result.error || typeof result.error.code !== "string" || typeof result.error.message !== "string")) {
    return "Error results must contain an error code and message";
  }
  return undefined;
}

// Stop waiting for noncooperative adapters without claiming their work stopped.
function abortable<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const pending = operation();
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    pending.then(
      (value) => { signal.removeEventListener("abort", aborted); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", aborted); reject(error); }
    );
  });
}

export function createClient(options: CreateClientOptions = {}): SrchClient {
  const resolved = resolveConfig(options);
  const sources = new SourceRegistry(resolved.sources);
  const strategies = new StrategyRegistry(resolved.strategies);
  const domains = new DomainRegistry(resolved.domains);
  const agentAdapters = new Map<string, AgentAdapter>((options.agentAdapters ?? [piMonoAgentAdapter]).map((adapter) => [adapter.name, adapter]));

  const search = (async (sourceOrName: string | AnySource, req: SourceRequest) => {
    const source = typeof sourceOrName === "string"
      ? sources.get(sourceOrName)
      : sourceOrName;

    return abortable(() => source.run(req as never, createSourceContext(options)), req.signal);
  }) as ClientSearch;

  const run = (async (req: RunRequest) => {
      let domain;
      try {
        domain = domains.get(req.domain);
      } catch (error) {
        return makeError(req, "unknown_domain", error instanceof Error ? error.message : String(error));
      }

      const strategyName = req.strategy ?? resolved.defaults?.strategy ?? domain.defaultStrategy;
      const selectedRequest = { ...req, strategy: strategyName };

      let strategy;
      try {
        strategy = strategies.get(strategyName);
      } catch (error) {
        return makeError(selectedRequest, "unknown_strategy", error instanceof Error ? error.message : String(error));
      }
      if (strategy.domain !== domain.name || !domain.strategies.includes(strategyName)) {
        return makeError(selectedRequest, "invalid_strategy", `Strategy ${strategyName} is not registered for domain ${domain.name}`);
      }

      const context = createSourceContext(options);
      const startedAt = Date.now();
      const attempts: ProviderAttempt[] = [];
      const activeAttempts = new Set<{ provider: string; startedAt: number }>();
      const strategySearch = (async (sourceOrName: string | AnySource, sourceReq: SourceRequest) => {
        const provider = typeof sourceOrName === "string" ? sourceOrName : sourceOrName.name;
        const attemptStarted = Date.now();
        const active = { provider, startedAt: attemptStarted };
        activeAttempts.add(active);
        try {
          const source = typeof sourceOrName === "string" ? sources.get(sourceOrName) : sourceOrName;
          const signal = req.signal && sourceReq.signal && req.signal !== sourceReq.signal
            ? AbortSignal.any([req.signal, sourceReq.signal]) : req.signal ?? sourceReq.signal;
          const evidence = await abortable(() => source.run({ ...sourceReq, signal } as never, context), signal);
          const provenance = evidence[0]?.provenance;
          const transport = provenance && "transport" in provenance ? provenance.transport : source.transports[0];
          attempts.push({ provider, status: "success", transport, durationMs: Date.now() - attemptStarted, evidenceCount: evidence.length });
          return evidence;
        } catch (error) {
          attempts.push({ provider, status: "failed", error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - attemptStarted });
          throw error;
        } finally {
          activeAttempts.delete(active);
        }
      }) as SearchFn;

      const strategyContext: StrategyContext = {
        ...context,
        sources,
        strategies,
        search: strategySearch,
        merge
      };

      let result: RunResult | undefined;
      let failure: unknown;
      try {
        req.signal?.throwIfAborted();
        if (strategy.kind === "agentic") {
          const agent = agentAdapters.get(strategy.adapter);
          if (!agent) {
            result = makeError(selectedRequest, "unknown_agent_adapter", `Unknown agent adapter: ${strategy.adapter}`);
          } else {
            const agenticContext: AgenticStrategyContext = { ...strategyContext, agent };
            result = await abortable(() => strategy.run(req as never, agenticContext), req.signal);
          }
        } else {
          result = await abortable(() => strategy.run(req as never, strategyContext), req.signal);
        }
      } catch (error) {
        failure = error;
      }

      const reason = req.signal?.aborted ? req.signal.reason : failure;
      const cancelled = req.signal?.aborted || reason instanceof Error && ["AbortError", "TimeoutError"].includes(reason.name);
      const observedAttempts: ProviderAttempt[] = [...attempts, ...(cancelled ? [...activeAttempts].map((attempt): ProviderAttempt => ({
        provider: attempt.provider, status: "failed", error: "Search was cancelled", durationMs: Date.now() - attempt.startedAt
      })) : [])];
      const observedSummary: RunSummary | undefined = observedAttempts.length > 0 ? {
        totalEvidence: 0, sourceBreakdown: {}, attempts: [observedAttempts[0]!, ...observedAttempts.slice(1)], durationMs: Date.now() - startedAt
      } : undefined;
      const trace = [...new Set([...context.trace.snapshot(), ...(Array.isArray(result?.trace) ? result.trace : [])])];
      const fail = (code: string, message: string, summary = result?.summary ?? observedSummary): RunResult => ({
        ...makeError(selectedRequest, code, message), summary, trace
      });
      if (cancelled) {
        const timedOut = reason instanceof Error && reason.name === "TimeoutError";
        return fail(timedOut ? "timeout" : "aborted", timedOut ? "Search exceeded its time limit" : "Search was cancelled");
      }
      if (!result) return fail("strategy_failed", failure instanceof Error ? failure.message : failure === undefined ? "Strategy returned no result" : String(failure));
      const problem = resultProblem(result, domain.name, strategyName);
      if (problem) return fail("invalid_result", problem, observedSummary);
      return { ...result, ...(result.kind === "error" && !result.summary && observedSummary ? { summary: observedSummary } : {}), trace };
    }) as ClientRun;

  return {
    search,
    run,
    async status() {
      const sourceStatus = sources.list().map((source) => ({ name: source.name, status: "untested" as const }));
      const domainNames = domains.list().map((domain) => domain.name).sort();

      return {
        domains: toNonEmpty(domainNames),
        sources: sourceStatus,
        summary: { healthy: 0, untested: sourceStatus.length, total: sourceStatus.length },
        recentRuns: []
      };
    },
    registry: {
      sources,
      strategies,
      domains
    }
  };
}
