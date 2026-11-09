import { withTimeout } from "../core/http.js";
import type { ExtractedContent } from "../core/types.js";
import type { WebSearchContext } from "../upstream/context.js";
import { readResponseBytes, readResponseText, ResponseTooLargeError } from "./body.js";
import { extractPdfToMarkdown, isPdf } from "./pdf.js";
import type { GitHubUrlInfo } from "./github.js";
import { extname } from "node:path";

const MAX_TREE_ENTRIES = 200;
const MAX_INLINE_CHARS = 100_000;
export const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp3", ".mp4", ".zip", ".gz", ".pdf", ".sqlite", ".db"]);

/** SDK retrieval uses the caller's HTTP and secrets, without cloning or invoking local tools. */
export async function fetchGitHubHttp(url: string, info: GitHubUrlInfo, context: WebSearchContext, signal?: AbortSignal): Promise<ExtractedContent | null> {
  signal?.throwIfAborted();
  const token = await context.secrets.resolve("githubToken", signal);
  signal?.throwIfAborted();
  const base = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}`;
  const requestSignal = withTimeout(signal, 30_000);
  const warnings: string[] = [];
  async function request(path: string, raw = false): Promise<Response | null> {
    requestSignal.throwIfAborted();
    const response = await context.http.fetch(base + path, {
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      signal: requestSignal
    });
    requestSignal.throwIfAborted();
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    return response;
  }
  async function read(path: string, raw = false): Promise<string | null> {
    const response = await request(path, raw);
    return response ? readResponseText(response, requestSignal) : null;
  }
  function result(content: string): ExtractedContent {
    return {
      url,
      title: `${info.owner}/${info.repo}${info.path ? ` - ${info.path}` : ""}`,
      content,
      error: null,
      extraction: { transport: "github-api", completeness: warnings.length ? "partial" : info.type === "blob" ? "complete" : "unknown", warnings, generated: false }
    };
  }
  try {
    let ref = info.ref;
    if (!ref) {
      const metadata = await read("");
      if (!metadata) return null;
      ref = (JSON.parse(metadata) as { default_branch?: string }).default_branch;
      if (!ref) return null;
    }
    const encodedRef = encodeURIComponent(ref);
    const encodedPath = (info.path ?? "").split("/").map(encodeURIComponent).join("/");
    if (info.type === "blob") {
      const response = await request(`/contents/${encodedPath}?ref=${encodedRef}`, true);
      if (!response) return null;
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (isPdf(url, contentType)) {
        const bytes = await readResponseBytes(response, requestSignal);
        const pdf = await extractPdfToMarkdown(bytes.buffer, url, requestSignal);
        warnings.push(...pdf.warnings);
        return {
          ...result(pdf.content),
          title: pdf.title,
          extraction: { transport: "github-api", completeness: warnings.length ? "partial" : "complete", warnings, generated: false, pages: { total: pdf.pages, extracted: pdf.extractedPages } }
        };
      }
      const unsupported = () => ({ ...result(""), error: `Unsupported binary document: ${info.path}` });
      if (BINARY_EXTENSIONS.has(extname(info.path ?? "").toLowerCase()) || /^(image|audio|video)\/|application\/(zip|gzip|x-gzip|x-7z-compressed|x-rar-compressed)/.test(contentType)) {
        void response.body?.cancel().catch(() => {});
        return unsupported();
      }
      const bytes = await readResponseBytes(response, requestSignal);
      if (bytes.includes(0)) return unsupported();
      const content = new TextDecoder().decode(bytes);
      if (content.length > MAX_INLINE_CHARS) warnings.push(`File truncated at ${MAX_INLINE_CHARS} characters`);
      return result(content.slice(0, MAX_INLINE_CHARS));
    }
    if (info.type === "tree") {
      const content = await read(`/contents/${encodedPath}?ref=${encodedRef}`);
      if (!content) return null;
      const entries = JSON.parse(content) as Array<{ name: string; type: string }>;
      if (!Array.isArray(entries)) return null;
      if (entries.length > MAX_TREE_ENTRIES) warnings.push(`Directory listing truncated at ${MAX_TREE_ENTRIES} entries`);
      return result(entries.slice(0, MAX_TREE_ENTRIES).map((entry) => entry.name + (entry.type === "dir" ? "/" : "")).join("\n"));
    }
    const treeText = await read(`/git/trees/${encodedRef}?recursive=1`);
    const lines: string[] = [];
    if (treeText) {
      const tree = JSON.parse(treeText) as { tree?: Array<{ path: string }>; truncated?: boolean };
      if (tree.truncated || (tree.tree?.length ?? 0) > MAX_TREE_ENTRIES) warnings.push(`Repository listing truncated at ${MAX_TREE_ENTRIES} entries`);
      if (tree.tree?.length) lines.push("## Structure", tree.tree.slice(0, MAX_TREE_ENTRIES).map((entry) => entry.path).join("\n"));
    } else warnings.push("Repository structure could not be retrieved");
    const readme = await read(`/readme?ref=${encodedRef}`, true);
    if (readme !== null) {
      if (readme.length > 8192) warnings.push("README truncated at 8192 characters");
      lines.push("## README", readme.slice(0, 8192));
    } else warnings.push("README could not be retrieved");
    return lines.length ? result(lines.join("\n\n")) : null;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ResponseTooLargeError) throw error;
    return null;
  }
}
