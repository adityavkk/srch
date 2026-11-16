import { createHash } from "node:crypto";
import { API_BASE, DEFAULT_MODEL } from "../upstream/gemini-api.js";
import { GroundingError } from "./errors.js";
import { buildGenerateContentBody } from "./request.js";
import { sendWithFallbacks, type GroundingContext, type GroundingTransport } from "./transport.js";

export type GeminiApiTransportOptions = {
  models?: readonly string[];
  baseUrl?: string;
};

/** Google Search Grounding through the public Gemini API with an API key. */
export function createGeminiApiTransport(options: GeminiApiTransportOptions = {}): GroundingTransport {
  const models = options.models ?? [DEFAULT_MODEL];
  const baseUrl = options.baseUrl ?? API_BASE;
  const key = (ctx: GroundingContext, signal?: AbortSignal) => ctx.secrets.resolve("geminiApiKey", signal);

  return {
    name: "gemini-api",
    async available(ctx, signal) {
      return !!(await key(ctx, signal));
    },
    async generate(request, ctx) {
      const apiKey = await key(ctx, request.signal);
      if (!apiKey) throw new GroundingError("auth_unavailable", "Missing Gemini API key");
      const body = JSON.stringify(buildGenerateContentBody(request));
      return sendWithFallbacks({
        transport: "gemini-api",
        // A truncated hash identifies the key's quota without exposing the key.
        quotaKey: createHash("sha256").update(apiKey).digest("hex").slice(0, 16),
        models,
        endpoints: [baseUrl],
        signal: request.signal,
        send: (model, endpoint, signal) => ctx.http.fetch(`${endpoint}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal
        })
      });
    }
  };
}
