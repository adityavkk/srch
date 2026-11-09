import { withTimeout } from "../core/http.js";
import { fetchWithContext, type WebSearchContext } from "../upstream/context.js";

const DEEPWIKI_URL = "https://mcp.deepwiki.com/mcp";

export interface DeepWikiResult {
  repo: string;
  text: string;
  meaningful: boolean;
  native: unknown;
}

export function inferGithubRepo(query: string): string | null {
  const explicitUrl = query.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)?.[1];
  if (explicitUrl) return explicitUrl.replace(/\.git$/, "");

  const explicitRepo = query.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  if (!explicitRepo) return null;
  const candidate = explicitRepo[1];
  if (["http://", "https://"].some((prefix) => candidate.startsWith(prefix))) return null;
  if (!candidate.includes("/")) return null;
  return candidate;
}

function isMeaningful(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("repository not found")) return false;
  if (normalized.includes("visit https://deepwiki.com to index it")) return false;
  if (normalized.length < 80) return false;
  return true;
}

export async function queryDeepWiki(repo: string, question: string, signal?: AbortSignal, context?: WebSearchContext): Promise<DeepWikiResult> {
  const requestSignal = withTimeout(signal, 60_000);
  requestSignal.throwIfAborted();
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "ask_question",
      arguments: {
        repoName: repo,
        question
      }
    }
  };

  const response = await fetchWithContext(DEEPWIKI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(request),
    signal: requestSignal
  }, context);
  requestSignal.throwIfAborted();

  if (!response.ok) {
    throw new Error(`DeepWiki MCP error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.text();
  requestSignal.throwIfAborted();
  const line = body.split("\n").find((item) => item.startsWith("data:"));
  const parsed = JSON.parse((line ? line.slice(5) : body).trim()) as {
    error?: { message?: string };
    result?: {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: { result?: string };
      isError?: boolean;
    };
  };

  if (parsed.error || parsed.result?.isError) {
    const detail = parsed.error?.message ?? parsed.result?.content?.find((item) => item.type === "text")?.text ?? "Tool failed";
    throw new Error(`DeepWiki MCP error: ${detail.slice(0, 300)}`);
  }
  if (!parsed.result) throw new Error("DeepWiki MCP returned an invalid response: expected a result");

  const text = parsed.result?.structuredContent?.result
    ?? parsed.result?.content?.find((item) => item.type === "text")?.text
    ?? "";

  return {
    repo,
    text,
    meaningful: isMeaningful(text),
    native: {
      provider: "deepwiki-mcp",
      request,
      response: parsed
    }
  };
}
