import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { resolveSecret } from "../lib/core/secrets.js";
import type { SecretField } from "../lib/core/config.js";
import { createTraceSink } from "../lib/trace.js";
import type { AgentAdapter } from "./agent.js";
import { coreModule } from "./modules/core.js";
import type { AnySource, AnyStrategy, Domain, HttpClient, Module, SecretResolver, SourceContext, SrchConfig } from "./types.js";

export type CreateClientOptions = {
  trace?: boolean;
  http?: HttpClient;
  secrets?: SecretResolver;
  sources?: AnySource[];
  strategies?: AnyStrategy[];
  domains?: Domain[];
  config?: SrchConfig;
  agentAdapters?: AgentAdapter[];
};

export type LoadConfigOptions = {
  cwd?: string;
  path?: string;
};

const CONFIG_FILENAMES = [
  "srch.config.ts",
  "srch.config.mts",
  "srch.config.js",
  "srch.config.mjs"
] as const;

const SECRET_FIELDS = new Set<SecretField>([
  "exaApiKey",
  "perplexityApiKey",
  "geminiApiKey",
  "braveApiKey",
  "seatsAeroApiKey"
]);

function isSecretField(name: string): name is SecretField {
  return SECRET_FIELDS.has(name as SecretField);
}

const defaultSecrets: SecretResolver = {
  resolve(name) {
    if (!isSecretField(name)) return Promise.resolve(null);
    return resolveSecret(name);
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

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of items) byName.set(item.name, item);
  return [...byName.values()];
}

export function expandModules(modules: Module[]): Pick<Required<SrchConfig>, "sources" | "strategies" | "domains"> {
  return {
    sources: modules.flatMap((module) => module.sources),
    strategies: modules.flatMap((module) => module.strategies),
    domains: modules.flatMap((module) => module.domains)
  };
}

export function resolveConfig(options: CreateClientOptions = {}): Required<Pick<SrchConfig, "sources" | "strategies" | "domains">> & { defaults?: SrchConfig["defaults"] } {
  const config = options.config;
  const modules = config?.modules ?? [coreModule];
  const expanded = expandModules(modules);

  const configSources = dedupeByName([...expanded.sources, ...(config?.sources ?? [])]);
  const configStrategies = dedupeByName([...expanded.strategies, ...(config?.strategies ?? [])]);
  const configDomains = dedupeByName([...expanded.domains, ...(config?.domains ?? [])]);

  const sources = options.sources ? [...options.sources] : configSources;
  const strategies = options.strategies ? [...options.strategies] : configStrategies;
  const domains = options.domains ? [...options.domains] : configDomains;

  const sourceNames = new Set(sources.map((source) => source.name));
  const strategyNames = new Set(strategies.map((strategy) => strategy.name));
  const actionableDomains = domains.filter((domain) => (
    strategyNames.has(domain.defaultStrategy)
    && domain.sources.some((sourceName) => sourceNames.has(sourceName))
  ));

  if (sources.length === 0) throw new Error("createClient requires at least one source");
  if (strategies.length === 0) throw new Error("createClient requires at least one strategy");
  if (actionableDomains.length === 0) throw new Error("createClient requires at least one actionable domain");

  return {
    sources: [...sources],
    strategies: [...strategies],
    domains: actionableDomains,
    defaults: config?.defaults
  };
}

export function findConfigPath(startDir = process.cwd()): string | null {
  let current = resolve(startDir);

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(current, filename);
      if (existsSync(candidate)) return candidate;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function unwrapDefault(value: unknown): unknown {
  let current = value;

  while (current && typeof current === "object") {
    const record = current as Record<string, unknown>;
    if ("default" in record) {
      current = record.default;
      continue;
    }
    if ("config" in record) {
      current = record.config;
      continue;
    }
    break;
  }

  return current;
}

function normalizeImportedConfig(module: unknown, filePath: string): SrchConfig {
  const candidate = unwrapDefault(module);

  if (!candidate || typeof candidate !== "object") {
    throw new Error(`Config ${filePath} must export an object or default object`);
  }

  return candidate as SrchConfig;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<SrchConfig | null> {
  const filePath = options.path ?? findConfigPath(options.cwd);
  if (!filePath) return null;

  const imported = await tsImport(pathToFileURL(filePath).href, import.meta.url);
  return normalizeImportedConfig(imported, filePath);
}
