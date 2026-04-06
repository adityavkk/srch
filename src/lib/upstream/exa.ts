import { activityMonitor } from "../core/activity.js";
import { loadConfig } from "../core/config.js";
import { errorMessage, withTimeout } from "../core/http.js";
import type { ExtractedContent, SearchOptions, SearchResponse } from "../core/types.js";

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

function getApiKey(): string | null {
  return process.env.EXA_API_KEY ?? loadConfig().exaApiKey ?? null;
}

export function hasExaApiKey(): boolean {
  return getApiKey() !== null;
}

export function isExaAvailable(): boolean {
  return true;
}

export async function callExaMcp(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args }
    }),
    signal: withTimeout(signal, 60_000)
  });

  if (!response.ok) {
    throw new Error(`Exa MCP error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.text();
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as { result?: { content?: Array<{ type?: string; text?: string }> } };
      const text = parsed.result?.content?.find((item) => item.type === "text" && item.text)?.text;
      if (text) return text;
    } catch {
    }
  }

  try {
    const parsed = JSON.parse(body) as { result?: { content?: Array<{ type?: string; text?: string }> } };
    const text = parsed.result?.content?.find((item) => item.type === "text" && item.text)?.text;
    if (text) return text;
  } catch {
  }

  throw new Error("Exa MCP returned empty content");
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

export async function searchWithExa(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const apiKey = getApiKey();
  const activityId = activityMonitor.logStart({ type: "api", query });

  try {
    if (!apiKey) {
      const text = await callExaMcp("web_search_exa", {
        query,
        numResults: options.numResults ?? 5,
        livecrawl: "fallback",
        type: "auto",
        contextMaxCharacters: options.includeContent ? 50_000 : 3_000
      }, options.signal);
      const parsed = parseMcpResults(text);
      activityMonitor.logComplete(activityId, 200);
      return {
        answer: parsed.map((item, index) => `${item.content.slice(0, 500)}\nSource: ${item.title || `Source ${index + 1}`} (${item.url})`).join("\n\n"),
        results: parsed.map((item, index) => ({ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" })),
        inlineContent: options.includeContent
          ? parsed.filter((item) => item.content).map<ExtractedContent>((item) => ({ url: item.url, title: item.title, content: item.content, error: null }))
          : undefined
      };
    }

    const useSearch = !!(options.includeContent || options.recencyFilter || options.domainFilter?.length || options.numResults);
    const endpoint = useSearch ? EXA_SEARCH_URL : EXA_ANSWER_URL;
    const body = useSearch
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
      body: JSON.stringify(body),
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
        results: (data.citations ?? []).flatMap((item, index) => item.url ? [{ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" }] : [])
      };
    }

    return {
      answer: (data.results ?? []).map((item, index) => `${(item.highlights?.join(" ") || item.text || "").slice(0, 1000)}\nSource: ${item.title || `Source ${index + 1}`} (${item.url || ""})`).join("\n\n"),
      results: (data.results ?? []).flatMap((item, index) => item.url ? [{ title: item.title || `Source ${index + 1}`, url: item.url, snippet: "" }] : []),
      inlineContent: options.includeContent
        ? (data.results ?? []).flatMap((item) => item.url && item.text ? [{ url: item.url, title: item.title || "", content: item.text, error: null }] : [])
        : undefined
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
