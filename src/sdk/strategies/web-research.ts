import type { WebProvider } from "../../lib/core/types.js";
import { GroundingError, isGroundingError } from "../../lib/grounding/errors.js";
import { validateGroundingRequest } from "../../lib/grounding/request.js";
import type { GroundingTransportSelection } from "../../lib/grounding/run.js";
import type { GroundedAnswer, TransportAttempt, UrlRetrieval } from "../../lib/grounding/types.js";
import { validateWebOptions, WebOptionsError } from "../../lib/search/web-options.js";
import { defineStrategy } from "../define.js";
import type { FetchEvidencePayload } from "../sources/fetch-content.js";
import type { GoogleEvidencePayload } from "../sources/google.js";
import type { WebEvidencePayload } from "../sources/web-shared.js";
import type { Evidence, NonEmptyArray, ProviderAttempt, RunEmpty, RunError, RunSuccess, StaticStrategy, StrategyContext, StrategyRequest } from "../types.js";
import type { WebStrategyRequest } from "./web-default.js";
import { configuredWebProviders, validateProviderOrder } from "./web-providers.js";

export const DEFAULT_RESEARCH_TIMEOUT_MS = 60_000;
/** Time kept back from grounding so retrieval can still answer when grounding stalls. */
export const DEFAULT_FALLBACK_RESERVE_MS = 20_000;
const MAX_FETCHED_URLS = 5;

export type WebResearchRequest = StrategyRequest & {
  instruction?: string;
  urls?: string[];
  thinking?: boolean;
  transport?: GroundingTransportSelection;
  /** `retrieval` (default) degrades to web search and URL fetch; `none` reports the grounding failure. */
  fallback?: "retrieval" | "none";
  /** Retrieval order for the fallback. Google is always removed from it. */
  providers?: WebProvider[];
  numResults?: number;
  timeoutMs?: number;
};

export type ResearchFailure = { code: string; message: string; recovery: string };

export type ResearchOutcome =
  | { kind: "grounded"; answer: GroundedAnswer }
  | {
      kind: "retrieval-only";
      /** Why grounded research was not delivered. */
      reason: ResearchFailure;
      missing: NonEmptyArray<"grounded-answer" | "claim-citations">;
      urlRetrievals: UrlRetrieval[];
      groundingAttempts: TransportAttempt[];
    };

export type WebResearchPayload = GoogleEvidencePayload | WebEvidencePayload | FetchEvidencePayload;

export type WebResearchResult =
  | (RunSuccess<WebResearchPayload> & { research: ResearchOutcome })
  | (RunEmpty & { research: Extract<ResearchOutcome, { kind: "retrieval-only" }> })
  | (RunError & { research?: Extract<ResearchOutcome, { kind: "retrieval-only" }> });

const STRATEGY = "web/research";

function nonEmpty<T>(items: T[], fallback: T): NonEmptyArray<T> {
  return items.length > 0 ? [items[0]!, ...items.slice(1)] : [fallback];
}

function breakdown(evidence: Evidence[]): Record<string, number> {
  return evidence.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.source]: (acc[item.source] ?? 0) + 1 }), {});
}

function invalid(code: string, message: string): WebResearchResult {
  return { kind: "error", domain: "web", strategy: STRATEGY, error: { code, message }, trace: [], suggestions: ["Run `search web --help` for research options"] };
}

function failureOf(error: unknown, timedOut: boolean): ResearchFailure {
  if (isGroundingError(error)) return { code: error.code, message: error.message, recovery: error.recovery };
  if (timedOut) return { code: "timeout", message: "Grounded research exceeded its time budget", recovery: "Retry with a larger timeoutMs" };
  return { code: "grounding_failed", message: error instanceof Error ? error.message : String(error), recovery: "Retry, or report the failure if it persists" };
}

function groundedAttempt(answer: GroundedAnswer, durationMs: number, evidenceCount: number): ProviderAttempt {
  return { provider: "google", status: "success", transport: answer.transport, durationMs, evidenceCount };
}

