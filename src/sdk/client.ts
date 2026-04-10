import { createSourceContext, resolveSources, type CreateClientOptions } from "./config.js";
import { SourceRegistry } from "./registry.js";
import type { AnySource, Evidence, Source, SourceRequest, SrchStatus } from "./types.js";

export type ClientSearch = {
  <TRequest extends SourceRequest, TPayload>(
    source: Source<TRequest, TPayload>,
    req: TRequest
  ): Promise<Evidence<TPayload>[]>;
  (sourceName: string, req: SourceRequest): Promise<Evidence[]>;
};

export type SrchClient = {
  search: ClientSearch;
  status: () => Promise<SrchStatus>;
  registry: {
    sources: SourceRegistry;
  };
};

function toNonEmpty(items: string[]): [string, ...string[]] {
  if (items.length === 0) throw new Error("At least one domain required");
  return [items[0], ...items.slice(1)];
}

export function createClient(options: CreateClientOptions = {}): SrchClient {
  const registry = new SourceRegistry(resolveSources(options));
  const context = createSourceContext(options);

  const search = (async (sourceOrName: string | AnySource, req: SourceRequest) => {
    const source = typeof sourceOrName === "string"
      ? registry.get(sourceOrName)
      : sourceOrName;
    return source.run(req as never, context);
  }) as ClientSearch;

  return {
    search,
    async status() {
      const sources = registry.list().map((source) => ({ name: source.name, status: "healthy" as const }));
      const domains = [...new Set(registry.list().map((source) => source.domain))].sort();

      return {
        domains: toNonEmpty(domains),
        sources,
        summary: { healthy: sources.length, total: sources.length },
        recentRuns: []
      };
    },
    registry: {
      sources: registry
    }
  };
}
