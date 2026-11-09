import { withTimeout } from "../core/http.js";
import { fetchWithContext, type WebSearchContext } from "./context.js";

export interface ExaMcpResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

export async function callExaMcpRaw(toolName: string, args: Record<string, unknown>, signal?: AbortSignal, context?: WebSearchContext): Promise<ExaMcpResponse> {
  const requestSignal = withTimeout(signal, 60_000);
  let response: Response;
  try {
    requestSignal.throwIfAborted();
    response = await fetchWithContext("https://mcp.exa.ai/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args }
      }),
      signal: requestSignal
    }, context);
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason;
    const original = error instanceof Error ? error : undefined;
    if (original?.name === "AbortError" || original?.name === "TimeoutError") throw error;
    const cause = original?.cause;
    const code = original && "code" in original
      ? original.code
      : cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    const codeLabel = typeof code === "string" || typeof code === "number" ? ` (${code})` : "";
    throw Object.assign(new Error(`Exa MCP transport error${codeLabel}: ${original?.message ?? String(error)}`, { cause: error }),
      code === undefined ? {} : { code });
  }

  if (!response.ok) {
    throw new Error(`Exa MCP error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.text();
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as ExaMcpResponse;
      if (parsed.result || parsed.error) return parsed;
    } catch {
    }
  }

  try {
    const parsed = JSON.parse(body) as ExaMcpResponse;
    if (parsed.result || parsed.error) return parsed;
  } catch {
  }

  throw new Error("Exa MCP returned an invalid response: expected a JSON-RPC result or error");
}

export function exaMcpText(response: ExaMcpResponse): string {
  if (response.error) {
    throw new Error(`Exa MCP error${typeof response.error.code === "number" ? ` ${response.error.code}` : ""}: ${response.error.message || "Unknown error"}`);
  }
  if (response.result?.isError) {
    const message = response.result.content?.find((item) => item.type === "text" && item.text)?.text?.trim();
    throw new Error(message || "Exa MCP returned an error");
  }
  const text = response.result?.content?.find((item) => item.type === "text" && item.text?.trim())?.text;
  if (!text) throw new Error("Exa MCP returned empty content");
  return text;
}
