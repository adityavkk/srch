import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { matchesDomainFilter, publishedAfter, validateWebOptions, WebOptionsError } from "../../src/lib/search/web-options.js";
import type { WebStrategyRequest } from "../../src/sdk/strategies/web-default.js";
import { searchWithExaPaid } from "../../src/lib/upstream/exa.js";

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(typeof input === "string" || input instanceof URL ? input : input.url);
}

test("domain restrictions match hostnames and subdomains without accepting lookalikes", () => {
  const domains = ["example.com", "-private.example.com"];
  assert.equal(matchesDomainFilter("https://example.com/docs", domains), true);
  assert.equal(matchesDomainFilter("https://docs.example.com/", domains), true);
  assert.equal(matchesDomainFilter("https://EXAMPLE.COM./docs", domains), true);
  for (const url of ["https://private.example.com/", "https://sub.private.example.com/", "https://example.com.evil.org/", "https://evil.org/example.com", "https://example.com@evil.org/", "not a url", "javascript:example.com"]) {
    assert.equal(matchesDomainFilter(url, domains), false, url);
  }
});

test("invalid provider and search options fail before providers or secrets are consulted", async () => {
  const client = createClient({
    http: { fetch: async () => { assert.fail("HTTP must not be called"); } },
    secrets: { resolve: async () => { assert.fail("Secrets must not be consulted"); } }
  });
  const invalid = [
    { provider: "exaa" }, { numResults: 0 }, { numResults: 1.5 }, { numResults: 101 },
    { timeoutMs: 0 }, { timeoutMs: Infinity }, { recencyFilter: "yesterday" },
    { domainFilter: ["https://example.com"] }, { domainFilter: ["example.com/docs"] },
    { domainFilter: ["example.com OR evil.org"] }, { domainFilter: "example.com" }
  ];
  for (const options of invalid) {
    const result = await client.run({ domain: "web", query: "test", ...options } as { domain: "web" } & WebStrategyRequest);
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.error.code, "invalid_request");
  }
});

test("unsupported restrictions fail explicitly through both run and direct source search", async () => {
  const client = createClient({
    http: { fetch: async () => { assert.fail("HTTP must not be called"); } },
    secrets: { resolve: async () => { assert.fail("Secrets must not be consulted"); } }
  });
  const options = { query: "test", recencyFilter: "week" as const, domainFilter: ["example.com"] };
  for (const provider of ["exa", "gemini"] as const) {
    const result = await client.run({ domain: "web", provider, ...options });
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.error.code, "unsupported_option");
    await assert.rejects(client.search(provider, options), (error) => error instanceof WebOptionsError && error.code === "unsupported_option");
  }
  await assert.rejects(client.search("brave", { query: "test", numResults: 21 }), (error) => error instanceof WebOptionsError && error.code === "unsupported_option");
  await assert.rejects(client.search("brave", { query: "test", includeContent: true }), (error) => error instanceof WebOptionsError && error.code === "unsupported_option");
  const combined = await client.run({ domain: "web", ...options, includeContent: true });
  assert.equal(combined.kind, "error");
  if (combined.kind === "error") assert.equal(combined.error.code, "unsupported_option");
});

test("Exa API sends publication and domain constraints and removes out-of-scope URLs", async () => {
  const before = Date.now();
  let sent: { startPublishedDate: string; includeDomains: string[]; excludeDomains: string[] } | undefined;
  const client = createClient({
    secrets: { resolve: async () => "test-key" },
    http: { fetch: async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return Response.json({ results: [
        { title: "Lookalike", url: "https://example.com.evil.org/", text: "wrong" },
        { title: "Excluded", url: "https://private.example.com/", text: "wrong" },
        { title: "Included", url: "https://docs.example.com/", text: "right" }
      ] });
    } }
  });
  const result = await client.search("exa", { query: "test", mode: "api", recencyFilter: "week", domainFilter: ["example.com", "-private.example.com"] });
  assert.ok(sent);
  assert.deepEqual(sent.includeDomains, ["example.com"]);
  assert.deepEqual(sent.excludeDomains, ["private.example.com"]);
  const cutoff = Date.parse(sent.startPublishedDate);
  assert.ok(cutoff >= before - 7 * 86_400_000 && cutoff <= Date.now() - 7 * 86_400_000);
  assert.deepEqual(result.map((item) => item.payload.url), ["https://docs.example.com/"]);
  assert.equal(publishedAfter("day", Date.UTC(2026, 0, 8)), "2026-01-07T00:00:00.000Z");
});

