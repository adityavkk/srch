import { withTimeout } from "../core/http.js";
import type { GroundingSource } from "./types.js";

/** Google wraps grounding sources in opaque redirects on this host. */
export const GROUNDING_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const RESOLVE_TIMEOUT_MS = 5_000;
const CONCURRENCY = 6;
const CACHE_LIMIT = 500;
const cache = new Map<string, string>();

type Fetch = typeof fetch;

export function isGroundingRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === GROUNDING_REDIRECT_HOST || url.hostname.endsWith(`.${GROUNDING_REDIRECT_HOST}`));
  } catch {
    return false;
  }
}

function destination(location: string | null, base: string): string | undefined {
  if (!location) return undefined;
  try {
    const url = new URL(location, base);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * Read the destination of one grounding redirect without following it. Only the Google
 * redirect host is contacted, so search results cannot point this request elsewhere.
 */
async function resolveOne(url: string, fetcher: Fetch, signal?: AbortSignal): Promise<string | undefined> {
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const response = await fetcher(url, { method: "GET", redirect: "manual", signal: withTimeout(signal, RESOLVE_TIMEOUT_MS) });
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 300 || response.status >= 400) return undefined;
    const resolved = destination(response.headers.get("location"), url);
    if (resolved) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(url, resolved);
    }
    return resolved;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

/** Replace grounding redirects with their destinations where they resolve; keep the rest. */
export async function resolveGroundingSources(sources: GroundingSource[], fetcher: Fetch, signal?: AbortSignal): Promise<GroundingSource[]> {
  const resolved = [...sources];
  let next = 0;
  const worker = async () => {
    while (next < resolved.length) {
      const index = next++;
      const source = resolved[index]!;
      if (!isGroundingRedirect(source.groundingUrl)) {
        resolved[index] = { ...source, url: source.groundingUrl, resolved: true, domain: source.domain ?? hostname(source.groundingUrl) };
        continue;
      }
      const url = await resolveOne(source.groundingUrl, fetcher, signal);
      if (url) resolved[index] = { ...source, url, resolved: true, domain: source.domain ?? hostname(url) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, resolved.length) }, worker));
  return resolved;
}

/** Test hook: forget resolved redirects. */
export function clearRedirectCache(): void {
  cache.clear();
}
