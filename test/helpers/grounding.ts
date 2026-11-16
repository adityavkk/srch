/** Builders for Gemini `generateContent` grounding responses used across tests. */

const encoder = new TextEncoder();

export type SupportFixture = { text: string; chunks: number[]; partIndex?: number; offsets?: "bytes" | "chars" | "wrong" | "none" };

export function byteRange(partText: string, segment: string): { startIndex: number; endIndex: number } {
  const start = partText.indexOf(segment);
  if (start === -1) throw new Error(`segment not in part: ${segment}`);
  const startIndex = encoder.encode(partText.slice(0, start)).length;
  return { startIndex, endIndex: startIndex + encoder.encode(segment).length };
}

export function groundingResponse(options: {
  parts?: Array<string | { text: string; thought: true }>;
  chunks?: Array<{ uri: string; title?: string } | { retrievedContext: { uri: string } }>;
  supports?: SupportFixture[];
  queries?: string[];
  urlMetadata?: Array<{ retrievedUrl: string; urlRetrievalStatus: string }>;
  usage?: boolean;
  wrap?: boolean;
} = {}): Record<string, unknown> {
  const parts = options.parts ?? ["Bun ships a built-in SQLite driver."];
  const textOf = (index: number) => {
    const part = parts[index];
    return typeof part === "string" ? part : part?.text ?? "";
  };
  const supports = (options.supports ?? []).map((support) => {
    const partIndex = support.partIndex ?? 0;
    const partText = textOf(partIndex);
    const segment: Record<string, unknown> = { text: support.text, ...(support.partIndex !== undefined ? { partIndex } : {}) };
    const mode = support.offsets ?? "bytes";
    if (mode === "bytes") Object.assign(segment, byteRange(partText, support.text));
    if (mode === "chars") {
      const start = partText.indexOf(support.text);
      Object.assign(segment, { startIndex: start, endIndex: start + support.text.length });
    }
    if (mode === "wrong") Object.assign(segment, { startIndex: 0, endIndex: 3 });
    return { segment, groundingChunkIndices: support.chunks };
  });
  const candidate = {
    content: { role: "model", parts: parts.map((part) => (typeof part === "string" ? { text: part } : part)) },
    groundingMetadata: {
      webSearchQueries: options.queries ?? ["bun sqlite"],
      groundingChunks: (options.chunks ?? [{ uri: "https://bun.sh/docs/api/sqlite", title: "bun.sh" }])
        .map((chunk) => ("uri" in chunk ? { web: chunk } : chunk)),
      groundingSupports: supports,
      searchEntryPoint: { renderedContent: "<div>Google search suggestions</div>" }
    },
    ...(options.urlMetadata ? { urlContextMetadata: { urlMetadata: options.urlMetadata } } : {})
  };
  const response = {
    candidates: [candidate],
    modelVersion: "gemini-test-001",
    ...(options.usage === false ? {} : { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } })
  };
  return options.wrap ? { response, traceId: "trace" } : response;
}

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}
