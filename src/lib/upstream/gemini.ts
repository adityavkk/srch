import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";
import { createGeminiApiTransport } from "../grounding/gemini-api-transport.js";
import { runGrounding, type GroundingExchange } from "../grounding/run.js";
import type { GroundingContext } from "../grounding/transport.js";
import type { GroundedAnswer } from "../grounding/types.js";
import { assertWebOptions, filterWebResults } from "../search/web-options.js";
import type { WebSearchContext } from "./context.js";

export interface GeminiSearchResult extends SearchResponse {
  native: {
    provider: "gemini-api";
    /** Credential-free `generateContent` body. */
    request: Record<string, unknown>;
    response: unknown;
    grounding: GroundedAnswer;
  };
}

const transport = createGeminiApiTransport();

function groundingContext(context?: WebSearchContext): GroundingContext {
  return context ?? {
    http: { fetch: (input, init) => fetch(input, init) },
    secrets: { resolve: (name, signal) => name === "geminiApiKey" ? resolveSecret("geminiApiKey", signal) : Promise.resolve(null) }
  };
}

/** Google Search Grounding through the Gemini API key, using the shared grounding engine. */
export async function searchWithGemini(query: string, options: SearchOptions = {}, context?: WebSearchContext): Promise<GeminiSearchResult> {
  assertWebOptions("gemini-api", { ...options, query });
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    let exchange: GroundingExchange | undefined;
    const grounding = await runGrounding(
      { query, signal: options.signal },
      groundingContext(context),
      { transports: [transport], transport: "gemini-api", requireAnswer: false, onExchange: (value) => { exchange = value; } }
    );
    activityMonitor.logComplete(activityId, 200);
    const results = grounding.sources.map((source) => ({
      title: source.title,
      url: source.url,
      snippet: grounding.supports.filter((support) => support.sourceIds.includes(source.id)).map((support) => support.text).join(" ").slice(0, 500)
    }));
    return {
      answer: grounding.text,
      results: filterWebResults(results, options),
      native: { provider: "gemini-api", request: exchange?.request ?? {}, response: exchange?.response, grounding }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
