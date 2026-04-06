import type { SearchOptions, SearchProvider, SearchResponse } from "../core/types.js";
import { isGeminiApiAvailable } from "../upstream/gemini-api.js";
import { searchWithGemini as searchWithGeminiApi } from "../upstream/gemini.js";
import { searchWithGeminiWeb } from "../upstream/gemini-web.js";
import { searchWithExa, searchWithExaPaid } from "../upstream/exa.js";
import { isBraveAvailable, searchWithBrave } from "../upstream/brave.js";
import { isPerplexityAvailable, searchWithPerplexity } from "../upstream/perplexity.js";

export interface WebSearchResult extends SearchResponse {
  provider: Exclude<SearchProvider, "auto">;
  native?: unknown;
}

export interface WebSearchOptions extends SearchOptions {
  hq?: boolean;
}

async function searchWithGemini(query: string, options: SearchOptions = {}): Promise<WebSearchResult> {
  if (await isGeminiApiAvailable()) {
    return { ...(await searchWithGeminiApi(query, options)), provider: "gemini" };
  }
  const webResult = await searchWithGeminiWeb(query, options);
  if (webResult) return { ...webResult, provider: "gemini" };
  throw new Error("Gemini unavailable: no API key and no logged-in browser profile found");
}

// Auto fallback order (all free/low-cost first):
//   1. Exa free MCP
//   2. Brave (free tier credits)
//   3. Gemini browser cookies (free, no API key)
//   4. Gemini API (uses API key credits)
//   5. Perplexity (uses API key credits)
//
// --hq flag: Exa paid API directly (best quality, uses credits)

export async function webSearch(query: string, provider: SearchProvider = "auto", options: WebSearchOptions = {}): Promise<WebSearchResult> {
  if (provider === "exa") {
    if (options.hq) return { ...(await searchWithExaPaid(query, options)), provider: "exa" };
    return { ...(await searchWithExa(query, options)), provider: "exa" };
  }
  if (provider === "brave") return { ...(await searchWithBrave(query, options)), provider: "brave" };
  if (provider === "perplexity") return { ...(await searchWithPerplexity(query, options)), provider: "perplexity" };
  if (provider === "gemini") return { ...(await searchWithGemini(query, options)), provider: "gemini" };

  // --hq: skip free tier, go straight to Exa paid API
  if (options.hq) {
    return { ...(await searchWithExaPaid(query, options)), provider: "exa" };
  }

  const errors: string[] = [];

  // 1. Exa free MCP
  try {
    return { ...(await searchWithExa(query, options)), provider: "exa" };
  } catch (error) {
    errors.push(`Exa MCP: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Brave free tier
  if (await isBraveAvailable()) {
    try {
      return { ...(await searchWithBrave(query, options)), provider: "brave" };
    } catch (error) {
      errors.push(`Brave: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Gemini browser cookies (free)
  try {
    const webResult = await searchWithGeminiWeb(query, options);
    if (webResult) return { ...webResult, provider: "gemini" };
  } catch (error) {
    errors.push(`Gemini Web: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. Gemini API
  if (await isGeminiApiAvailable()) {
    try {
      return { ...(await searchWithGeminiApi(query, options)), provider: "gemini" };
    } catch (error) {
      errors.push(`Gemini API: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 5. Perplexity
  if (await isPerplexityAvailable()) {
    try {
      return { ...(await searchWithPerplexity(query, options)), provider: "perplexity" };
    } catch (error) {
      errors.push(`Perplexity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.length > 0 ? `No provider succeeded\n- ${errors.join("\n- ")}` : "No provider available");
}
