import { fetchContent } from "../../lib/fetch/content.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";
import type { DocumentExtraction } from "../../lib/core/types.js";

export type FetchEvidencePayload = {
  kind: "document";
  url: string;
  title: string;
  content: string;
  extraction: DocumentExtraction;
};

export type FetchContentRequest = SourceRequest & {
  /** Allow generated extraction (Gemini URL context) as a last resort. Default true. */
  allowGenerated?: boolean;
};

export const fetchContentSource: Source<FetchContentRequest, FetchEvidencePayload> = defineSource({
  name: "fetch-content",
  domain: "fetch",
  capabilities: ["fetch", "extract"],
  traits: ["content-capable"],
  transports: ["http", "jina", "gemini", "github-api", "github-clone"],
  async run(req, ctx) {
    ctx.trace.step("source.fetch-content", req.query);
    const result = await fetchContent(req.query, req.signal, ctx, { allowGenerated: req.allowGenerated });
    req.signal?.throwIfAborted();
    if (result.error && !result.content.trim()) {
      throw new Error(result.error);
    }
    if (!result.content.trim()) return [];

    const extraction = result.extraction ?? {
      transport: "http",
      completeness: result.error ? "partial" : "unknown",
      warnings: result.error ? [result.error] : [],
      generated: false
    } satisfies DocumentExtraction;
    return [{
      source: "fetch-content",
      domain: "fetch",
      query: req.query,
      provenance: {
        kind: "web",
        url: result.url,
        transport: extraction.transport,
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "document",
        url: result.url,
        title: result.title,
        content: result.content,
        extraction
      }
    }];
  }
});
