import { extractWithExa } from "../../lib/fetch/exa.js";
import { defineSource } from "../define.js";
import type { Source } from "../types.js";
import type { FetchEvidencePayload, FetchSourceRequest } from "./fetch-content.js";

// Same shape as fetch-content's request, so the strategy can pass one request to both.
export type ExaFetchSourceRequest = FetchSourceRequest;

export type ExaFetchSourceDeps = {
  extract: typeof extractWithExa;
};

const defaultDeps: ExaFetchSourceDeps = {
  extract: extractWithExa
};

export function createExaFetchSource(deps: ExaFetchSourceDeps = defaultDeps): Source<ExaFetchSourceRequest, FetchEvidencePayload> {
  return defineSource({
    name: "exa-fetch",
    domain: "fetch",
    capabilities: ["fetch", "extract"],
    traits: ["fallback-friendly", "content-capable"],
    transports: ["exa-mcp"],
    async run(req, ctx) {
      ctx.trace.step("source.exa-fetch", req.query);
      const result = await deps.extract(req.query, req.signal, {
        downloadImagesDir: req.downloadImagesDir,
        describeImages: req.describeImages
      });
      if (result.error || !result.content.trim()) {
        throw new Error(result.error || "Exa returned no text");
      }

      return [{
        source: "exa-fetch",
        domain: "fetch",
        query: req.query,
        provenance: {
          kind: "web",
          url: result.url,
          transport: "exa-mcp",
          timestamp: Date.now(),
          cached: false
        },
        payload: {
          kind: "document",
          url: result.url,
          title: result.title,
          content: result.content,
          images: result.images ?? []
        }
      }];
    }
  });
}

export const exaFetchSource = createExaFetchSource();
