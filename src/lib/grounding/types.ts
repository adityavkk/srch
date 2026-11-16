/** Google Search Grounding shared by every transport (Gemini API, Antigravity). */

export type GroundingTransportName = "antigravity" | "gemini-api";

export type GroundingRequest = {
  query: string;
  /** Research directive from the caller; shapes query planning and synthesis, not an enforced filter. */
  instruction?: string;
  /** Pages to read with URL context alongside search. */
  urls?: string[];
  /** Request a larger reasoning budget. Omitted means the model default. */
  thinking?: boolean;
  signal?: AbortSignal;
};

export type GroundingSource = {
  /** Original groundingChunks index; supports refer to this ID. */
  id: number;
  title: string;
  /** Destination page when the grounding redirect was resolved, otherwise the grounding URL. */
  url: string;
  /** URL as returned by Google, usually an opaque grounding redirect. */
  groundingUrl: string;
  resolved: boolean;
  domain?: string;
};

export type GroundingSupport = {
  text: string;
  /** UTF-16 offsets into `GroundedAnswer.text`, present only when verified against the text. */
  start?: number;
  end?: number;
  sourceIds: number[];
};

export type UrlRetrievalStatus = "success" | "failed" | "paywall" | "unsafe" | "unknown";

export type UrlRetrieval = {
  url: string;
  status: UrlRetrievalStatus;
};

export type GroundingUsage = {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type TransportAttempt =
  | { transport: GroundingTransportName; model: string; endpoint?: string; status: "success"; durationMs: number }
  | {
      transport: GroundingTransportName;
      model?: string;
      endpoint?: string;
      status: "failed";
      code: GroundingErrorCode;
      httpStatus?: number;
      message: string;
      durationMs: number;
    };

export type GroundedAnswer = {
  /** Generated text. Treat as a model synthesis, verified only where supports cite sources. */
  text: string;
  sources: GroundingSource[];
  supports: GroundingSupport[];
  queries: string[];
  urlRetrievals: UrlRetrieval[];
  /** Google search suggestion markup that applications may need to display with grounded answers. */
  searchEntryPoint?: string;
  transport: GroundingTransportName;
  /** Model requested from the transport. */
  model: string;
  /** Exact model version reported by the service, when present. */
  modelVersion?: string;
  usage?: GroundingUsage;
  attempts: TransportAttempt[];
};

export type GroundingErrorCode =
  | "auth_unavailable"
  | "auth_expired"
  | "auth_rejected"
  | "quota_exhausted"
  | "model_unavailable"
  | "upstream_unavailable"
  | "invalid_response"
  | "uncited_answer"
  | "unsupported_request";
