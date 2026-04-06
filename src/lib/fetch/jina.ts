import { activityMonitor } from "../core/activity.js";
import type { ExtractedContent } from "../core/types.js";

const JINA_READER_BASE = "https://r.jina.ai/";

function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#{1,2}\s+(.+)/m);
  if (!match) return null;
  const cleaned = match[1].replace(/\*+/g, "").trim();
  return cleaned || null;
}

export async function extractWithJinaReader(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });
  try {
    const response = await fetch(JINA_READER_BASE + url, {
      headers: {
        Accept: "text/markdown",
        "X-No-Cache": "true"
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : [])
      ])
    });
    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return null;
    }
    const content = await response.text();
    activityMonitor.logComplete(activityId, response.status);
    const contentStart = content.indexOf("Markdown Content:");
    if (contentStart < 0) return null;
    const markdown = content.slice(contentStart + 17).trim();
    if (markdown.length < 100 || markdown.startsWith("Loading...") || markdown.startsWith("Please enable JavaScript")) return null;
    const title = extractHeadingTitle(markdown) ?? new URL(url).hostname;
    return { url, title, content: markdown, error: null };
  } catch {
    activityMonitor.logComplete(activityId, 0);
    return null;
  }
}
