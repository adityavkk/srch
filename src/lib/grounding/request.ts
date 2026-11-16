import { GroundingError } from "./errors.js";
import type { GroundingRequest } from "./types.js";

/** URL context accepts at most 20 URLs per request. */
export const MAX_GROUNDING_URLS = 20;
const THINKING_BUDGET = 4096;

export const GROUNDING_SYSTEM_INSTRUCTION = `You are a careful research assistant using Google Search grounding.
Return a compact evidence brief with exactly these sections:
## Findings
## Gaps
## Next checks

Rules:
- Verify each claim inside the specific item, function, or section it refers to. Do not copy an attribute from a neighboring entry on the same page.
- Prefer primary documentation and exact names, versions, and constraints over marketing summaries.
- If a fact is not supported by a retrieved source, put it under Gaps instead of stating it as a finding.
- If a requested URL could not be read, say so under Gaps.
- Keep the brief short enough for an interactive agent tool call.`;

/** Gemini `generateContent` body, shared by the Gemini API and the Antigravity envelope. */
export type GenerateContentBody = {
  systemInstruction: { role: "user"; parts: Array<{ text: string }> };
  contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
  tools: Array<{ googleSearch: Record<string, never> } | { urlContext: Record<string, never> }>;
  generationConfig: { thinkingConfig?: { thinkingBudget: number; includeThoughts: false } };
};

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Reject malformed requests before credentials are resolved or a network call is made. */
export function validateGroundingRequest(request: GroundingRequest): void {
  if (typeof request.query !== "string" || !request.query.trim()) {
    throw new GroundingError("unsupported_request", "Query must be a non-empty string");
  }
  if (request.instruction !== undefined && typeof request.instruction !== "string") {
    throw new GroundingError("unsupported_request", "instruction must be a string");
  }
  if (request.thinking !== undefined && typeof request.thinking !== "boolean") {
    throw new GroundingError("unsupported_request", "thinking must be a boolean");
  }
  const urls = request.urls ?? [];
  if (!Array.isArray(urls) || urls.length > MAX_GROUNDING_URLS) {
    throw new GroundingError("unsupported_request", `urls must be an array of at most ${MAX_GROUNDING_URLS} URLs`);
  }
  if (urls.some((url) => typeof url !== "string" || !validUrl(url))) {
    throw new GroundingError("unsupported_request", "urls must be absolute http(s) URLs without credentials");
  }
}

export function buildGenerateContentBody(request: GroundingRequest): GenerateContentBody {
  const instruction = request.instruction?.trim();
  const urls = request.urls ?? [];
  const system = instruction
    ? `${GROUNDING_SYSTEM_INSTRUCTION}\n\nDirective from the requesting agent; follow it when planning searches and writing the brief:\n${instruction}`
    : GROUNDING_SYSTEM_INSTRUCTION;
  const prompt = urls.length > 0
    ? `${request.query.trim()}\n\nRead these URLs in detail:\n${urls.join("\n")}`
    : request.query.trim();

  return {
    systemInstruction: { role: "user", parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: urls.length > 0 ? [{ googleSearch: {} }, { urlContext: {} }] : [{ googleSearch: {} }],
    // Some Lite models reject an explicit zero budget, so only opt in when asked.
    generationConfig: request.thinking
      ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET, includeThoughts: false } }
      : {}
  };
}
