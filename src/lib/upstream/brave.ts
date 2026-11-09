import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";
import { fetchWithContext, type WebSearchContext } from "./context.js";
import { assertWebOptions, braveQuery, BRAVE_FRESHNESS, filterWebResults } from "../search/web-options.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export interface BraveSearchResult extends SearchResponse {
  native: {
    provider: "brave-search-api";
    request: Record<string, unknown>;
    response: unknown;
  };
}

export async function isBraveAvailable(context?: WebSearchContext, signal?: AbortSignal): Promise<boolean> {
  return !!(await (context ? context.secrets.resolve("braveApiKey", signal) : resolveSecret("braveApiKey", signal)));
}

async function getApiKey(context?: WebSearchContext, signal?: AbortSignal): Promise<string> {
  const key = await (context ? context.secrets.resolve("braveApiKey", signal) : resolveSecret("braveApiKey", signal));
  if (!key) throw new Error("Missing Brave Search API key");
  return key;
}

export async function searchWithBrave(query: string, options: SearchOptions = {}, context?: WebSearchContext): Promise<BraveSearchResult> {
  assertWebOptions("brave-search-api", { ...options, query });
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    const request = {
      q: braveQuery(query, options.domainFilter),
      count: options.numResults ?? 5,
      ...(options.recencyFilter ? { freshness: BRAVE_FRESHNESS[options.recencyFilter] } : {}),
      ...(options.domainFilter?.length ? { operators: true, operators_fallback: false } : {})
    };
    const url = `${BRAVE_SEARCH_URL}?${new URLSearchParams(Object.entries(request).filter(([, value]) => value !== undefined).map(([k, v]) => [k, String(v)]))}`;
    const response = await fetchWithContext(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": await getApiKey(context, options.signal)
      },
      signal: options.signal
    }, context);
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
    const results = filterWebResults((data.web?.results ?? []).flatMap((item, index) => item.url ? [{
      title: item.title || `Source ${index + 1}`,
      url: item.url,
      snippet: item.description || ""
    }] : []), options);
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
