import { callExaMcp } from "../upstream/exa.js";

export async function codeSearch(query: string, maxTokens = 5000, signal?: AbortSignal): Promise<string> {
  const normalized = query.trim();
  if (!normalized) throw new Error("Missing query");
  return callExaMcp("get_code_context_exa", { query: normalized, tokensNum: maxTokens }, signal);
}