test("Brave maps recency values and domain operators without relaxing the restriction", async () => {
  const expected = { day: "pd", week: "pw", month: "pm", year: "py" } as const;
  const queries: URL[] = [];
  const client = createClient({
    secrets: { resolve: async () => "test-key" },
    http: { fetch: async (input) => {
      queries.push(requestUrl(input));
      return Response.json({ web: { results: [
        { title: "Wrong", url: "https://evil.org/", description: "wrong" },
        { title: "Right", url: "https://docs.example.com/", description: "right" }
      ] } });
    } }
  });
  for (const recencyFilter of Object.keys(expected) as Array<keyof typeof expected>) {
    const result = await client.search("brave", { query: "test", recencyFilter, domainFilter: ["example.com", "-private.example.com"], numResults: 1 });
    const url = queries.at(-1)!;
    assert.equal(url.searchParams.get("freshness"), expected[recencyFilter]);
    assert.equal(url.searchParams.get("q"), "test (site:example.com) -site:private.example.com");
    assert.equal(url.searchParams.get("operators_fallback"), "false");
    assert.equal(url.searchParams.has("site"), false);
    assert.deepEqual(result.map((item) => item.payload.url), ["https://docs.example.com/"]);
  }
});

test("filtered Exa results also constrain the normalized answer and inline content", async () => {
  const response = await searchWithExaPaid("test", { domainFilter: ["example.com"], includeContent: true }, {
    secrets: { resolve: async () => "test-key" },
    http: { fetch: async () => Response.json({ results: [
      { title: "Wrong", url: "https://evil.org/", text: "out of scope text" },
      { title: "Right", url: "https://example.com/", text: "in scope text" }
    ] }) }
  });
  assert.doesNotMatch(response.answer, /evil\.org|out of scope/);
  assert.match(response.answer, /in scope text/);
  assert.deepEqual(response.inlineContent?.map((item) => item.url), ["https://example.com/"]);
});

test("automatic fallback preserves constraints and skips incompatible providers", async () => {
  const hosts: string[] = [];
  const client = createClient({
    secrets: { resolve: async (name) => name === "braveApiKey" || name === "perplexityApiKey" ? "test-key" : null },
    http: { fetch: async (input, init) => {
      const url = requestUrl(input);
      hosts.push(url.hostname);
      if (url.hostname === "api.search.brave.com") throw new Error("Brave unavailable");
      assert.equal(url.hostname, "api.perplexity.ai");
      const request = JSON.parse(String(init?.body)) as { search_domain_filter: string[]; search_recency_filter: string };
      assert.deepEqual(request.search_domain_filter, ["example.com"]);
      assert.equal(request.search_recency_filter, "week");
      return Response.json({ citations: ["https://evil.org/", "https://example.com/result"] });
    } }
  });
  const result = await client.run({ domain: "web", query: "test", domainFilter: ["example.com"], recencyFilter: "week", providers: ["exa", "brave", "gemini", "perplexity"] });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(hosts, ["api.search.brave.com", "api.perplexity.ai"]);
  assert.deepEqual(result.evidence.map((item) => item.payload.url), ["https://example.com/result"]);
  assert.deepEqual(result.summary.attempts.filter((attempt) => attempt.status === "skipped").map((attempt) => attempt.transport), ["exa-mcp", "gemini-web", "gemini-api"]);
});

test("web deadline bounds a stalled transport and forwards cancellation", async () => {
  let requestSignal: AbortSignal | null | undefined;
  const client = createClient({ http: { fetch: async (_input, init) => {
    requestSignal = init?.signal;
    return new Promise<Response>(() => {});
  } } });
  const result = await client.run({ domain: "web", query: "test", provider: "exa", timeoutMs: 20 });
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.error.code, "timeout");
  assert.equal(requestSignal?.aborted, true);
});

test("web deadline bounds a stalled secret resolver and forwards cancellation", async () => {
  let secretSignal: AbortSignal | undefined;
  const client = createClient({
    secrets: { resolve: async (_name, signal) => { secretSignal = signal; return new Promise<string | null>(() => {}); } },
    http: { fetch: async () => { assert.fail("HTTP must not be called"); } }
  });
  const result = await client.run({ domain: "web", query: "test", provider: "brave", timeoutMs: 20 });
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.error.code, "timeout");
  assert.equal(secretSignal?.aborted, true);
});

test("hq cannot be silently ignored by a selected provider", () => {
  for (const provider of ["brave", "perplexity"]) {
    assert.throws(() => validateWebOptions({ provider, hq: true }), (error) => error instanceof WebOptionsError && error.code === "unsupported_option");
  }
});