function failedAttempt(failure: ResearchFailure, attempts: TransportAttempt[], durationMs: number): ProviderAttempt {
  const transport = attempts.at(-1)?.transport;
  return { provider: "google", status: "failed", ...(transport ? { transport } : {}), error: `${failure.code}: ${failure.message}`, durationMs };
}

type FetchedUrl = { url: string; evidence: Evidence<FetchEvidencePayload>[]; attempt: ProviderAttempt };

async function fetchOne(url: string, ctx: StrategyContext, signal: AbortSignal): Promise<FetchedUrl> {
  const startedAt = Date.now();
  try {
    const evidence = await ctx.search("fetch-content", { query: url, signal });
    const provenance = evidence[0]?.provenance;
    const transport = provenance?.kind === "web" ? provenance.transport : "http";
    return { url, evidence, attempt: { provider: "fetch-content", status: "success", transport, durationMs: Date.now() - startedAt, evidenceCount: evidence.length } };
  } catch (error) {
    signal.throwIfAborted();
    return { url, evidence: [], attempt: { provider: "fetch-content", status: "failed", error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt } };
  }
}

/** Fetch requested pages so a degraded result still reads the documents the caller named. */
async function fetchRequestedUrls(urls: string[], ctx: StrategyContext, signal: AbortSignal) {
  const registered = ctx.sources.list().some((source) => source.name === "fetch-content");
  const results = registered ? await Promise.all(urls.slice(0, MAX_FETCHED_URLS).map((url) => fetchOne(url, ctx, signal))) : [];
  const urlRetrievals: UrlRetrieval[] = urls.map((url) => {
    const fetched = results.find((item) => item.url === url);
    return { url, status: !fetched ? "unknown" : fetched.evidence.length > 0 ? "success" : "failed" };
  });
  return { evidence: results.flatMap((item) => item.evidence), attempts: results.map((item) => item.attempt), urlRetrievals };
}

/** Plain web retrieval through the registered web/default strategy, without Google. */
async function searchWithoutGoogle(req: WebResearchRequest, ctx: StrategyContext, signal: AbortSignal) {
  const strategy = ctx.strategies.get("web/default");
  if (strategy.kind !== "static") throw new Error("web/default must be a static strategy");
  const providers = (req.providers ?? configuredWebProviders()).filter((provider) => provider !== "google");
  const request: WebStrategyRequest = { query: req.query, signal, numResults: req.numResults, providers: providers.length > 0 ? providers : ["exa"] };
  return strategy.run(request, ctx);
}

async function degrade(req: WebResearchRequest, ctx: StrategyContext, signal: AbortSignal, failure: ResearchFailure, groundingAttempts: TransportAttempt[], google: ProviderAttempt, startedAt: number): Promise<WebResearchResult> {
  const [fetched, searched] = await Promise.all([fetchRequestedUrls(req.urls ?? [], ctx, signal), searchWithoutGoogle(req, ctx, signal)]);
  // web/default yields web search-result evidence; its RunResult is untyped at this boundary.
  const webEvidence = searched.kind === "success" ? searched.evidence as Evidence<WebEvidencePayload>[] : [];
  const evidence: Evidence<WebResearchPayload>[] = [...fetched.evidence, ...webEvidence];
  const attempts = nonEmpty<ProviderAttempt>([google, ...fetched.attempts, ...(searched.summary?.attempts ?? [])], google);
  const research = { kind: "retrieval-only" as const, reason: failure, missing: ["grounded-answer", "claim-citations"] as NonEmptyArray<"grounded-answer" | "claim-citations">, urlRetrievals: fetched.urlRetrievals, groundingAttempts };
  const summary = { totalEvidence: evidence.length, sourceBreakdown: breakdown(evidence), attempts, durationMs: Date.now() - startedAt };
  const recovery = `Grounded research unavailable (${failure.code}): ${failure.recovery}`;

  if (evidence.length > 0) {
    return { kind: "success", domain: "web", strategy: STRATEGY, evidence: nonEmpty(evidence, evidence[0]!), summary, trace: [], suggestions: [recovery, "Read the returned sources; no answer was generated"], research };
  }
  if (searched.kind === "empty") {
    return { kind: "empty", domain: "web", strategy: STRATEGY, summary, trace: [], suggestions: [recovery, ...searched.suggestions], research };
  }
  const retrievalError = searched.kind === "error" ? searched.error.message : "no evidence";
  return {
    kind: "error", domain: "web", strategy: STRATEGY,
    error: { code: "research_unavailable", message: `Grounded research failed (${failure.code}: ${failure.message}); retrieval fallback failed: ${retrievalError}` },
    summary, trace: [], suggestions: [recovery, "Run `search inspect tools --json` to check provider availability"], research
  };
}

