export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
  inlineContent?: ExtractedContent[];
}

export type SearchProvider = "auto" | "exa" | "brave" | "perplexity" | "gemini";

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  includeContent?: boolean;
  signal?: AbortSignal;
}
