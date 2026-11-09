import type { SearchOptions, SearchProvider, SearchResult } from "../core/types.js";

export const SEARCH_PROVIDERS = ["auto", "exa", "brave", "gemini", "perplexity"] as const satisfies readonly SearchProvider[];
export const DEFAULT_WEB_TIMEOUT_MS = 30_000;
const RECENCY_DAYS = { day: 1, week: 7, month: 31, year: 365 } as const;
export const BRAVE_FRESHNESS = { day: "pd", week: "pw", month: "pm", year: "py" } as const;
export type WebTransport = "exa-mcp" | "exa-api" | "brave-search-api" | "gemini-web" | "gemini-api" | "perplexity-api";

export class WebOptionsError extends Error {
  constructor(readonly code: "invalid_request" | "unsupported_option", message: string) {
    super(message);
    this.name = "WebOptionsError";
  }
}

export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === "string" && SEARCH_PROVIDERS.some((provider) => provider === value);
}

export function validateWebOptions(options: SearchOptions & { query?: unknown; provider?: unknown; hq?: unknown; timeoutMs?: number }): void {
  if (options.query !== undefined && (typeof options.query !== "string" || !options.query.trim())) {
    throw new WebOptionsError("invalid_request", "Query must be a non-empty string");
  }
  if (options.provider !== undefined && !isSearchProvider(options.provider)) {
    throw new WebOptionsError("invalid_request", `Invalid provider. Use ${SEARCH_PROVIDERS.join("|")}`);
  }
  if (options.hq !== undefined && typeof options.hq !== "boolean") {
    throw new WebOptionsError("invalid_request", "hq must be a boolean");
  }
  if (options.hq && options.provider !== undefined && options.provider !== "auto" && options.provider !== "exa" && options.provider !== "gemini") {
    throw new WebOptionsError("unsupported_option", `hq is not supported by ${options.provider}`);
  }
  if (options.numResults !== undefined && (!Number.isInteger(options.numResults) || options.numResults < 1 || options.numResults > 100)) {
    throw new WebOptionsError("invalid_request", "numResults must be an integer from 1 to 100");
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300_000)) {
    throw new WebOptionsError("invalid_request", "timeoutMs must be an integer from 1 to 300000");
  }
  if (options.recencyFilter !== undefined && !Object.hasOwn(RECENCY_DAYS, options.recencyFilter)) {
    throw new WebOptionsError("invalid_request", "recencyFilter must be day, week, month, or year");
  }
  if (options.includeContent !== undefined && typeof options.includeContent !== "boolean") {
    throw new WebOptionsError("invalid_request", "includeContent must be a boolean");
  }
  if (options.domainFilter !== undefined) {
    if (!Array.isArray(options.domainFilter) || options.domainFilter.length > 100) {
      throw new WebOptionsError("invalid_request", "domainFilter must be an array of at most 100 hostnames");
    }
    for (const value of options.domainFilter) {
      const domain = typeof value === "string" ? value.replace(/^-/, "") : "";
      if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(domain)) {
        throw new WebOptionsError("invalid_request", "domainFilter entries must be bare hostnames, optionally prefixed with - to exclude them");
      }
    }
  }
}

export function unsupportedWebOptions(transport: WebTransport, options: SearchOptions): string | null {
  if ((transport === "exa-mcp" || transport.startsWith("gemini-")) && (options.domainFilter?.length || options.recencyFilter)) {
    return `${transport} does not support domainFilter or recencyFilter`;
  }
  if (options.includeContent && transport !== "exa-mcp" && transport !== "exa-api") {
    return `${transport} does not support includeContent`;
  }
  if (transport === "brave-search-api" && (options.numResults ?? 5) > 20) {
    return "brave-search-api supports at most 20 results per request";
  }
  if (transport === "perplexity-api" && options.domainFilter?.length) {
    if (options.domainFilter.length > 20) return "perplexity-api supports at most 20 domain filters";
    const excluded = options.domainFilter.filter((domain) => domain.startsWith("-")).length;
    if (excluded > 0 && excluded < options.domainFilter.length) return "perplexity-api cannot combine included and excluded domains";
  }
  return null;
}

export function assertWebOptions(transport: WebTransport, options: SearchOptions & { query?: unknown }): void {
  validateWebOptions(options);
  const reason = unsupportedWebOptions(transport, options);
  if (reason) throw new WebOptionsError("unsupported_option", reason);
}

export function publishedAfter(recency: NonNullable<SearchOptions["recencyFilter"]>, now = Date.now()): string {
  return new Date(now - RECENCY_DAYS[recency] * 86_400_000).toISOString();
}

export function matchesDomainFilter(url: string, filters: string[] = []): boolean {
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  const includes = filters.filter((domain) => !domain.startsWith("-")).map((domain) => domain.toLowerCase());
  const excludes = filters.filter((domain) => domain.startsWith("-")).map((domain) => domain.slice(1).toLowerCase());
  return !excludes.some(matches) && (includes.length === 0 || includes.some(matches));
}

export function filterWebResults<T extends SearchResult>(results: T[], options: SearchOptions): T[] {
  return results.filter((result) => matchesDomainFilter(result.url, options.domainFilter)).slice(0, options.numResults ?? 5);
}

export function braveQuery(query: string, domains: string[] = []): string {
  const includes = domains.filter((domain) => !domain.startsWith("-"));
  const excludes = domains.filter((domain) => domain.startsWith("-"));
  return [
    query,
    ...(includes.length ? [`(${includes.map((domain) => `site:${domain}`).join(" OR ")})`] : []),
    ...excludes.map((domain) => `-site:${domain.slice(1)}`)
  ].join(" ");
}
