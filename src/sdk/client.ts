import { createSourceContext, resolveSources, type CreateClientOptions } from "./config.js";
import { merge } from "./operators.js";
import { SourceRegistry } from "./registry.js";
import { webDefaultStrategy } from "./strategies/web-default.js";
import { StrategyRegistry } from "./strategy.js";
import type {
  AnySource,
  AnyStrategy,
  Evidence,
  RunRequest,
  RunResult,
  SearchFn,
  Source,
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
  };
};

function toNonEmpty(items: string[]): [string, ...string[]] {
  if (items.length === 0) throw new Error("At least one domain required");
  return [items[0], ...items.slice(1)];
}

function defaultStrategyFor(domain: string): string | null {
  if (domain === "web") return "web/default";
  return null;
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

export function createClient(options: CreateClientOptions = {}): SrchClient {
  const sources = new SourceRegistry(resolveSources(options));
  const strategies = new StrategyRegistry(options.strategies ?? [webDefaultStrategy as AnyStrategy]);

  const search = (async (sourceOrName: string | AnySource, req: SourceRequest) => {
    const source = typeof sourceOrName === "string"
      ? sources.get(sourceOrName)
      : sourceOrName;

    return source.run(req as never, createSourceContext(options));
  }) as ClientSearch;

  return {
    search,
    async run(req) {
      const strategyName = req.strategy ?? defaultStrategyFor(req.domain);
      if (!strategyName) return makeError(req, "unknown_domain", `No default strategy for domain: ${req.domain}`);

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
      const domains = [...new Set(sources.list().map((source) => source.domain))].sort();

      return {
        domains: toNonEmpty(domains),
        sources: sourceStatus,
        summary: { healthy: sourceStatus.length, total: sourceStatus.length },
        recentRuns: []
      };
    },
    registry: {
      sources,
      strategies
    }
  };
}
