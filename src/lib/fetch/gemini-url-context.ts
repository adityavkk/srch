import { activityMonitor } from "../core/activity.js";
import { DEFAULT_MODEL, getApiKey, API_BASE } from "../upstream/gemini-api.js";
import type { ExtractedContent } from "../core/types.js";

const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown. Include the page title, all text content, code blocks, and tables. Do not summarize. URL: `;

function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#{1,2}\s+(.+)/m);
  if (!match) return null;
  const cleaned = match[1].replace(/\*+/g, "").trim();
  return cleaned || null;
}

export async function extractWithUrlContext(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  const activityId = activityMonitor.logStart({ type: "api", query: `url_context: ${url}` });
  try {
    const request = {
      contents: [{ parts: [{ text: EXTRACTION_PROMPT + url }] }],
      tools: [{ url_context: {} }]
    };
    const response = await fetch(`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([
        AbortSignal.timeout(60_000),
        ...(signal ? [signal] : [])
      ])
    });
    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return null;
    }
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    activityMonitor.logComplete(activityId, response.status);
    const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n") ?? "";
    if (!content || content.length < 50) return null;
    const title = extractHeadingTitle(content) ?? new URL(url).hostname;
    return { url, title, content, error: null };
  } catch {
    activityMonitor.logComplete(activityId, 0);
    return null;
  }
}
