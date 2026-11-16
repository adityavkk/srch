import { hasAntigravityCredential } from "../../lib/grounding/antigravity-auth.js";
import { loadConfig } from "../../lib/core/config.js";
import type { WebProvider } from "../../lib/core/types.js";
import { isWebProvider, WebOptionsError, WEB_PROVIDERS, type WebTransport } from "../../lib/search/web-options.js";
import { isBraveAvailable } from "../../lib/upstream/brave.js";
import { isGeminiApiAvailable } from "../../lib/upstream/gemini-api.js";
import { isPerplexityAvailable } from "../../lib/upstream/perplexity.js";
import type { StrategyContext } from "../types.js";

/** Automatic order when neither the request nor config chooses one. */
export const DEFAULT_WEB_PROVIDERS: readonly WebProvider[] = ["exa", "google", "brave", "gemini", "perplexity"];

type Availability = (ctx: StrategyContext, signal?: AbortSignal) => Promise<boolean>;

export type WebProviderDeps = {
  isBraveAvailable: Availability;
  isGeminiApiAvailable: Availability;
  isPerplexityAvailable: Availability;
  isAntigravityAvailable: Availability;
  /** Automatic provider order; reads `webProviders` from config by default. */
  defaultProviders: () => readonly WebProvider[];
};

export function configuredWebProviders(): readonly WebProvider[] {
  try {
    const configured = loadConfig().webProviders;
    return Array.isArray(configured) && configured.length > 0 && configured.every(isWebProvider) ? configured : DEFAULT_WEB_PROVIDERS;
  } catch {
    return DEFAULT_WEB_PROVIDERS;
  }
}

export const defaultWebProviderDeps: WebProviderDeps = {
  isBraveAvailable,
  isGeminiApiAvailable,
  isPerplexityAvailable,
  isAntigravityAvailable: (ctx, signal) => hasAntigravityCredential(ctx, undefined, signal),
  defaultProviders: configuredWebProviders
};

export type WebCandidate = {
  provider: WebProvider;
  transport: WebTransport;
  options?: Record<string, unknown>;
  /** Skip without a request when this reports false; absent means always try. */
  available?: Availability;
};

export type WebPlanRequest = {
  provider?: "auto" | WebProvider;
  providers?: WebProvider[];
  hq?: boolean;
};

export function validateProviderOrder(req: WebPlanRequest): void {
  if (req.providers === undefined) return;
  if (!Array.isArray(req.providers) || req.providers.length === 0 || !req.providers.every(isWebProvider)
    || new Set(req.providers).size !== req.providers.length) {
    throw new WebOptionsError("invalid_request", `providers must be a nonempty list of distinct providers: ${WEB_PROVIDERS.join("|")}`);
  }
  if (req.provider !== undefined && req.provider !== "auto") {
    throw new WebOptionsError("invalid_request", "Use provider for one provider or providers for an order, not both");
  }
  if (req.hq) throw new WebOptionsError("unsupported_option", "hq selects Exa's paid API and cannot be combined with providers");
}

/** Transports for one provider, in the order they are tried. */
function transportsFor(provider: WebProvider, hq: boolean, deps: WebProviderDeps): WebCandidate[] {
  switch (provider) {
    case "exa":
      return [{ provider, transport: hq ? "exa-api" : "exa-mcp", options: { mode: hq ? "api" : "mcp" } }];
    case "brave":
      return [{ provider, transport: "brave-search-api", available: deps.isBraveAvailable }];
    case "google":
      return [
        { provider, transport: "antigravity", options: { transport: "antigravity" }, available: deps.isAntigravityAvailable },
        { provider, transport: "gemini-api", options: { transport: "gemini-api" }, available: deps.isGeminiApiAvailable }
      ];
    case "gemini":
      return hq
        ? [{ provider, transport: "gemini-api", options: { transport: "api" }, available: deps.isGeminiApiAvailable }]
        : [
            { provider, transport: "gemini-web", options: { transport: "web" } },
            { provider, transport: "gemini-api", options: { transport: "api" }, available: deps.isGeminiApiAvailable }
          ];
    case "perplexity":
      return [{ provider, transport: "perplexity-api", available: deps.isPerplexityAvailable }];
  }
}

/**
 * Build the ordered attempt list.
 * - An explicit provider is tried even without a detected credential, so its own error surfaces.
 * - Automatic order skips providers whose source is not registered and tries each wire once,
 *   so Google's and Gemini's shared API transport is never called twice.
 */
export function planWebCandidates(req: WebPlanRequest, deps: WebProviderDeps, ctx: StrategyContext): WebCandidate[] {
  const hq = req.hq === true;
  if (req.provider !== undefined && req.provider !== "auto") {
    const [first, ...rest] = transportsFor(req.provider, hq, deps);
    return [{ ...first!, available: undefined }, ...rest];
  }
  if (hq) return transportsFor("exa", true, deps);
  const registered = new Set(ctx.sources.list().map((source) => source.name));
  const seen = new Set<WebTransport>();
  return (req.providers ?? deps.defaultProviders())
    .filter((provider) => registered.has(provider))
    .flatMap((provider) => transportsFor(provider, false, deps))
    .filter((candidate) => {
      if (seen.has(candidate.transport)) return false;
      seen.add(candidate.transport);
      return true;
    });
}
