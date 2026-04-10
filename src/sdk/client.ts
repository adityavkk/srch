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

export type ClientSearch = SearchFn;

export type SrchClient = {
  search: ClientSearch;
  run: (req: RunRequest) => Promise<RunResult>;
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
  validateDomainReferences(domains, strategies);

  const search = (async (sourceOrName: string | AnySource, req: SourceRequest) => {
    const source = typeof sourceOrName === "string"
      ? sources.get(sourceOrName)
      : sourceOrName;

    return source.run(req as never, createSourceContext(options));
  }) as ClientSearch;

  return {
    search,
    async run(req) {
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

      const result = await strategy.run(req as never, strategyContext);
      return { ...result, trace: context.trace.snapshot() };
    },
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
