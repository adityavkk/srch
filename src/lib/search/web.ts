import type { SearchOptions, SearchProvider, SearchResponse } from "../core/types.js";
import { isGeminiApiAvailable } from "../upstream/gemini-api.js";
import { hasExaApiKey, isExaAvailable, searchWithExa } from "../upstream/exa.js";
import { isPerplexityAvailable, searchWithPerplexity } from "../upstream/perplexity.js";

export interface WebSearchResult extends SearchResponse {
  provider: Exclude<SearchProvider, "auto">;
  native?: unknown;
}

async function searchWithGemini(query: string, _options: SearchOptions = {}): Promise<WebSearchResult> {
  if (!isGeminiApiAvailable()) {
    throw new Error("Gemini search not wired yet. Set provider to exa or perplexity.");
  }
  throw new Error("Gemini search not wired yet. Use exa or perplexity.");
}

export async function webSearch(query: string, provider: SearchProvider = "auto", options: SearchOptions = {}): Promise<WebSearchResult> {
  if (provider === "exa") return { ...(await searchWithExa(query, options)), provider: "exa" };
  if (provider === "perplexity") return { ...(await searchWithPerplexity(query, options)), provider: "perplexity" };
  if (provider === "gemini") return { ...(await searchWithGemini(query, options)), provider: "gemini" };

  const errors: string[] = [];

  if (isExaAvailable()) {
    try {
      return { ...(await searchWithExa(query, options)), provider: "exa" };
    } catch (error) {
      errors.push(`Exa: ${error instanceof Error ? error.message : String(error)}`);
      if (await hasExaApiKey()) throw error;
    }
  }

  if (await isPerplexityAvailable()) {
    try {
      return { ...(await searchWithPerplexity(query, options)), provider: "perplexity" };
    } catch (error) {
      errors.push(`Perplexity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (await isGeminiApiAvailable()) {
    try {
      return { ...(await searchWithGemini(query, options)), provider: "gemini" };
    } catch (error) {
      errors.push(`Gemini: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.length > 0 ? `No provider succeeded\n- ${errors.join("\n- ")}` : "No provider available");
}
