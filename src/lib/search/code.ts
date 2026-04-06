import { inferGithubRepo, queryDeepWiki, type DeepWikiResult } from "../secondary/deepwiki.js";
import { queryContext7, type Context7Result } from "../secondary/context7.js";
import { resolveSecret } from "../core/secrets.js";
import { activityMonitor } from "../core/activity.js";
import { errorMessage, withTimeout } from "../core/http.js";
import { callExaMcpRaw, exaMcpText } from "../upstream/exa-mcp.js";

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
  secondary?: Array<{
    source: "deepwiki" | "context7";
    label: string;
    text: string;
    native: unknown;
  }>;
}

function appendSecondary(primary: string, sources: CodeSearchResult["secondary"]): string {
  if (!sources?.length) return primary;
  let result = primary;
  for (const src of sources) {
    result += `\n\n---\nSecondary source: ${src.label}\n${src.text}`;
  }
  return result;
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
    return { text: data.response ?? "", native: { provider: "exa-context-api", request, response: data } };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

async function searchViaMcp(query: string, maxTokens: number, signal?: AbortSignal): Promise<{ text: string; native: { provider: "exa-mcp"; request: unknown; response: unknown } }> {
  const request = { query: `${query} site:github.com OR site:stackoverflow.com OR programming`, numResults: Math.min(Math.ceil(maxTokens / 500), 10) };
  const response = await callExaMcpRaw("web_search_exa", request, signal);
  return { text: exaMcpText(response), native: { provider: "exa-mcp", request, response } };
}

async function gatherSecondary(query: string, signal?: AbortSignal): Promise<CodeSearchResult["secondary"]> {
  const sources: NonNullable<CodeSearchResult["secondary"]> = [];
  const [deepwiki, context7] = await Promise.allSettled([
    (async (): Promise<DeepWikiResult | null> => {
      const repo = inferGithubRepo(query);
      if (!repo) return null;
      return queryDeepWiki(repo, query, signal);
    })(),
    queryContext7(query, signal)
  ]);

  if (deepwiki.status === "fulfilled" && deepwiki.value?.meaningful) {
    sources.push({ source: "deepwiki", label: `DeepWiki (${deepwiki.value.repo})`, text: deepwiki.value.text, native: deepwiki.value.native });
  }
  if (context7.status === "fulfilled" && context7.value?.meaningful) {
    sources.push({ source: "context7", label: `Context7 (${context7.value.libraryId})`, text: context7.value.text, native: context7.value.native });
  }
  return sources.length > 0 ? sources : undefined;
}

export async function codeSearch(query: string, maxTokens = 5000, signal?: AbortSignal): Promise<CodeSearchResult> {
  const normalized = query.trim();
  if (!normalized) throw new Error("Missing query");

  const [primaryResult, secondary] = await Promise.all([
    (async () => {
      try {
        return await searchViaContextApi(normalized, maxTokens, signal);
      } catch {
        try {
          return await searchViaMcp(normalized, maxTokens, signal);
        } catch (error) {
          return null;
        }
      }
    })(),
    gatherSecondary(normalized, signal)
  ]);

  if (!primaryResult && !secondary?.length) {
    throw new Error("No code search results from any source");
  }

  const text = primaryResult?.text ?? "";
  return {
    query: normalized,
    maxTokens,
    text: appendSecondary(text || "No primary results.", secondary),
    native: primaryResult?.native ?? { provider: "exa-mcp", request: {}, response: {} },
    secondary
  };
}
