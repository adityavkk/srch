import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";
import { fetchWithContext, type WebSearchContext } from "./context.js";
import { assertWebOptions, filterWebResults } from "../search/web-options.js";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
const requestTimestamps: number[] = [];

export interface PerplexitySearchResult extends SearchResponse {
  native: {
    provider: "perplexity-api";
    request: Record<string, unknown>;
    response: unknown;
  };
}

async function getApiKey(context?: WebSearchContext, signal?: AbortSignal): Promise<string> {
  const key = await (context ? context.secrets.resolve("perplexityApiKey", signal) : resolveSecret("perplexityApiKey", signal));
  if (!key) throw new Error("Missing Perplexity API key");
  return key;
}

function checkRateLimit(): void {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT.windowMs) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT.maxRequests) {
    const waitMs = requestTimestamps[0] + RATE_LIMIT.windowMs - now;
    throw new Error(`Rate limited. Retry in ${Math.ceil(waitMs / 1000)}s`);
  }
  requestTimestamps.push(now);
}

export async function isPerplexityAvailable(context?: WebSearchContext, signal?: AbortSignal): Promise<boolean> {
  return !!(await (context ? context.secrets.resolve("perplexityApiKey", signal) : resolveSecret("perplexityApiKey", signal)));
}

export async function searchWithPerplexity(query: string, options: SearchOptions = {}, context?: WebSearchContext): Promise<PerplexitySearchResult> {
  assertWebOptions("perplexity-api", { ...options, query });
  checkRateLimit();
  const activityId = activityMonitor.logStart({ type: "api", query });

  try {
    const request = {
      model: "sonar",
      messages: [{ role: "user", content: query }],
      return_related_questions: false,
      max_tokens: 1024,
      ...(options.recencyFilter ? { search_recency_filter: options.recencyFilter } : {}),
      ...(options.domainFilter?.length ? { search_domain_filter: options.domainFilter } : {})
    };

    const response = await fetchWithContext(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getApiKey(context, options.signal)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: options.signal
    }, context);

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Perplexity API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: Array<string | { url?: string; title?: string }>;
    };

    const results = filterWebResults((data.citations ?? []).flatMap((citation, index) => {
      if (typeof citation === "string") return [{ title: `Source ${index + 1}`, url: citation, snippet: "" }];
      if (citation?.url) return [{ title: citation.title || `Source ${index + 1}`, url: citation.url, snippet: "" }];
      return [];
    }), options);

    activityMonitor.logComplete(activityId, response.status);
    return {
      answer: data.choices?.[0]?.message?.content ?? "",
      results,
      native: {
        provider: "perplexity-api",
        request,
        response: data
      }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
