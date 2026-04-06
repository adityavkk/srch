import { inferGithubRepo, queryDeepWiki, type DeepWikiResult } from "../secondary/deepwiki.js";
import { callExaMcpRaw, exaMcpText, type ExaMcpResponse } from "../upstream/exa-mcp.js";

export interface CodeSearchResult {
  query: string;
  maxTokens: number;
  text: string;
  native: {
    provider: "exa-mcp";
    toolName: "get_code_context_exa";
    response: unknown;
  };
  secondary?: {
    source: "deepwiki";
    repo: string;
    text: string;
    native: unknown;
  };
}

function mergeSecondary(primary: string, secondary: DeepWikiResult | null): string {
  if (!secondary?.meaningful) return primary;
  return `${primary}\n\n---\nSecondary source: DeepWiki (${secondary.repo})\n${secondary.text}`;
}

export async function codeSearch(query: string, maxTokens = 5000, signal?: AbortSignal): Promise<CodeSearchResult> {
  const normalized = query.trim();
  if (!normalized) throw new Error("Missing query");
  const repo = inferGithubRepo(normalized);
  let secondary: DeepWikiResult | null = null;
  if (repo) {
    try {
      secondary = await queryDeepWiki(repo, normalized, signal);
    } catch {
      secondary = null;
    }
  }

  let response: ExaMcpResponse | { error: string };
  let primaryText = "";
  let primaryError: Error | null = null;
  try {
    response = await callExaMcpRaw("get_code_context_exa", { query: normalized, tokensNum: maxTokens }, signal);
    primaryText = exaMcpText(response);
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
    if (!secondary?.meaningful) throw primaryError;
    response = { error: primaryError.message };
    primaryText = "Primary source unavailable (Exa code context failed).";
  }

  return {
    query: normalized,
    maxTokens,
    text: mergeSecondary(primaryText, secondary),
    native: {
      provider: "exa-mcp",
      toolName: "get_code_context_exa",
      response
    },
    ...(secondary?.meaningful ? {
      secondary: {
        source: "deepwiki" as const,
        repo: secondary.repo,
        text: secondary.text,
        native: secondary.native
      }
    } : {})
  };
}
