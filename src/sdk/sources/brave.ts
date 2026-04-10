import { isBraveAvailable, searchWithBrave, type BraveSearchResult } from "../../lib/upstream/brave.js";
import { defineSource } from "../define.js";
import { mapSearchResponseEvidence, type WebEvidencePayload, type WebSourceRequest } from "./web-shared.js";
import type { Source } from "../types.js";

export type BraveEvidencePayload = WebEvidencePayload<BraveSearchResult["native"]>;

export const braveSource: Source<WebSourceRequest, BraveEvidencePayload> = defineSource({
  name: "brave",
  domain: "web",
  capabilities: ["search"],
  traits: ["api-key-required"],
  transports: ["brave-search-api"],
  async run(req, ctx) {
    ctx.trace.step("source.brave", req.query);

    if (!(await isBraveAvailable())) {
      throw new Error("Brave unavailable: missing API key");
    }

    const response = await searchWithBrave(req.query, {
      numResults: req.numResults,
      includeContent: req.includeContent,
      recencyFilter: req.recencyFilter,
      domainFilter: req.domainFilter,
      signal: req.signal
    });

    return mapSearchResponseEvidence("brave", req.query, response, response.native.provider);
  }
});
