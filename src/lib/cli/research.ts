import { renderGroundedAnswer } from "../grounding/render.js";
import type { WebResearchPayload, WebResearchRequest } from "../../sdk/strategies/web-research.js";
import type { Evidence } from "../../sdk/types.js";
import { parseWebProviders } from "../config/commands.js";
import { getStringFlag, getStringFlags, type FlagValue } from "./flags.js";
import { createSdkClient, type RenderedCommand } from "./sdk.js";

/** Flags that only apply to `--research`. */
export const RESEARCH_ONLY_FLAGS = ["url", "instruction", "thinking", "transport", "no-fallback"] as const;
/** Retrieval filters grounded research cannot enforce. */
const RETRIEVAL_ONLY_FLAGS = ["provider", "hq", "recent", "domain"] as const;
const TRANSPORTS = ["auto", "antigravity", "gemini-api"] as const;

function numberFlag(flags: Map<string, FlagValue>, name: string): number | undefined {
  const value = getStringFlag(flags, name);
  return value === undefined ? undefined : Number(value);
}

export function researchOptionsFromFlags(flags: Map<string, FlagValue>): Omit<WebResearchRequest, "query"> & { trace: boolean } {
  const conflict = RETRIEVAL_ONLY_FLAGS.find((flag) => flags.has(flag));
  if (conflict) throw new Error(`--${conflict} cannot be combined with --research`);
  const transport = getStringFlag(flags, "transport") ?? "auto";
  if (!TRANSPORTS.some((item) => item === transport)) throw new Error(`--transport must be ${TRANSPORTS.join("|")}`);
  const providers = getStringFlag(flags, "providers");
  return {
    instruction: getStringFlag(flags, "instruction"),
    urls: getStringFlags(flags, "url"),
    thinking: flags.has("thinking") || undefined,
    transport: transport as (typeof TRANSPORTS)[number],
    fallback: flags.has("no-fallback") ? "none" : "retrieval",
    providers: providers === undefined ? undefined : parseWebProviders(providers),
    numResults: numberFlag(flags, "limit"),
    timeoutMs: numberFlag(flags, "timeout-ms"),
    trace: flags.has("verbose")
  };
}

function resultRow(item: Evidence<WebResearchPayload>) {
  const payload = item.payload;
  return payload.kind === "document"
    ? { kind: "document" as const, source: item.source, title: payload.title, url: payload.url, completeness: payload.extraction.completeness }
    : { kind: "search-result" as const, source: item.source, title: payload.title, url: payload.url, snippet: payload.snippet };
}

/** `search web --research`: grounded answer, or a labeled retrieval-only result. */
export async function runResearchCommand(query: string, options: Omit<WebResearchRequest, "query"> & { trace?: boolean }): Promise<RenderedCommand> {
  const { trace, ...request } = options;
  const client = await createSdkClient(trace);
  const result = await client.run({ ...request, domain: "web", strategy: "web/research", query });
  if (result.kind === "error") return { kind: "error", error: result };

  const research = result.research;
  const results = result.kind === "success" ? result.evidence.map(resultRow) : [];
  const data = { query, kind: result.kind, research, results, summary: result.summary, suggestions: result.suggestions, trace: result.trace };

  if (research.kind === "grounded") {
    return { kind: "ok", data: { ...data, answer: research.answer.text }, text: renderGroundedAnswer(research.answer) };
  }
  const lines = [
    `Grounded research unavailable (${research.reason.code}): ${research.reason.message}`,
    `Recovery: ${research.reason.recovery}`,
    "No answer was generated. Retrieved sources:",
    ...(results.length === 0 ? ["(none)"] : results.map((row, index) => `${index + 1}. ${row.title || row.url}\n   ${row.url}${row.kind === "document" ? ` (fetched document, ${row.completeness})` : ""}`)),
    ...(research.urlRetrievals.length > 0 ? ["", "Requested URLs:", ...research.urlRetrievals.map((item) => `- ${item.url}: ${item.status}`)] : [])
  ];
  return { kind: "ok", data, text: lines.join("\n") };
}
