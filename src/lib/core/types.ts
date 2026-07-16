export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ExtractedImage {
  src: string;
  alt: string;
  localPath?: string;
  generatedAlt?: string;
  bytes?: number;
  mime?: string;
  error?: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
  images?: ExtractedImage[];
}

export interface FetchContentOptions {
  downloadImagesDir?: string;
  describeImages?: boolean;
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
