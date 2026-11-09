export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface DocumentExtraction {
  transport: "http" | "jina" | "gemini" | "github-api" | "github-clone";
  completeness: "complete" | "partial" | "unknown";
  warnings: string[];
  generated: boolean;
  pages?: { total: number; extracted: number };
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
  extraction?: DocumentExtraction;
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
