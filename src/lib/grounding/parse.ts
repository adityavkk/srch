import { GroundingError } from "./errors.js";
import type { GroundingSource, GroundingSupport, GroundingUsage, UrlRetrieval, UrlRetrievalStatus } from "./types.js";

/** Transport-neutral content of one grounded response, before redirect resolution. */
export type ParsedGrounding = {
  text: string;
  sources: GroundingSource[];
  supports: GroundingSupport[];
  queries: string[];
  urlRetrievals: UrlRetrieval[];
  searchEntryPoint?: string;
  modelVersion?: string;
  usage?: GroundingUsage;
};

type JsonRecord = Record<string, unknown>;

const PART_SEPARATOR = "\n\n";
const encoder = new TextEncoder();

const URL_STATUS: Record<string, UrlRetrievalStatus> = {
  URL_RETRIEVAL_STATUS_SUCCESS: "success",
  URL_RETRIEVAL_STATUS_ERROR: "failed",
  URL_RETRIEVAL_STATUS_PAYWALL: "paywall",
  URL_RETRIEVAL_STATUS_UNSAFE: "unsafe"
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function int(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Field lookup tolerant of camelCase (REST JSON) and snake_case (proto JSON) names. */
function field(record: JsonRecord | undefined, camel: string): unknown {
  if (!record) return undefined;
  if (camel in record) return record[camel];
  return record[camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
}

function recordField(record: JsonRecord | undefined, camel: string): JsonRecord | undefined {
  const value = field(record, camel);
  return isRecord(value) ? value : undefined;
}

function arrayField(record: JsonRecord | undefined, camel: string): unknown[] {
  const value = field(record, camel);
  return Array.isArray(value) ? value : [];
}

/** Map each UTF-8 byte offset to the UTF-16 index of the character containing it. */
function byteToCharIndex(text: string): number[] {
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const width = encoder.encode(char).length;
    for (let byte = 0; byte < width; byte++) map.push(index);
    index += char.length;
  }
  map.push(text.length);
  return map;
}

type Part = { index: number; text: string; offset: number; bytes: Uint8Array; byteMap: number[] };

/**
 * Google reports segment offsets as UTF-8 bytes within a content part. Accept them only
 * when the bytes decode to the segment text; otherwise fall back to locating the text.
 */
function locate(part: Part, segment: JsonRecord): { start: number; end: number } | undefined {
  const text = field(segment, "text");
  if (typeof text !== "string" || !text.trim()) return undefined;
  const startByte = int(field(segment, "startIndex")) ?? 0;
  const endByte = int(field(segment, "endIndex"));
  if (endByte !== undefined && endByte > startByte && endByte <= part.bytes.length
    && new TextDecoder().decode(part.bytes.subarray(startByte, endByte)) === text) {
    return { start: part.offset + part.byteMap[startByte]!, end: part.offset + part.byteMap[endByte]! };
  }
  const found = part.text.indexOf(text);
  return found === -1 ? undefined : { start: part.offset + found, end: part.offset + found + text.length };
}

function parseUsage(metadata: JsonRecord | undefined): GroundingUsage | undefined {
  if (!metadata) return undefined;
  const usage: GroundingUsage = {
    promptTokens: int(field(metadata, "promptTokenCount")),
    outputTokens: int(field(metadata, "candidatesTokenCount")),
    totalTokens: int(field(metadata, "totalTokenCount"))
  };
  return Object.values(usage).some((value) => value !== undefined) ? usage : undefined;
}

function parseUrlRetrievals(candidate: JsonRecord): UrlRetrieval[] {
  return records(field(recordField(candidate, "urlContextMetadata"), "urlMetadata")).flatMap((item) => {
    const url = str(field(item, "retrievedUrl"));
    if (!url) return [];
    const status = str(field(item, "urlRetrievalStatus"));
    return [{ url, status: status ? URL_STATUS[status] ?? "unknown" : "unknown" }];
  });
}

/**
 * Parse a `generateContent` response, either direct (Gemini API) or wrapped in
 * `{ response }` (Antigravity). Thought parts are excluded from the answer.
 */
export function parseGroundingResponse(data: unknown): ParsedGrounding {
  const root = isRecord(data) && isRecord(data.response) ? data.response : data;
  if (!isRecord(root)) throw new GroundingError("invalid_response", "Grounding response is not a JSON object");
  const candidate = records(root.candidates)[0];
  if (!candidate) {
    const error = isRecord(root.error) ? str(root.error.message) : undefined;
    const blocked = str(field(recordField(root, "promptFeedback"), "blockReason"));
    throw new GroundingError("invalid_response", error ?? (blocked ? `Prompt blocked: ${blocked}` : "Grounding response had no candidate"));
  }

  const content = isRecord(candidate.content) ? candidate.content : undefined;
  const parts: Part[] = [];
  let offset = 0;
  for (const [index, part] of records(content?.parts).entries()) {
    if (part.thought === true || typeof part.text !== "string" || !part.text) continue;
    if (parts.length > 0) offset += PART_SEPARATOR.length;
    parts.push({ index, text: part.text, offset, bytes: encoder.encode(part.text), byteMap: byteToCharIndex(part.text) });
    offset += part.text.length;
  }
  const text = parts.map((part) => part.text).join(PART_SEPARATOR);

  const grounding = recordField(candidate, "groundingMetadata");
  const sources = records(field(grounding, "groundingChunks")).flatMap((chunk, id): GroundingSource[] => {
    const web = isRecord(chunk.web) ? chunk.web : undefined;
    const uri = str(web?.uri);
    if (!uri) return [];
    return [{ id, title: str(web?.title) ?? uri, url: uri, groundingUrl: uri, resolved: false, ...(str(web?.domain) ? { domain: str(web?.domain) } : {}) }];
  });
  const sourceIds = new Set(sources.map((source) => source.id));

  const supports = records(field(grounding, "groundingSupports")).flatMap((support): GroundingSupport[] => {
    const segment = isRecord(support.segment) ? support.segment : undefined;
    const segmentText = typeof segment?.text === "string" ? segment.text.trim() : "";
    const ids = arrayField(support, "groundingChunkIndices")
      .filter((id): id is number => typeof id === "number" && sourceIds.has(id));
    if (!segment || !segmentText || ids.length === 0) return [];
    const partIndex = int(field(segment, "partIndex")) ?? parts[0]?.index;
    const part = parts.find((item) => item.index === partIndex);
    if (!part) return [];
    const range = locate(part, segment);
    return [{ text: segmentText, ...(range ?? {}), sourceIds: [...new Set(ids)] }];
  });

  const queries = arrayField(grounding, "webSearchQueries").flatMap((query) => {
    const value = str(query);
    return value ? [value] : [];
  });
  const searchEntryPoint = str(field(recordField(grounding, "searchEntryPoint"), "renderedContent"));
  const modelVersion = str(field(root, "modelVersion"));
  const usage = parseUsage(recordField(root, "usageMetadata"));

  return {
    text,
    sources,
    supports,
    queries,
    urlRetrievals: parseUrlRetrievals(candidate),
    ...(searchEntryPoint ? { searchEntryPoint } : {}),
    ...(modelVersion ? { modelVersion } : {}),
    ...(usage ? { usage } : {})
  };
}

/** Report every requested URL, marking ones absent from URL-context metadata as unknown. */
export function mergeRequestedUrls(requested: string[], retrievals: UrlRetrieval[]): UrlRetrieval[] {
  const normalize = (url: string) => url.replace(/\/+$/, "");
  const known = new Set(retrievals.map((item) => normalize(item.url)));
  return [...retrievals, ...requested.filter((url) => !known.has(normalize(url))).map((url) => ({ url, status: "unknown" as const }))];
}
