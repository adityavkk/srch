import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";
import type { SearchOptions, SearchResponse } from "../core/types.js";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "./gemini-api.js";

export interface GeminiSearchResult extends SearchResponse {
  native: {
    provider: "gemini-api";
    request: Record<string, unknown>;
    response: unknown;
  };
}

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiSearchResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
    };
  }>;
}

export async function searchWithGemini(query: string, options: SearchOptions = {}): Promise<GeminiSearchResult> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Missing Gemini API key");

  const activityId = activityMonitor.logStart({ type: "api", query });

  try {
    const request = {
      contents: [{ parts: [{ text: query }] }],
      tools: [{ google_search: {} }]
    };

    const response = await fetch(`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([
        AbortSignal.timeout(60_000),
        ...(options.signal ? [options.signal] : [])
      ])
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      throw new Error(`Gemini API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = await response.json() as GeminiSearchResponse;
    const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n") ?? "";
    const results = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).flatMap((chunk, index) => {
      const url = chunk.web?.uri;
      if (!url) return [];
      return [{ title: chunk.web?.title || `Source ${index + 1}`, url, snippet: "" }];
    });

    activityMonitor.logComplete(activityId, response.status);
    return {
      answer,
      results,
      native: {
        provider: "gemini-api",
        request,
        response: data
      }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
