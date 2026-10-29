import { errorMessage } from "../core/http.js";
import type { ExtractedContent, FetchContentOptions } from "../core/types.js";
import { fetchWithExa } from "../upstream/exa.js";
import { enhanceMarkdownImages } from "./images.js";

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Reads a page through Exa's crawler (free MCP tool web_fetch_exa).
export async function extractWithExa(url: string, signal?: AbortSignal, options: FetchContentOptions = {}): Promise<ExtractedContent> {
  try {
    const { pages } = await fetchWithExa([url], { signal });
    const page = pages.at(0);
    if (!page) return { url, title: "", content: "", error: "Exa returned no page" };
    if (page.kind === "error") return { url, title: "", content: "", error: `Exa could not read the page: ${page.error}` };

    const pageUrl = page.url || url;
    const enhanced = await enhanceMarkdownImages(page.text, pageUrl, [], options, signal);
    return {
      url: pageUrl,
      title: page.title || hostname(pageUrl),
      content: enhanced.content,
      error: enhanced.content.trim() ? null : "Exa returned no text",
      images: enhanced.images
    };
  } catch (error) {
    return { url, title: "", content: "", error: errorMessage(error) };
  }
}
