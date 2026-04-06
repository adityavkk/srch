import { withTimeout } from "../core/http.js";

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

export async function queryDeepWiki(repo: string, question: string, signal?: AbortSignal): Promise<DeepWikiResult> {
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

  const response = await fetch(DEEPWIKI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(request),
    signal: withTimeout(signal, 60_000)
  });

  if (!response.ok) {
    throw new Error(`DeepWiki MCP error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.text();
  const line = body.split("\n").find((item) => item.startsWith("data:"));
  const parsed = JSON.parse((line ? line.slice(5) : body).trim()) as {
    result?: {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: { result?: string };
      isError?: boolean;
    };
  };

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
