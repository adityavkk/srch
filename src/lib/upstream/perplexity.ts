import { activityMonitor } from "../core/activity.js";
import { loadConfig } from "../core/config.js";
import { errorMessage } from "../core/http.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
const requestTimestamps: number[] = [];

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY ?? loadConfig().perplexityApiKey;
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

export function isPerplexityAvailable(): boolean {
  return !!(process.env.PERPLEXITY_API_KEY ?? loadConfig().perplexityApiKey);
}

export async function searchWithPerplexity(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  checkRateLimit();
  const activityId = activityMonitor.logStart({ type: "api", query });

  try {
    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
        return_related_questions: false,
        max_tokens: 1024,
        ...(options.recencyFilter ? { search_recency_filter: options.recencyFilter } : {}),
        ...(options.domainFilter?.length ? { search_domain_filter: options.domainFilter } : {})
      }),
      signal: options.signal
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Perplexity API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: Array<string | { url?: string; title?: string }>;
    };

    const results = (data.citations ?? []).slice(0, options.numResults ?? 5).flatMap((citation, index) => {
      if (typeof citation === "string") return [{ title: `Source ${index + 1}`, url: citation, snippet: "" }];
      if (citation?.url) return [{ title: citation.title || `Source ${index + 1}`, url: citation.url, snippet: "" }];
      return [];
    });

    activityMonitor.logComplete(activityId, response.status);
    return {
      answer: data.choices?.[0]?.message?.content ?? "",
      results
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
