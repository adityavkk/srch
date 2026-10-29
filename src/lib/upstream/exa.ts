import { activityMonitor } from "../core/activity.js";
import { isRecord } from "../core/guards.js";
import { errorMessage, withTimeout } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";
import type { ExtractedContent, SearchOptions, SearchResponse, SearchResult } from "../core/types.js";
import { excerpt, parseExaFetchResults, parseExaSearchResults, type ExaFetchedPage, type ExaSearchHit } from "./exa-format.js";
import { callExaMcpRaw, exaMcpText, type ExaMcpResponse } from "./exa-mcp.js";

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const OBJECTIVE_MAX_CHARS = 4096;
const INLINE_FETCH_MAX_CHARS = 10_000;

export const EXA_SEARCH_TOOL = "web_search_exa";
export const EXA_FETCH_TOOL = "web_fetch_exa";
export const EXA_FETCH_MAX_CHARS = 50_000;

// Arguments follow the free MCP's tools/list schema. It no longer lists livecrawl, type or
// contextMaxCharacters, and Exa ignores them: a 500-character cap still returned ~6,700.
export type ExaSearchArguments = { query: string; numResults: number; objective: string };
export type ExaFetchArguments = { urls: string[]; maxCharacters: number };
export type ExaMcpRequest<TArguments> = { toolName: string; arguments: TArguments };

export type ExaInlineFetch =
  | { request: ExaMcpRequest<ExaFetchArguments>; response: ExaMcpResponse }
  | { request: ExaMcpRequest<ExaFetchArguments>; error: string };

export interface ExaSearchResult extends SearchResponse {
  native: {
    provider: "exa-api" | "exa-mcp";
    mode: "answer" | "search" | "mcp";
    request: Record<string, unknown>;
    response: unknown;
    fetch?: ExaInlineFetch;
  };
}

export interface ExaFetchResult {
  pages: ExaFetchedPage[];
  native: {
    provider: "exa-mcp";
    request: ExaMcpRequest<ExaFetchArguments>;
    response: ExaMcpResponse;
  };
}

async function getApiKey(): Promise<string | null> {
  return resolveSecret("exaApiKey");
}

export async function hasExaApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}

export function isExaAvailable(): boolean {
  return true;
}

export async function callExaMcp(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const response = await callExaMcpRaw(toolName, args, signal);
  return exaMcpText(response);
}

export function exaSearchArguments(query: string, options: SearchOptions = {}): ExaSearchArguments {
  return {
    query,
    numResults: options.numResults ?? 5,
    objective: (options.objective?.trim() || query).slice(0, OBJECTIVE_MAX_CHARS)
  };
}

export function exaFetchArguments(urls: string[], maxCharacters = EXA_FETCH_MAX_CHARS): ExaFetchArguments {
  return { urls, maxCharacters };
}

function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function withMetadata(result: SearchResult, metadata: { publishedDate?: string; author?: string }): SearchResult {
  return {
    ...result,
    ...(metadata.publishedDate ? { publishedDate: metadata.publishedDate } : {}),
    ...(metadata.author ? { author: metadata.author } : {})
  };
}

// Highlights feed the snippet; fetched page text, when present, becomes the inline content.
export function mapExaSearchHits(hits: ExaSearchHit[], pages: ExaFetchedPage[] = []): Required<SearchResponse> {
  const pageText = new Map<string, string>();
  for (const page of pages) {
    if (page.kind === "page" && page.text) pageText.set(urlKey(page.url), page.text);
  }

  const rows = hits.map((hit, index) => {
    const fetched = pageText.get(urlKey(hit.url)) ?? "";
    const summary = hit.text || fetched;
    return {
      hit,
      summary,
      content: fetched || hit.text,
      result: withMetadata({ title: hit.title || `Source ${index + 1}`, url: hit.url, snippet: excerpt(summary) }, hit)
    };
  });

  return {
    answer: rows.map(({ summary, result }) => `${excerpt(summary, 500)}\nSource: ${result.title} (${result.url})`).join("\n\n"),
    results: rows.map(({ result }) => result),
    inlineContent: rows.flatMap(({ hit, content }) => content ? [{ url: hit.url, title: hit.title, content, error: null }] : [])
  };
}

