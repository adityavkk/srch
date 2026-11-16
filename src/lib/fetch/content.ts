import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { activityMonitor } from "../core/activity.js";
import { errorMessage, withTimeout } from "../core/http.js";
import type { ExtractedContent } from "../core/types.js";
import { fetchWithContext, type WebSearchContext } from "../upstream/context.js";
import { readResponseBytes, readResponseText } from "./body.js";
import { extractWithUrlContext } from "./gemini-url-context.js";
import { extractGitHub } from "./github.js";
import { extractWithJinaReader } from "./jina.js";
import { isPdf, extractPdfToMarkdown } from "./pdf.js";
import { extractRscContent } from "./rsc.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const NON_RECOVERABLE_ERRORS = ["Unsupported content type", "Response too large"];

function isLikelyJsRendered(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;
  const text = bodyMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const scriptCount = (html.match(/<script/gi) || []).length;
  return text.length < 500 && scriptCount > 3;
}

async function extractViaHttp(url: string, signal?: AbortSignal, context?: WebSearchContext): Promise<ExtractedContent> {
  signal?.throwIfAborted();
  const activityId = activityMonitor.logStart({ type: "fetch", url });
  const requestSignal = withTimeout(signal, 30_000);
  const complete = { transport: "http", completeness: "complete", warnings: [] as string[], generated: false } as const;

  try {
    const response = await fetchWithContext(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: requestSignal
    }, context);
    requestSignal.throwIfAborted();

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return { url, title: "", content: "", error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (isPdf(url, contentType)) {
      const bytes = await readResponseBytes(response, requestSignal);
      const result = await extractPdfToMarkdown(bytes.buffer, url, requestSignal);
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: result.title,
        content: result.content,
        error: null,
        extraction: {
          ...complete,
          completeness: result.warnings.length ? "partial" : "complete",
          warnings: result.warnings,
          pages: { total: result.pages, extracted: result.extractedPages }
        }
      };
    }

    if (!contentType.includes("html") && !contentType.includes("text") && !contentType.includes("json") && !contentType.includes("xml")) {
      activityMonitor.logComplete(activityId, response.status);
      return { url, title: "", content: "", error: `Unsupported content type: ${contentType.split(";")[0]}` };
    }

    const text = await readResponseText(response, requestSignal);
    activityMonitor.logComplete(activityId, response.status);

    if (!contentType.includes("html")) {
      return { url, title: new URL(url).hostname, content: text, error: null, extraction: complete };
    }

    const { document } = parseHTML(text);
    const article = new Readability(document as unknown as Document).parse();
    // Readability 0.6 may return an article whose fields are individually
    // null/undefined, so treat a missing `content` the same as a null parse.
    if (!article || !article.content) {
      const rsc = extractRscContent(text);
      if (rsc) return { url, title: rsc.title, content: rsc.content, error: null, extraction: complete };
      return {
        url,
        title: "",
        content: "",
        error: isLikelyJsRendered(text) ? "Page appears JavaScript-rendered" : "Could not extract readable content"
      };
    }

    const markdown = turndown.turndown(article.content);
    if (markdown.length < 200) {
      const rsc = extractRscContent(text);
      if (rsc) return { url, title: rsc.title, content: rsc.content, error: null, extraction: complete };
      const warning = isLikelyJsRendered(text) ? "Page appears JavaScript-rendered" : "Extracted content appears incomplete";
      return {
        url,
        title: article.title || new URL(url).hostname,
        content: markdown,
        error: warning,
        extraction: { ...complete, completeness: "partial", warnings: [warning] }
      };
    }

    return {
      url,
      title: article.title || new URL(url).hostname,
      content: markdown,
      error: null,
      extraction: complete
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    signal?.throwIfAborted();
    return { url, title: "", content: "", error: errorMessage(error) };
  }
}

export type FetchContentOptions = {
  /** Allow Gemini URL-context extraction, which generates text instead of reading the page. Default true. */
  allowGenerated?: boolean;
};

export async function fetchContent(
  url: string,
  signal?: AbortSignal,
  context?: WebSearchContext,
  options: FetchContentOptions = {}
): Promise<ExtractedContent> {
  signal?.throwIfAborted();
  const githubResult = await extractGitHub(url, signal, context);
  signal?.throwIfAborted();
  if (githubResult) return githubResult;

  const httpResult = await extractViaHttp(url, signal, context);
  signal?.throwIfAborted();
  if (!httpResult.error) return httpResult;
  if (NON_RECOVERABLE_ERRORS.some((prefix) => httpResult.error?.startsWith(prefix))) return httpResult;

  const jinaResult = await extractWithJinaReader(url, signal, context);
  signal?.throwIfAborted();
  if (jinaResult) return jinaResult;
  if (options.allowGenerated === false) return httpResult;

  const geminiResult = await extractWithUrlContext(url, signal, context);
  signal?.throwIfAborted();
  if (geminiResult) return geminiResult;

  return httpResult;
}
