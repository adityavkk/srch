import { isPerplexityAvailable, searchWithPerplexity, type PerplexitySearchResult } from "../../lib/upstream/perplexity.js";
import { defineSource } from "../define.js";
import { mapSearchResponseEvidence, type WebEvidencePayload, type WebSourceRequest } from "./web-shared.js";
import type { Source } from "../types.js";

export type PerplexityEvidencePayload = WebEvidencePayload<PerplexitySearchResult["native"]>;

export const perplexitySource: Source<WebSourceRequest, PerplexityEvidencePayload> = defineSource({
  name: "perplexity",
  domain: "web",
  capabilities: ["search"],
  traits: ["api-key-required"],
  transports: ["perplexity-api"],
  async run(req, ctx) {
    ctx.trace.step("source.perplexity", req.query);

    if (!(await isPerplexityAvailable())) {
      throw new Error("Perplexity unavailable: missing API key");
    }

    const response = await searchWithPerplexity(req.query, {
      numResults: req.numResults,
      includeContent: req.includeContent,
      recencyFilter: req.recencyFilter,
      domainFilter: req.domainFilter,
      signal: req.signal
    });

    return mapSearchResponseEvidence("perplexity", req.query, response, response.native.provider);
  }
});
