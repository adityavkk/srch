import { runGrounding, defaultGroundingTransports, type GroundingTransportSelection } from "../../lib/grounding/run.js";
import type { GroundingTransport } from "../../lib/grounding/transport.js";
import type { GroundedAnswer, GroundingSource } from "../../lib/grounding/types.js";
import { assertWebOptions } from "../../lib/search/web-options.js";
import { defineSource } from "../define.js";
import type { Evidence, Source } from "../types.js";
import type { WebEvidencePayload, WebSourceRequest } from "./web-shared.js";

const SNIPPET_CHARACTERS = 500;

export type GoogleSourceRequest = WebSourceRequest & {
  /** `auto` tries the signed-in Antigravity account, then the Gemini API key. */
  transport?: GroundingTransportSelection;
  instruction?: string;
  urls?: string[];
  thinking?: boolean;
  /** Require answer text (default). Plain link retrieval turns this off to accept sources alone. */
  requireAnswer?: boolean;
};

export type GoogleNative = {
  provider: "google";
  grounding: GroundedAnswer;
};

export type GoogleEvidencePayload = WebEvidencePayload<GoogleNative>;

/** Text of the claims that cite a source, used as its excerpt. */
function snippetFor(source: GroundingSource, answer: GroundedAnswer): string {
  const claims = [...new Set(answer.supports.filter((support) => support.sourceIds.includes(source.id)).map((support) => support.text))];
  const joined = claims.join(" ");
  return joined.length > SNIPPET_CHARACTERS ? `${joined.slice(0, SNIPPET_CHARACTERS - 3)}...` : joined;
}

/** One web evidence item per grounding source; every item carries the complete answer. */
export function groundingEvidence(query: string, answer: GroundedAnswer, numResults?: number): Evidence<GoogleEvidencePayload>[] {
  const native: GoogleNative = { provider: "google", grounding: answer };
  const timestamp = Date.now();
  return answer.sources.slice(0, numResults ?? answer.sources.length).map((source) => ({
    source: "google",
    domain: "web",
    query,
    provenance: { kind: "web", url: source.url, transport: answer.transport, timestamp, cached: false },
    payload: {
      kind: "search-result",
      title: source.title,
      url: source.url,
      snippet: snippetFor(source, answer),
      content: { kind: "none" },
      ...(answer.text.trim() ? { answer: answer.text } : {}),
      native
    }
  }));
}

export function createGoogleSource(transports: readonly GroundingTransport[] = defaultGroundingTransports): Source<GoogleSourceRequest, GoogleEvidencePayload> {
  return defineSource({
    name: "google",
    domain: "web",
    capabilities: ["search", "grounded-answer", "url-context"],
    traits: ["multi-transport", "generated-answer"],
    transports: ["antigravity", "gemini-api"],
    async run(req, ctx) {
      assertWebOptions(req.transport === "gemini-api" ? "gemini-api" : "antigravity", req);
      ctx.trace.step("source.google", req.query, { transport: req.transport ?? "auto", urls: req.urls?.length ?? 0 });
      const answer = await runGrounding(
        { query: req.query, instruction: req.instruction, urls: req.urls, thinking: req.thinking, signal: req.signal },
        ctx,
        { transports, transport: req.transport, requireAnswer: req.requireAnswer ?? true }
      );
      return groundingEvidence(req.query, answer, req.numResults);
    }
  });
}

export const googleSource = createGoogleSource();
