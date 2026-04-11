import { piMonoAgentAdapter } from "./adapters/pi-mono.js";
import type { AgentAdapter, AgenticStrategyContext } from "./agent.js";
import { resolveConfig, createSourceContext, type CreateClientOptions } from "./config.js";
import { DomainRegistry } from "./domain.js";
import { merge } from "./operators.js";
import { SourceRegistry } from "./registry.js";
import { StrategyRegistry } from "./strategy.js";
import type {
  AnySource,
  RunRequest,
  RunResult,
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

export type ClientRun = {
  (req: { domain: "web" } & WebStrategyRequest): Promise<RunResult<WebEvidencePayload>>;
  (req: { domain: "code" } & CodeStrategyRequest): Promise<RunResult<CodeTextEvidencePayload>>;
  (req: { domain: "docs" } & DocsStrategyRequest): Promise<RunResult<DocsEvidencePayload>>;
  (req: { domain: "fetch" } & RunRequest): Promise<RunResult<FetchEvidencePayload>>;
  (req: { domain: "social" } & SocialStrategyRequest): Promise<RunResult<BirdEvidencePayload>>;
  (req: { domain: "flights" } & FlightsStrategyRequest): Promise<RunResult<FliEvidencePayload>>;
  (req: { domain: "rewards-flights" } & RewardsStrategyRequest): Promise<RunResult<SeatsAeroEvidencePayload>>;
  <TRequest extends RunRequest>(req: TRequest): Promise<RunResult>;
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

function makeError(req: RunRequest, code: string, message: string): RunResult {
  return {
    kind: "error",
    domain: req.domain,
    strategy: req.strategy ?? "unknown",
    error: { code, message },
    trace: [],
    suggestions: ["Run `search --help` for usage", `Run \`search ${req.domain} \"query\"\``]
  };
}

function validateDomainReferences(domains: DomainRegistry, strategies: StrategyRegistry): void {
  for (const domain of domains.list()) {
    strategies.get(domain.defaultStrategy);
  }
}

export function createClient(options: CreateClientOptions = {}): SrchClient {
  const resolved = resolveConfig(options);
  const sources = new SourceRegistry(resolved.sources);
  const strategies = new StrategyRegistry(resolved.strategies);
  const domains = new DomainRegistry(resolved.domains);
  const agentAdapters = new Map<string, AgentAdapter>((options.agentAdapters ?? [piMonoAgentAdapter]).map((adapter) => [adapter.name, adapter]));
  validateDomainReferences(domains, strategies);

  const search = (async (sourceOrName: string | AnySource, req: SourceRequest) => {
    const source = typeof sourceOrName === "string"
      ? sources.get(sourceOrName)
      : sourceOrName;

    return source.run(req as never, createSourceContext(options));
  }) as ClientSearch;

  const run = (async (req: RunRequest) => {
      let domain;
      try {
        domain = domains.get(req.domain);
      } catch (error) {
        return makeError(req, "unknown_domain", error instanceof Error ? error.message : String(error));
      }

      const strategyName = req.strategy ?? resolved.defaults?.strategy ?? domain.defaultStrategy;

      let strategy;
      try {
        strategy = strategies.get(strategyName);
      } catch (error) {
        return makeError(req, "unknown_strategy", error instanceof Error ? error.message : String(error));
      }

      const context = createSourceContext(options);
      const strategySearch = (async (sourceOrName: string | AnySource, sourceReq: SourceRequest) => {
        const source = typeof sourceOrName === "string"
          ? sources.get(sourceOrName)
          : sourceOrName;

        return source.run(sourceReq as never, context);
      }) as SearchFn;

      const strategyContext: StrategyContext = {
        ...context,
        sources,
        strategies,
        search: strategySearch,
        merge
      };

      const result = strategy.kind === "agentic"
        ? await (() => {
            const agent = agentAdapters.get(strategy.adapter);
            if (!agent) {
              return Promise.resolve(makeError(req, "unknown_agent_adapter", `Unknown agent adapter: ${strategy.adapter}`));
            }
            const agenticContext: AgenticStrategyContext = { ...strategyContext, agent };
            return strategy.run(req as never, agenticContext);
          })()
        : await strategy.run(req as never, strategyContext);
      return { ...result, trace: context.trace.snapshot() };
    }) as ClientRun;

  return {
    search,
    run,
    async status() {
      const sourceStatus = sources.list().map((source) => ({ name: source.name, status: "healthy" as const }));
      const domainNames = domains.list().map((domain) => domain.name).sort();

      return {
        domains: toNonEmpty(domainNames),
        sources: sourceStatus,
        summary: { healthy: sourceStatus.length, total: sourceStatus.length },
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
