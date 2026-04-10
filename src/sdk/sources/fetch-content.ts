import { fetchContent } from "../../lib/fetch/content.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";

export type FetchEvidencePayload = {
  kind: "document";
  url: string;
  title: string;
  content: string;
};

export const fetchContentSource: Source<SourceRequest, FetchEvidencePayload> = defineSource({
  name: "fetch-content",
  domain: "fetch",
  capabilities: ["fetch", "extract"],
  traits: ["content-capable"],
  transports: ["http|jina|gemini|github"],
  async run(req, ctx) {
    ctx.trace.step("source.fetch-content", req.query);
    const result = await fetchContent(req.query, req.signal);
    if (result.error && !result.content.trim()) {
      throw new Error(result.error);
    }

    return [{
      source: "fetch-content",
      domain: "fetch",
      query: req.query,
      provenance: {
        kind: "web",
        url: result.url,
        transport: "http|jina|gemini|github",
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "document",
        url: result.url,
        title: result.title,
        content: result.content
      }
    }];
  }
});
