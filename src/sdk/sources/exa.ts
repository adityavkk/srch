import type { ExtractedContent, SearchOptions } from "../../lib/core/types.js";
import { searchWithExa, searchWithExaPaid, type ExaSearchResult } from "../../lib/upstream/exa.js";
import { defineSource } from "../define.js";
import type { Evidence, Source, SourceRequest } from "../types.js";

export type ExaSourceRequest = SourceRequest & {
  mode?: "mcp" | "api";
  numResults?: number;
  includeContent?: boolean;
  recencyFilter?: SearchOptions["recencyFilter"];
  domainFilter?: string[];
};

export type ExaEvidencePayload = {
  kind: "search-result";
  title: string;
  url: string;
  snippet: string;
  content:
    | { kind: "none" }
    | { kind: "inline"; text: string };
  native: ExaSearchResult["native"];
};

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

function mapEvidence(query: string, response: ExaSearchResult): Evidence<ExaEvidencePayload>[] {
  const inlineContent = indexInlineContent(response.inlineContent);

  return response.results.map((result) => {
    const content = inlineContent.get(result.url);

    return {
      source: "exa",
      domain: "web",
      query,
      provenance: {
        kind: "web",
        url: result.url,
        transport: response.native.provider,
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "search-result",
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        content: content
          ? { kind: "inline", text: content.content }
          : { kind: "none" },
        native: response.native
      }
    };
  });
}

export function createExaSource(deps: ExaSourceDeps = defaultDeps): Source<ExaSourceRequest, ExaEvidencePayload> {
  return defineSource({
    name: "exa",
    domain: "web",
    capabilities: ["search"],
    traits: ["fallback-friendly", "content-capable"],
    transports: ["exa-mcp", "exa-api"],
    async run(req, ctx) {
      ctx.trace.step("source.exa", req.query, { mode: req.mode ?? "mcp" });

      const options: SearchOptions = {
        numResults: req.numResults,
        includeContent: req.includeContent,
        recencyFilter: req.recencyFilter,
        domainFilter: req.domainFilter,
        signal: req.signal
      };

      const response = req.mode === "api"
        ? await deps.searchApi(req.query, options)
        : await deps.searchMcp(req.query, options);

      return mapEvidence(req.query, response);
    }
  });
}

export const exaSource = createExaSource();