export type WebResearchOptions = {
  /** Deadline share reserved for the retrieval fallback when grounding stalls. */
  fallbackReserveMs?: number;
};

/** Grounded web research with an explicit, typed retrieval-only degradation. */
export function createWebResearchStrategy(options: WebResearchOptions = {}): StaticStrategy<WebResearchRequest, WebResearchResult> {
  const reserve = options.fallbackReserveMs ?? DEFAULT_FALLBACK_RESERVE_MS;
  return defineStrategy<WebResearchRequest, WebResearchResult>({
    kind: "static",
    name: STRATEGY,
    domain: "web",
    async run(req, ctx) {
      try {
        validateGroundingRequest(req);
        validateWebOptions({ numResults: req.numResults, timeoutMs: req.timeoutMs });
        validateProviderOrder({ providers: req.providers });
        if (req.fallback !== undefined && req.fallback !== "retrieval" && req.fallback !== "none") {
          throw new WebOptionsError("invalid_request", "fallback must be retrieval or none");
        }
      } catch (error) {
        if (error instanceof GroundingError || error instanceof WebOptionsError) return invalid("invalid_request", error.message);
        throw error;
      }

      const timeoutMs = req.timeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;
      const fallback = req.fallback ?? "retrieval";
      const total = new AbortController();
      const timer = setTimeout(() => total.abort(new DOMException("Research exceeded its time limit", "TimeoutError")), timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, total.signal]) : total.signal;
      // Reserve time for retrieval only when grounding still keeps most of the deadline.
      const groundingBudget = fallback === "retrieval" && timeoutMs > reserve * 2 ? timeoutMs - reserve : timeoutMs;
      const groundingSignal = AbortSignal.any([signal, AbortSignal.timeout(groundingBudget)]);
      const startedAt = Date.now();

      try {
        try {
          const evidence = await ctx.search("google", {
            query: req.query, instruction: req.instruction, urls: req.urls, thinking: req.thinking,
            transport: req.transport, numResults: req.numResults, signal: groundingSignal
          });
          const answer = evidence[0]!.payload.native.grounding;
          const summary = { totalEvidence: evidence.length, sourceBreakdown: breakdown(evidence), attempts: [groundedAttempt(answer, Date.now() - startedAt, evidence.length)] as NonEmptyArray<ProviderAttempt>, durationMs: Date.now() - startedAt };
          return { kind: "success", domain: "web", strategy: STRATEGY, evidence: nonEmpty<Evidence<WebResearchPayload>>(evidence, evidence[0]!), summary, trace: [], research: { kind: "grounded", answer } };
        } catch (error) {
          if (req.signal?.aborted) throw error;
          const failure = failureOf(error, groundingSignal.aborted);
          const groundingAttempts = isGroundingError(error) ? error.details.attempts ?? [] : [];
          const google = failedAttempt(failure, groundingAttempts, Date.now() - startedAt);
          if (fallback === "none" || signal.aborted) {
            return {
              kind: "error", domain: "web", strategy: STRATEGY, error: { code: failure.code, message: failure.message },
              summary: { totalEvidence: 0, sourceBreakdown: {}, attempts: [google], durationMs: Date.now() - startedAt },
              trace: [], suggestions: [failure.recovery]
            };
          }
          return await degrade(req, ctx, signal, failure, groundingAttempts, google, startedAt);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export const webResearchStrategy = createWebResearchStrategy();
