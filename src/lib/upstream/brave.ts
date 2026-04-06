import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export interface BraveSearchResult extends SearchResponse {
  native: {
    provider: "brave-search-api";
    request: Record<string, unknown>;
    response: unknown;
  };
}

export async function isBraveAvailable(): Promise<boolean> {
  return !!(await resolveSecret("braveApiKey"));
}

async function getApiKey(): Promise<string> {
  const key = await resolveSecret("braveApiKey");
  if (!key) throw new Error("Missing Brave Search API key");
  return key;
}

export async function searchWithBrave(query: string, options: SearchOptions = {}): Promise<BraveSearchResult> {
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    const request = {
      q: query,
      count: Math.min(options.numResults ?? 5, 20),
      ...(options.recencyFilter ? { freshness: options.recencyFilter } : {}),
      ...(options.domainFilter?.length ? { site: options.domainFilter.filter((item) => !item.startsWith("-")).join(",") } : {})
    };
    const url = `${BRAVE_SEARCH_URL}?${new URLSearchParams(Object.entries(request).filter(([, value]) => value !== undefined).map(([k, v]) => [k, String(v)]))}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": await getApiKey()
      },
      signal: options.signal
    });
    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Brave Search API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const data = await response.json() as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
        }>;
      };
    };
    const results = (data.web?.results ?? []).slice(0, options.numResults ?? 5).flatMap((item, index) => item.url ? [{
      title: item.title || `Source ${index + 1}`,
      url: item.url,
      snippet: item.description || ""
    }] : []);
    activityMonitor.logComplete(activityId, response.status);
    return {
      answer: results.map((item, index) => `${item.snippet}\nSource: ${item.title || `Source ${index + 1}`} (${item.url})`).join("\n\n"),
      results,
      native: {
        provider: "brave-search-api",
        request,
        response: data
      }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
