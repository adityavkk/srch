import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { activityMonitor } from "../core/activity.js";
import { errorMessage, isAbortError, withTimeout } from "../core/http.js";
import type { ExtractedContent } from "../core/types.js";
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

async function extractViaHttp(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
  const activityId = activityMonitor.logStart({ type: "fetch", url });

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: withTimeout(signal, 30_000)
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return { url, title: "", content: "", error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (isPdf(url, contentType)) {
      const buffer = await response.arrayBuffer();
      const result = await extractPdfToMarkdown(buffer, url);
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: result.title,
        content: `PDF extracted and saved to: ${result.outputPath}\n\nPages: ${result.pages}\nCharacters: ${result.chars}`,
        error: null
      };
    }

    if (!contentType.includes("html") && !contentType.includes("text") && !contentType.includes("json") && !contentType.includes("xml")) {
      activityMonitor.logComplete(activityId, response.status);
      return { url, title: "", content: "", error: `Unsupported content type: ${contentType.split(";")[0]}` };
    }

    const text = await response.text();
    activityMonitor.logComplete(activityId, response.status);

    if (!contentType.includes("html")) {
      return { url, title: new URL(url).hostname, content: text, error: null };
    }

    const { document } = parseHTML(text);
    const article = new Readability(document as unknown as Document).parse();
    if (!article) {
      const rsc = extractRscContent(text);
      if (rsc) return { url, title: rsc.title, content: rsc.content, error: null };
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
      if (rsc) return { url, title: rsc.title, content: rsc.content, error: null };
      return {
        url,
        title: article.title || new URL(url).hostname,
        content: markdown,
        error: isLikelyJsRendered(text) ? "Page appears JavaScript-rendered" : "Extracted content appears incomplete"
      };
    }

    return {
      url,
      title: article.title || new URL(url).hostname,
      content: markdown,
      error: null
    };
  } catch (error) {
    if (isAbortError(error)) {
      activityMonitor.logComplete(activityId, 0);
      return { url, title: "", content: "", error: "Aborted" };
    }
    activityMonitor.logError(activityId, errorMessage(error));
    return { url, title: "", content: "", error: errorMessage(error) };
  }
}

export async function fetchContent(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
  const githubResult = await extractGitHub(url, signal);
  if (githubResult) return githubResult;

  const httpResult = await extractViaHttp(url, signal);
  if (!httpResult.error) return httpResult;
  if (NON_RECOVERABLE_ERRORS.some((prefix) => httpResult.error?.startsWith(prefix))) return httpResult;

  const jinaResult = await extractWithJinaReader(url, signal);
  if (jinaResult) return jinaResult;

  const geminiResult = await extractWithUrlContext(url, signal);
  if (geminiResult) return geminiResult;

  return httpResult;
}
