import { isRecord } from "../core/guards.js";
import { withTimeout } from "../core/http.js";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

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

export interface ExaMcpTool {
  name: string;
  arguments: string[];
  required: string[];
}

function isOptional(value: unknown, type: "string" | "number" | "boolean"): boolean {
  return value === undefined || typeof value === type;
}

function isExaMcpResponse(value: unknown): value is ExaMcpResponse {
  if (!isRecord(value)) return false;
  const { result, error } = value;
  if (error !== undefined) {
    return isRecord(error) && isOptional(error.code, "number") && isOptional(error.message, "string");
  }
  return isRecord(result)
    && isOptional(result.isError, "boolean")
    && (result.content === undefined || (Array.isArray(result.content)
      && result.content.every((item: unknown) => isRecord(item) && isOptional(item.type, "string") && isOptional(item.text, "string"))));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// The endpoint answers with server-sent events or plain JSON. Return every JSON-RPC message found.
async function postExaMcp(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown[]> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: withTimeout(signal, 60_000)
  });

  if (!response.ok) {
    throw new Error(`Exa MCP error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.text();
  const events = body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
  return [...events, body].map(parseJson).filter((message) => message !== undefined);
}

export async function callExaMcpRaw(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ExaMcpResponse> {
  const messages = await postExaMcp("tools/call", { name: toolName, arguments: args }, signal);
  const response = messages.find(isExaMcpResponse);
  if (!response) throw new Error("Exa MCP returned empty content");
  return response;
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

function readTool(value: unknown): ExaMcpTool[] {
  if (!isRecord(value) || typeof value.name !== "string") return [];
  const schema: Record<string, unknown> = isRecord(value.inputSchema) ? value.inputSchema : {};
  return [{
    name: value.name,
    arguments: isRecord(schema.properties) ? Object.keys(schema.properties) : [],
    required: Array.isArray(schema.required) ? schema.required.filter((item: unknown): item is string => typeof item === "string") : []
  }];
}

export async function listExaMcpTools(signal?: AbortSignal): Promise<ExaMcpTool[]> {
  for (const message of await postExaMcp("tools/list", {}, signal)) {
    if (!isRecord(message)) continue;
    if (isRecord(message.error)) {
      throw new Error(`Exa MCP error: ${typeof message.error.message === "string" ? message.error.message : "Unknown error"}`);
    }
    if (isRecord(message.result) && Array.isArray(message.result.tools)) {
      return message.result.tools.flatMap(readTool);
    }
  }
  throw new Error("Exa MCP returned no tool list");
}
