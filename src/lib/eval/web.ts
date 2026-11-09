export type WebEvalCase = {
  id: string;
  query: string;
  expectedUrls?: string[];
  expectedDomains?: string[];
  domainFilter?: string[];
};

export type WebEvalRun = {
  caseId: string;
  status: "success" | "empty" | "error";
  results: Array<{ url: string; snippet?: string }>;
  durationMs: number;
  attempts?: Array<{ provider: string; transport?: string; status: "success" | "failed" | "skipped" }>;
  errorCode?: string;
  costUsd?: number | null;
};

const TOP_K = 5;
const MIN_EXCERPT_CHARACTERS = 40;

function webUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function normalizedUrl(value: string): string | null {
  const url = webUrl(value);
  return url ? `${url.host.toLowerCase().replace(/\.$/, "")}${url.pathname.replace(/\/$/, "")}${url.search}` : null;
}

function validDomain(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(value);
}

export function matchesDomain(url: string, domain: string): boolean {
  const host = webUrl(url)?.hostname.toLowerCase().replace(/\.$/, "");
  const expected = domain.toLowerCase();
  return !!host && validDomain(expected) && (host === expected || host.endsWith(`.${expected}`));
}

function followsDomainFilter(url: string, filters: string[]): boolean {
  if (!webUrl(url)) return false;
  const included = filters.filter((domain) => !domain.startsWith("-"));
  const excluded = filters.filter((domain) => domain.startsWith("-")).map((domain) => domain.slice(1));
  return (included.length === 0 || included.some((domain) => matchesDomain(url, domain)))
    && !excluded.some((domain) => matchesDomain(url, domain));
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

/** Source matching and excerpt length are observable proxies, not human relevance judgments. */
export function scoreWebEvaluation(cases: WebEvalCase[], runs: WebEvalRun[]) {
  if (!Array.isArray(cases) || !Array.isArray(runs) || !cases.length || cases.length !== runs.length) {
    throw new Error("Provide one run for every case in a nonempty dataset");
  }
  const runById = new Map(runs.map((run) => [run.caseId, run]));
  if (runById.size !== runs.length || new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Case IDs and run IDs must be unique");
  }
  const perQuery = cases.map((item) => {
    if (typeof item.id !== "string" || !item.id || typeof item.query !== "string" || !item.query.trim()) {
      throw new Error("Every case needs an ID and a query");
    }
    const expectedUrls = item.expectedUrls ?? [];
    const expectedDomains = item.expectedDomains ?? [];
    const filters = item.domainFilter ?? [];
    if (!Array.isArray(expectedUrls) || !Array.isArray(expectedDomains) || !Array.isArray(filters)
      || expectedUrls.length + expectedDomains.length === 0
      || expectedUrls.some((url) => typeof url !== "string" || !webUrl(url))
      || expectedDomains.some((domain) => typeof domain !== "string" || !validDomain(domain))
      || filters.some((domain) => typeof domain !== "string" || !validDomain(domain.replace(/^-/, "")))) {
      throw new Error(`Invalid expected sources or domain filters for ${item.id}`);
    }
    const run = runById.get(item.id);
    if (!run || !["success", "empty", "error"].includes(run.status) || !Array.isArray(run.results)
      || !Number.isFinite(run.durationMs) || run.durationMs < 0
      || (run.costUsd != null && (!Number.isFinite(run.costUsd) || run.costUsd < 0))
      || (run.status !== "success" && run.results.length > 0)
      || (run.status === "success" && run.results.length === 0)) {
      throw new Error(`Invalid or missing run for ${item.id}`);
    }
    const seen = new Set<string>();
    const results = run.results.slice(0, TOP_K).map((result) => {
      const url = normalizedUrl(result.url);
      const duplicate = url !== null && seen.has(url);
      if (url) seen.add(url);
      return {
        url: result.url,
        snippet: result.snippet?.trim().slice(0, 1000) ?? "",
        sourceMatch: !!url && !duplicate && (expectedUrls.some((expected) => normalizedUrl(expected) === url)
          || expectedDomains.some((domain) => matchesDomain(result.url, domain))),
        excerptPresent: !!url && !duplicate && (result.snippet?.trim().length ?? 0) >= MIN_EXCERPT_CHARACTERS,
        domainCompliant: filters.length ? followsDomainFilter(result.url, filters) : null,
        duplicate
      };
    });
    const matched = results.filter((result) => result.sourceMatch).length;
    const attempted = (run.attempts ?? []).filter((attempt) => attempt.status !== "skipped");
    return {
      id: item.id, query: item.query, expectedUrls, expectedDomains, domainFilter: filters,
      status: run.status, durationMs: run.durationMs,
      errorCode: run.errorCode ?? null, costUsd: run.costUsd ?? null,
      sourceMatchAt5: matched / TOP_K,
      expectedSourceFound: matched > 0,
      excerptCoverageAt5: results.filter((result) => result.excerptPresent).length / TOP_K,
      usedFallback: new Set(attempted.map((attempt) => `${attempt.provider}:${attempt.transport ?? ""}`)).size > 1,
      attempts: run.attempts ?? [],
      domainFiltered: filters.length > 0,
      results
    };
  });
  const count = perQuery.length;
  const successful = perQuery.filter((run) => run.status === "success").length;
  const filteredResults = perQuery.flatMap((run) => run.results.filter((result) => result.domainCompliant !== null));
  const knownCosts = perQuery.filter((run) => run.costUsd !== null);
  const knownCostUsd = knownCosts.reduce((total, run) => total + run.costUsd!, 0);
  const allCostsKnown = knownCosts.length === count;
  return {
    definitions: {
      sourceMatchAt5: "Unique expected-source matches divided by five, averaged over all queries including empty and failed runs. This is not a human relevance score.",
      expectedSourceHitRate: "Queries with an expected source in the first five results divided by all queries.",
      excerptCoverageAt5: `Unique HTTP(S) results with at least ${MIN_EXCERPT_CHARACTERS} snippet characters divided by five, averaged over all queries. This checks excerpt presence, not answer quality.`,
      domainCompliance: "Compliant results divided by returned results among the first five of domain-filtered queries. Null when no such results exist; never treat null as passing.",
      fallbackRate: "Queries that attempted more than one provider or transport divided by all queries. Skipped providers and retries of the same transport do not count.",
      latencyMs: "Nearest-rank p50 and p95 of all runs, including empty and failed runs.",
      cost: "Only supplied costs are counted. Total and cost per success remain null if any run has unknown cost; failed requests are included in total cost."
    },
    summary: {
      queries: count, success: successful,
      empty: perQuery.filter((run) => run.status === "empty").length,
      error: perQuery.filter((run) => run.status === "error").length,
      successRate: successful / count,
      sourceMatchAt5: perQuery.reduce((total, run) => total + run.sourceMatchAt5, 0) / count,
      expectedSourceHitRate: perQuery.filter((run) => run.expectedSourceFound).length / count,
      excerptCoverageAt5: perQuery.reduce((total, run) => total + run.excerptCoverageAt5, 0) / count,
      fallbackRate: perQuery.filter((run) => run.usedFallback).length / count,
      domainCompliance: filteredResults.length ? filteredResults.filter((result) => result.domainCompliant).length / filteredResults.length : null,
      domainFilteredQueries: perQuery.filter((run) => run.domainFiltered).length,
      domainFilteredQueriesWithResults: perQuery.filter((run) => run.domainFiltered && run.results.length > 0).length,
      latencyMs: { p50: percentile(perQuery.map((run) => run.durationMs), 0.5), p95: percentile(perQuery.map((run) => run.durationMs), 0.95) },
      cost: { knownUsd: knownCostUsd, unknownRuns: count - knownCosts.length, totalUsd: allCostsKnown ? knownCostUsd : null, usdPerSuccess: allCostsKnown && successful ? knownCostUsd / successful : null }
    },
    perQuery
  };
}
