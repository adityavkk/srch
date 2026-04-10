import { resolveSecret } from "../lib/core/secrets.js";
import { createTraceSink } from "../lib/trace.js";
import { exaSource } from "./sources/exa.js";
import type { AnySource, HttpClient, SecretResolver, SourceContext } from "./types.js";

export type CreateClientOptions = {
  trace?: boolean;
  http?: HttpClient;
  secrets?: SecretResolver;
  sources?: AnySource[];
};

const defaultSecrets: SecretResolver = {
  resolve(name) {
    return resolveSecret(name as never);
  }
};

const defaultHttp: HttpClient = {
  fetch: globalThis.fetch.bind(globalThis)
};

export function createSourceContext(options: CreateClientOptions = {}): SourceContext {
  return {
    secrets: options.secrets ?? defaultSecrets,
    trace: createTraceSink(options.trace ?? false),
    http: options.http ?? defaultHttp
  };
}

export function resolveSources(options: CreateClientOptions = {}): AnySource[] {
  if (options.sources) {
    if (options.sources.length === 0) throw new Error("createClient requires at least one source");
    return [...options.sources];
  }

  return [exaSource];
}
