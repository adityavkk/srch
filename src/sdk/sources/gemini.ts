import { isGeminiApiAvailable } from "../../lib/upstream/gemini-api.js";
import { searchWithGemini, type GeminiSearchResult } from "../../lib/upstream/gemini.js";
import { searchWithGeminiWeb, type GeminiWebSearchResult } from "../../lib/upstream/gemini-web.js";
import { defineSource } from "../define.js";
import { mapSearchResponseEvidence, type WebEvidencePayload, type WebSourceRequest } from "./web-shared.js";
import type { Source } from "../types.js";

export type GeminiSourceRequest = WebSourceRequest & {
  transport?: "auto" | "web" | "api";
};

export type GeminiEvidencePayload = WebEvidencePayload<GeminiSearchResult["native"] | GeminiWebSearchResult["native"]>;

async function runWeb(query: string, req: GeminiSourceRequest) {
  const response = await searchWithGeminiWeb(query, {
    numResults: req.numResults,
    includeContent: req.includeContent,
    recencyFilter: req.recencyFilter,
    domainFilter: req.domainFilter,
    signal: req.signal
  });

  if (!response) {
    throw new Error("Gemini web unavailable: no logged-in browser profile found");
  }

  return response;
}

async function runApi(query: string, req: GeminiSourceRequest) {
  return searchWithGemini(query, {
    numResults: req.numResults,
    includeContent: req.includeContent,
    recencyFilter: req.recencyFilter,
    domainFilter: req.domainFilter,
    signal: req.signal
  });
}

export const geminiSource: Source<GeminiSourceRequest, GeminiEvidencePayload> = defineSource({
  name: "gemini",
  domain: "web",
  capabilities: ["search"],
  traits: ["multi-transport"],
  transports: ["gemini-web", "gemini-api"],
  async run(req, ctx) {
    const transport = req.transport ?? "auto";
    ctx.trace.step("source.gemini", req.query, { transport });

    const response = transport === "web"
      ? await runWeb(req.query, req)
      : transport === "api"
        ? await runApi(req.query, req)
        : await isGeminiApiAvailable()
          ? await runApi(req.query, req)
          : await runWeb(req.query, req);

    return mapSearchResponseEvidence<GeminiSearchResult["native"] | GeminiWebSearchResult["native"]>(
      "gemini",
      req.query,
      response,
      response.native.provider
    );
  }
});