export async function fetchWithExa(urls: string[], options: { maxCharacters?: number; signal?: AbortSignal } = {}): Promise<ExaFetchResult> {
  const request = { toolName: EXA_FETCH_TOOL, arguments: exaFetchArguments(urls, options.maxCharacters) };
  const activityId = activityMonitor.logStart({ type: "fetch", url: urls.join(" ") });
  try {
    const response = await callExaMcpRaw(request.toolName, request.arguments, options.signal);
    activityMonitor.logComplete(activityId, 200);
    return { pages: parseExaFetchResults(exaMcpText(response)), native: { provider: "exa-mcp", request, response } };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

async function fetchInlinePages(hits: ExaSearchHit[], signal?: AbortSignal): Promise<{ pages: ExaFetchedPage[]; fetch: ExaInlineFetch }> {
  const urls = hits.map((hit) => hit.url);
  const request = { toolName: EXA_FETCH_TOOL, arguments: exaFetchArguments(urls, INLINE_FETCH_MAX_CHARS) };
  try {
    const { pages, native } = await fetchWithExa(urls, { maxCharacters: INLINE_FETCH_MAX_CHARS, signal });
    return { pages, fetch: { request, response: native.response } };
  } catch (error) {
    if (signal?.aborted) throw error;
    // Keep the search hits; their highlights stay as inline content.
    return { pages: [], fetch: { request, error: errorMessage(error) } };
  }
}

// Free MCP tier only. No API key consumed.
export async function searchWithExa(query: string, options: SearchOptions = {}): Promise<ExaSearchResult> {
  const activityId = activityMonitor.logStart({ type: "api", query });
  const request = { toolName: EXA_SEARCH_TOOL, arguments: exaSearchArguments(query, options) };
  try {
    const response = await callExaMcpRaw(request.toolName, request.arguments, options.signal);
    activityMonitor.logComplete(activityId, 200);
    const hits = parseExaSearchResults(exaMcpText(response));
    const inline = options.includeContent && hits.length > 0 ? await fetchInlinePages(hits, options.signal) : null;
    return {
      ...mapExaSearchHits(hits, inline?.pages),
      native: { provider: "exa-mcp", mode: "mcp", request, response, ...(inline ? { fetch: inline.fetch } : {}) }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

type ExaApiHit = { url?: string; title?: string; text?: string; highlights: string[]; publishedDate?: string; author?: string };
type ExaApiResponse = { answer?: string; citations: Array<{ url?: string; title?: string }>; results: ExaApiHit[] };

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readExaApiResponse(value: unknown): ExaApiResponse {
  const data: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    answer: optionalString(data.answer),
    citations: records(data.citations).map((item) => ({ url: optionalString(item.url), title: optionalString(item.title) })),
    results: records(data.results).map((item) => ({
      url: optionalString(item.url),
      title: optionalString(item.title),
      text: optionalString(item.text),
      highlights: Array.isArray(item.highlights) ? item.highlights.filter((entry: unknown): entry is string => typeof entry === "string") : [],
      publishedDate: optionalString(item.publishedDate),
      author: optionalString(item.author)
    }))
  };
}

// Paid API. Requires API key. Better quality (answer synthesis, highlights).
export async function searchWithExaPaid(query: string, options: SearchOptions = {}): Promise<ExaSearchResult> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Exa paid API requires an API key. Configure via: search config set-secret-ref exaApiKey op ...");
  const activityId = activityMonitor.logStart({ type: "api", query: `exa-paid: ${query}` });

  try {
    const useSearch = !!(options.includeContent || options.recencyFilter || options.domainFilter?.length || options.numResults);
    const endpoint = useSearch ? EXA_SEARCH_URL : EXA_ANSWER_URL;
    const request = useSearch
      ? {
          query,
          type: "auto",
          numResults: options.numResults ?? 5,
          ...(options.domainFilter?.length ? { includeDomains: options.domainFilter.filter((item) => !item.startsWith("-")), excludeDomains: options.domainFilter.filter((item) => item.startsWith("-")).map((item) => item.slice(1)) } : {}),
          contents: { text: options.includeContent ? true : { maxCharacters: 3000 }, highlights: true }
        }
      : { query, text: true };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: withTimeout(options.signal, 60_000)
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Exa API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const raw: unknown = await response.json();
    const data = readExaApiResponse(raw);

    activityMonitor.logComplete(activityId, response.status);

    if (!useSearch) {
      return {
        answer: data.answer ?? "",
        results: data.citations.flatMap((item, index) => item.url ? [{ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" }] : []),
        native: { provider: "exa-api", mode: "answer", request, response: raw }
      };
    }

    return {
      answer: data.results.map((item, index) => `${(item.highlights.join(" ") || item.text || "").slice(0, 1000)}\nSource: ${item.title || `Source ${index + 1}`} (${item.url || ""})`).join("\n\n"),
      results: data.results.flatMap((item, index) => item.url
        ? [withMetadata({ title: item.title || `Source ${index + 1}`, url: item.url, snippet: excerpt(item.highlights.join(" ") || item.text || "") }, item)]
        : []),
      inlineContent: data.results.flatMap<ExtractedContent>((item) => {
        const content = item.text || item.highlights.join("\n\n");
        return item.url && content ? [{ url: item.url, title: item.title || "", content, error: null }] : [];
      }),
      native: { provider: "exa-api", mode: "search", request, response: raw }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
