import { withTimeout } from "../core/http.js";
import { fetchWithContext, type WebSearchContext } from "../upstream/context.js";

const CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";

export interface Context7Result {
  libraryId: string | null;
  text: string;
  meaningful: boolean;
  native: unknown;
}

async function mcpCall(method: string, args: Record<string, unknown>, signal: AbortSignal, context?: WebSearchContext): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetchWithContext(CONTEXT7_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method, arguments: args } }),
    signal
  }, context);
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`Context7 MCP error ${response.status}`);
  const body = await response.text();
  signal.throwIfAborted();
  const line = body.split("\n").find((item) => item.startsWith("data:"));
  const parsed = JSON.parse((line ? line.slice(5) : body).trim()) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  };
  if (parsed.error || parsed.result?.isError) {
    const detail = parsed.error?.message ?? parsed.result?.content?.find((item) => item.type === "text")?.text ?? "Tool failed";
    throw new Error(`Context7 MCP error: ${detail.slice(0, 300)}`);
  }
  if (!parsed.result) throw new Error("Context7 MCP returned an invalid response: expected a result");
  return parsed;
}

function extractText(raw: unknown): string {
  const result = raw as { result?: { content?: Array<{ type?: string; text?: string }> } };
  return result?.result?.content?.find((item) => item.type === "text")?.text ?? "";
}

function isMeaningful(text: string): boolean {
  if (!text || text.length < 80) return false;
  if (text.toLowerCase().includes("no results found")) return false;
  if (text.toLowerCase().includes("no documentation found")) return false;
  return true;
}

export function inferLibraryName(query: string): string | null {
  const match = query.match(/\b([a-z][a-z0-9._-]*(?:\/[a-z][a-z0-9._-]*)?)\b/i);
  return match?.[1] ?? null;
}

export async function queryContext7(query: string, signal?: AbortSignal, context?: WebSearchContext): Promise<Context7Result> {
  const requestSignal = withTimeout(signal, 60_000);
  requestSignal.throwIfAborted();
  const libraryName = inferLibraryName(query);
  if (!libraryName) return { libraryId: null, text: "", meaningful: false, native: null };

  const resolveRaw = await mcpCall("resolve-library-id", { query, libraryName }, requestSignal, context);
  const resolveText = extractText(resolveRaw);

  const idMatch = resolveText.match(/\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/);
  const libraryId = idMatch?.[0] ?? null;
  if (!libraryId) return { libraryId: null, text: "", meaningful: false, native: { resolve: resolveRaw } };

  const docsRaw = await mcpCall("query-docs", { libraryId, query }, requestSignal, context);
  const docsText = extractText(docsRaw);

  return {
    libraryId,
    text: docsText,
    meaningful: isMeaningful(docsText),
    native: { resolve: resolveRaw, docs: docsRaw }
  };
}
