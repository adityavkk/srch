import { activityMonitor } from "../core/activity.js";
import { errorMessage, withTimeout } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";
import type { ExtractedContent, SearchOptions, SearchResponse } from "../core/types.js";
import { callExaMcpRaw, exaMcpText, type ExaMcpResponse } from "./exa-mcp.js";

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";

export interface ExaSearchResult extends SearchResponse {
  native: {
    provider: "exa-api" | "exa-mcp";
    mode: "answer" | "search" | "mcp";
    request: Record<string, unknown>;
    response: unknown;
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

function parseMcpResults(text: string): Array<{ title: string; url: string; content: string }> {
  return text
    .split(/(?=^Title: )/m)
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
      const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
      const content = block.includes("\nText: ")
        ? block.slice(block.indexOf("\nText: ") + 7).trim().replace(/\n---\s*$/, "")
        : "";
      return { title, url, content };
    })
    .filter((item) => item.url.length > 0);
}

function mapMcpResponse(query: string, options: SearchOptions, response: ExaMcpResponse): ExaSearchResult {
  const text = exaMcpText(response);
  const parsed = parseMcpResults(text);
  const request = {
    toolName: "web_search_exa",
    arguments: {
      query,
      numResults: options.numResults ?? 5,
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: options.includeContent ? 50_000 : 3_000
    }
  };

  return {
    answer: parsed.map((item, index) => `${item.content.slice(0, 500)}\nSource: ${item.title || `Source ${index + 1}`} (${item.url})`).join("\n\n"),
    results: parsed.map((item, index) => ({ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" })),
    inlineContent: options.includeContent
      ? parsed.filter((item) => item.content).map<ExtractedContent>((item) => ({ url: item.url, title: item.title, content: item.content, error: null }))
      : undefined,
    native: {
      provider: "exa-mcp",
      mode: "mcp",
      request,
      response
    }
  };
}

export async function searchWithExa(query: string, options: SearchOptions = {}): Promise<ExaSearchResult> {
  const apiKey = await getApiKey();
  const activityId = activityMonitor.logStart({ type: "api", query });

  try {
    if (!apiKey) {
      const request = {
        toolName: "web_search_exa",
        arguments: {
          query,
          numResults: options.numResults ?? 5,
          livecrawl: "fallback",
          type: "auto",
          contextMaxCharacters: options.includeContent ? 50_000 : 3_000
        }
      };
      const response = await callExaMcpRaw(request.toolName, request.arguments, options.signal);
      activityMonitor.logComplete(activityId, 200);
      return mapMcpResponse(query, options, response);
    }

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
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: withTimeout(options.signal, 60_000)
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Exa API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = await response.json() as {
      answer?: string;
      citations?: Array<{ url?: string; title?: string }>;
      results?: Array<{ url?: string; title?: string; text?: string; highlights?: string[] }>;
    };

    activityMonitor.logComplete(activityId, response.status);

    if (!useSearch) {
      return {
        answer: data.answer ?? "",
        results: (data.citations ?? []).flatMap((item, index) => item.url ? [{ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" }] : []) ,
        native: {
          provider: "exa-api",
          mode: "answer",
          request,
          response: data
        }
      };
    }

    return {
      answer: (data.results ?? []).map((item, index) => `${(item.highlights?.join(" ") || item.text || "").slice(0, 1000)}\nSource: ${item.title || `Source ${index + 1}`} (${item.url || ""})`).join("\n\n"),
      results: (data.results ?? []).flatMap((item, index) => item.url ? [{ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" }] : []),
      inlineContent: options.includeContent
        ? (data.results ?? []).flatMap((item) => item.url && item.text ? [{ url: item.url, title: item.title || "", content: item.text, error: null }] : [])
        : undefined,
      native: {
        provider: "exa-api",
        mode: "search",
        request,
        response: data
      }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
