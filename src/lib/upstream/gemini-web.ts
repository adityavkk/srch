import { activityMonitor } from "../core/activity.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";
import { getGeminiCookies } from "../fetch/chrome-cookies.js";

const GEMINI_WEB_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

export interface GeminiWebSearchResult extends SearchResponse {
  native: {
    provider: "gemini-web";
    request: Record<string, unknown>;
    response: unknown;
  };
}

export async function searchWithGeminiWeb(query: string, options: SearchOptions = {}): Promise<GeminiWebSearchResult | null> {
  const cookies = await getGeminiCookies();
  if (!cookies) return null;
  const activityId = activityMonitor.logStart({ type: "api", query });
  const prompt = `Search the web and answer the following question. Include source URLs as markdown links. Question: ${query}`;
  const request = { prompt, cookieNames: Object.keys(cookies) };
  try {
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(GEMINI_WEB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Cookie: cookieHeader
      },
      body: new URLSearchParams({ "f.req": JSON.stringify([null, prompt]) }),
      signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(options.signal ? [options.signal] : [])])
    });
    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return null;
    }
    const text = await response.text();
    activityMonitor.logComplete(activityId, response.status);
    const results: SearchResponse["results"] = [];
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
      results.push({ title: match[1], url: match[2], snippet: "" });
    }
    return {
      answer: text,
      results,
      native: { provider: "gemini-web", request, response: { raw: text.slice(0, 8000) } }
    };
  } catch {
    activityMonitor.logComplete(activityId, 0);
    return null;
  }
}
