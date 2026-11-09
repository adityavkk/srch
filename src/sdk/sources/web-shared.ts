import type { SearchOptions, SearchResponse } from "../../lib/core/types.js";
import type { Evidence, SourceRequest } from "../types.js";

export type WebSourceRequest = SourceRequest & {
  numResults?: number;
  includeContent?: boolean;
  recencyFilter?: SearchOptions["recencyFilter"];
  domainFilter?: string[];
};

export type WebEvidenceContent =
  | { kind: "none" }
  | { kind: "inline"; text: string };

export type WebEvidencePayload<TNative = unknown> = {
  kind: "search-result";
  title: string;
  url: string;
  snippet: string;
  content: WebEvidenceContent;
  /** Provider-generated answer associated with the returned sources. */
  answer?: string;
  native: TNative;
};

/** Generated text without source URLs is not search evidence. */
export class WebAnswerWithoutSourcesError extends Error {
  readonly code = "web_answer_uncited";

  constructor(readonly source: string, readonly answer: string) {
    super(`${source} returned an answer without source URLs; no cited search evidence is available`);
    this.name = "WebAnswerWithoutSourcesError";
  }
}

export function mapSearchResponseEvidence<TNative>(
  source: string,
  query: string,
  response: SearchResponse & { native: TNative },
  transport: string,
  inlineContent = new Map<string, string>()
): Evidence<WebEvidencePayload<TNative>>[] {
  if (response.answer.trim() && response.results.length === 0) {
    throw new WebAnswerWithoutSourcesError(source, response.answer);
  }
  return response.results.map((result) => {
    const content = inlineContent.get(result.url);

    return {
      source,
      domain: "web",
      query,
      provenance: {
        kind: "web",
        url: result.url,
        transport,
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "search-result",
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        content: content ? { kind: "inline", text: content } : { kind: "none" },
        ...(response.answer.trim() ? { answer: response.answer } : {}),
        native: response.native
      }
    };
  });
}
