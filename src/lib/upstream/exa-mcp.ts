import { withTimeout } from "../core/http.js";

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

export async function callExaMcpRaw(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ExaMcpResponse> {
  const response = await fetch("https://mcp.exa.ai/mcp", {
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
    signal: withTimeout(signal, 60_000)
  });

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

  throw new Error("Exa MCP returned empty content");
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
