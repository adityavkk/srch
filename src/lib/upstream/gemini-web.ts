import { activityMonitor } from "../core/activity.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";
import { getGeminiCookies } from "../fetch/chrome-cookies.js";
import { errorMessage } from "../core/http.js";
import { fetchWithContext, type WebSearchContext } from "./context.js";
import { assertWebOptions, filterWebResults } from "../search/web-options.js";

const GEMINI_WEB_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

type GeminiWebContext = WebSearchContext & {
  getCookies?: typeof getGeminiCookies;
};

export interface GeminiWebSearchResult extends SearchResponse {
  native: {
    provider: "gemini-web";
    request: Record<string, unknown>;
    response: unknown;
  };
}

export async function searchWithGeminiWeb(query: string, options: SearchOptions = {}, context?: GeminiWebContext): Promise<GeminiWebSearchResult | null> {
  assertWebOptions("gemini-web", { ...options, query });
  const cookies = await (context?.getCookies ?? getGeminiCookies)(options.signal);
  if (!cookies) return null;
  const activityId = activityMonitor.logStart({ type: "api", query });
  const prompt = `Search the web and answer the following question. Include source URLs as markdown links. Question: ${query}`;
  const request = { prompt, cookieNames: Object.keys(cookies) };
  try {
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetchWithContext(GEMINI_WEB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Cookie: cookieHeader
      },
      body: new URLSearchParams({ "f.req": JSON.stringify([null, prompt]) }),
      signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(options.signal ? [options.signal] : [])])
    }, context);
    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Gemini web HTTP error ${response.status}`);
    }
    const text = await response.text();
    activityMonitor.logComplete(activityId, response.status);
    const results: SearchResponse["results"] = [];
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
      results.push({ title: match[1], url: match[2], snippet: "" });
    }
    return {
      answer: text,
      results: filterWebResults(results, options),
      native: { provider: "gemini-web", request, response: { raw: text.slice(0, 8000) } }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
