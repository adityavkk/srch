import type { ExtractedContent, SearchOptions } from "../../lib/core/types.js";
import { searchWithExa, searchWithExaPaid, type ExaSearchResult } from "../../lib/upstream/exa.js";
import { defineSource } from "../define.js";
import { assertWebOptions, WebOptionsError } from "../../lib/search/web-options.js";
import type { Source } from "../types.js";
import { mapSearchResponseEvidence, type WebEvidencePayload, type WebSourceRequest } from "./web-shared.js";

export type ExaSourceRequest = WebSourceRequest & {
  mode?: "mcp" | "api";
};

export type ExaEvidencePayload = WebEvidencePayload<ExaSearchResult["native"]>;

export type ExaSourceDeps = {
  searchMcp: typeof searchWithExa;
  searchApi: typeof searchWithExaPaid;
};

const defaultDeps: ExaSourceDeps = {
  searchMcp: searchWithExa,
  searchApi: searchWithExaPaid
};

function indexInlineContent(items: ExtractedContent[] | undefined): Map<string, ExtractedContent> {
  const byUrl = new Map<string, ExtractedContent>();
  for (const item of items ?? []) {
    byUrl.set(item.url, item);
  }
  return byUrl;
}

function mapEvidence(query: string, response: ExaSearchResult) {
  const inlineContent = new Map(
    [...indexInlineContent(response.inlineContent)].map(([url, item]) => [url, item.content])
  );

  return mapSearchResponseEvidence("exa", query, response, response.native.provider, inlineContent);
}

export function createExaSource(deps: ExaSourceDeps = defaultDeps): Source<ExaSourceRequest, ExaEvidencePayload> {
  return defineSource({
    name: "exa",
    domain: "web",
    capabilities: ["search"],
    traits: ["fallback-friendly", "content-capable"],
    transports: ["exa-mcp", "exa-api"],
    async run(req, ctx) {
      if (req.mode !== undefined && req.mode !== "mcp" && req.mode !== "api") {
        throw new WebOptionsError("invalid_request", "Exa mode must be mcp or api");
      }
      assertWebOptions(req.mode === "api" ? "exa-api" : "exa-mcp", req);
      ctx.trace.step("source.exa", req.query, { mode: req.mode ?? "mcp" });

      const options: SearchOptions = {
        numResults: req.numResults,
        includeContent: req.includeContent,
        recencyFilter: req.recencyFilter,
        domainFilter: req.domainFilter,
        signal: req.signal
      };

      const response = req.mode === "api"
        ? await deps.searchApi(req.query, options, ctx)
        : await deps.searchMcp(req.query, options, ctx);

      return mapEvidence(req.query, response);
    }
  });
}

export const exaSource = createExaSource();
