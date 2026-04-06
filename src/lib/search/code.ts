import { callExaMcpRaw, exaMcpText } from "../upstream/exa-mcp.js";

export interface CodeSearchResult {
  query: string;
  maxTokens: number;
  text: string;
  native: {
    provider: "exa-mcp";
    toolName: "get_code_context_exa";
    response: unknown;
  };
}

export async function codeSearch(query: string, maxTokens = 5000, signal?: AbortSignal): Promise<CodeSearchResult> {
  const normalized = query.trim();
  if (!normalized) throw new Error("Missing query");
  const response = await callExaMcpRaw("get_code_context_exa", { query: normalized, tokensNum: maxTokens }, signal);
  return {
    query: normalized,
    maxTokens,
    text: exaMcpText(response),
    native: {
      provider: "exa-mcp",
      toolName: "get_code_context_exa",
      response
    }
  };
}
