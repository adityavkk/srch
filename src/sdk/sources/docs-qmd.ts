import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";

export type DocsSourceRequest = SourceRequest & {
  limit?: number;
};

export type DocsEvidencePayload = {
  kind: "doc-result";
  title: string;
  file: string;
  score: number;
  docid: string | number;
  snippet: string;
  native: unknown;
};

export const docsQmdSource: Source<DocsSourceRequest, DocsEvidencePayload> = defineSource({
  name: "docs-qmd",
  domain: "docs",
  capabilities: ["search"],
  traits: ["local-index"],
  transports: ["qmd-sdk"],
  async run(req, ctx) {
    ctx.trace.step("source.docs-qmd", req.query, { limit: req.limit ?? 8 });
    const { docsSearch } = await import("../../lib/docs/qmd.js");
    const result = await docsSearch(req.query, req.limit ?? 8);

    return result.results.map((item) => ({
      source: "docs-qmd",
      domain: "docs",
      query: req.query,
      provenance: {
        kind: "local",
        path: item.file,
        timestamp: Date.now()
      },
      payload: {
        kind: "doc-result",
        title: item.title,
        file: item.file,
        score: item.score,
        docid: item.docid,
        snippet: String(item.bestChunk ?? ""),
        native: item
      }
    }));
  }
});
