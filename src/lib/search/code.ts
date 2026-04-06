import { inferGithubRepo, queryDeepWiki, type DeepWikiResult } from "../secondary/deepwiki.js";
import { resolveSecret } from "../core/secrets.js";
import { activityMonitor } from "../core/activity.js";
import { errorMessage, withTimeout } from "../core/http.js";
import { callExaMcpRaw, exaMcpText, type ExaMcpResponse } from "../upstream/exa-mcp.js";

const EXA_CONTEXT_URL = "https://api.exa.ai/context";

export interface CodeSearchResult {
  query: string;
  maxTokens: number;
  text: string;
  native: {
    provider: "exa-context-api" | "exa-mcp";
    request: unknown;
    response: unknown;
  };
  secondary?: {
    source: "deepwiki";
    repo: string;
    text: string;
    native: unknown;
  };
}

function mergeSecondary(primary: string, secondary: DeepWikiResult | null): string {
  if (!secondary?.meaningful) return primary;
  return `${primary}\n\n---\nSecondary source: DeepWiki (${secondary.repo})\n${secondary.text}`;
}

async function searchViaContextApi(query: string, maxTokens: number, signal?: AbortSignal): Promise<{ text: string; native: { provider: "exa-context-api"; request: unknown; response: unknown } }> {
  const apiKey = await resolveSecret("exaApiKey");
  if (!apiKey) throw new Error("No Exa API key available");
  const activityId = activityMonitor.logStart({ type: "api", query: `exa-context: ${query}` });
  const request = { query, tokensNum: maxTokens };
  try {
    const response = await fetch(EXA_CONTEXT_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: withTimeout(signal, 60_000)
    });
    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Exa Context API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const data = await response.json() as { response?: string; resultsCount?: number; outputTokens?: number };
    activityMonitor.logComplete(activityId, response.status);
    return {
      text: data.response ?? "",
      native: { provider: "exa-context-api", request, response: data }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

async function searchViaMcp(query: string, maxTokens: number, signal?: AbortSignal): Promise<{ text: string; native: { provider: "exa-mcp"; request: unknown; response: unknown } }> {
  const request = {
    query: `${query} site:github.com OR site:stackoverflow.com OR programming`,
    numResults: Math.min(Math.ceil(maxTokens / 500), 10)
  };
  const response = await callExaMcpRaw("web_search_exa", request, signal);
  return {
    text: exaMcpText(response),
    native: { provider: "exa-mcp", request, response }
  };
}

export async function codeSearch(query: string, maxTokens = 5000, signal?: AbortSignal): Promise<CodeSearchResult> {
  const normalized = query.trim();
  if (!normalized) throw new Error("Missing query");
  const repo = inferGithubRepo(normalized);
  let secondary: DeepWikiResult | null = null;
  if (repo) {
    try {
      secondary = await queryDeepWiki(repo, normalized, signal);
    } catch {
      secondary = null;
    }
  }

  let result: { text: string; native: { provider: "exa-context-api" | "exa-mcp"; request: unknown; response: unknown } };
  try {
    result = await searchViaContextApi(normalized, maxTokens, signal);
  } catch {
    try {
      result = await searchViaMcp(normalized, maxTokens, signal);
    } catch (error) {
      if (!secondary?.meaningful) throw error;
      result = { text: "Primary source unavailable.", native: { provider: "exa-mcp", request: {}, response: { error: errorMessage(error) } } };
    }
  }

  return {
    query: normalized,
    maxTokens,
    text: mergeSecondary(result.text, secondary),
    native: result.native,
    ...(secondary?.meaningful ? {
      secondary: {
        source: "deepwiki" as const,
        repo: secondary.repo,
        text: secondary.text,
        native: secondary.native
      }
    } : {})
  };
}
