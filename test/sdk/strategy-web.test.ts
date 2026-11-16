import assert from "node:assert/strict";
import test from "node:test";
import { createClient, createWebDefaultStrategy, defineSource } from "../../src/sdk.js";
import type { Evidence, Source, SourceRequest, WebStrategyRequest } from "../../src/sdk.js";

function makeEvidence(source: string, query: string, transport: string): Evidence<{ title: string }> {
  return {
    source,
    domain: "web",
    query,
    provenance: {
      kind: "web",
      url: `https://${source}.example.com`,
      transport,
      timestamp: Date.now(),
      cached: false
    },
    payload: { title: `${source} result` }
  };
}

function createSource(
  name: string,
  transport: string,
  run: Source<SourceRequest, { title: string }>["run"]
): Source<SourceRequest, { title: string }> {
  return defineSource({
    name,
    domain: "web",
    capabilities: ["search"],
    traits: [],
    transports: [transport],
    run
  });
}

test("web/default falls back from exa failure to brave success", async () => {
  const exa = createSource("exa", "exa-mcp", async () => {
    throw new Error("exa unavailable");
  });
  const brave = createSource("brave", "brave-search-api", async (req) => [makeEvidence("brave", req.query, "brave-search-api")]);
  const gemini = createSource("gemini", "gemini-web", async () => []);
  const perplexity = createSource("perplexity", "perplexity-api", async () => []);

  const client = createClient({
    sources: [exa, brave, gemini, perplexity],
    strategies: [createWebDefaultStrategy({
      isBraveAvailable: async () => true,
      isGeminiApiAvailable: async () => false,
      isPerplexityAvailable: async () => false
    })]
  });

  const result = await client.run({ domain: "web", query: "bun sqlite" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;

  assert.equal(result.evidence[0].source, "brave");
  assert.equal(result.summary.totalEvidence, 1);
  assert.deepEqual(result.summary.sourceBreakdown, { brave: 1 });
  assert.equal(result.summary.attempts[0]?.provider, "exa");
  assert.equal(result.summary.attempts[0]?.status, "failed");
  assert.equal(result.summary.attempts[1]?.provider, "brave");
  assert.equal(result.summary.attempts[1]?.status, "success");
});

test("web/default returns definitive empty state when all providers yield no evidence", async () => {
  const empty = async () => [];
  const exa = createSource("exa", "exa-mcp", empty);
  const brave = createSource("brave", "brave-search-api", empty);
  const gemini = createSource("gemini", "gemini-web", empty);
  const perplexity = createSource("perplexity", "perplexity-api", empty);

  const client = createClient({
    sources: [exa, brave, gemini, perplexity],
    strategies: [createWebDefaultStrategy({
      isBraveAvailable: async () => true,
      isGeminiApiAvailable: async () => true,
      isPerplexityAvailable: async () => true
    })]
  });

  const result = await client.run({ domain: "web", query: "obscure query" });

  assert.equal(result.kind, "empty");
  if (result.kind !== "empty") return;

  assert.equal(result.summary.totalEvidence, 0);
  assert.equal(result.summary.attempts.length, 5);
  assert.ok(result.suggestions.length >= 1);
});

test("web/default reports an outage when providers fail and the remaining providers are unavailable", async () => {
  const fail = async () => { throw new Error("transport offline"); };
  const unreachable = async () => { throw new Error("unavailable providers must not be called"); };
  const client = createClient({
    sources: [
      createSource("exa", "exa-mcp", fail),
      createSource("brave", "brave-search-api", unreachable),
      createSource("gemini", "gemini-web", fail),
      createSource("perplexity", "perplexity-api", unreachable)
    ],
    strategies: [createWebDefaultStrategy({
      isBraveAvailable: async () => false,
      isGeminiApiAvailable: async () => false,
      isPerplexityAvailable: async () => false
    })]
  });

  const result = await client.run({ domain: "web", query: "OpenAI" });

  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "web_unavailable");
  assert.match(result.error.message, /exa \(exa-mcp\): transport offline/);
  assert.match(result.error.message, /gemini \(gemini-web\): transport offline/);
  assert.equal(result.summary?.totalEvidence, 0);
  assert.deepEqual(result.summary?.attempts.map(({ provider, status, transport }) => ({ provider, status, transport })), [
    { provider: "exa", status: "failed", transport: "exa-mcp" },
    { provider: "brave", status: "skipped", transport: "brave-search-api" },
    { provider: "gemini", status: "failed", transport: "gemini-web" },
    { provider: "gemini", status: "skipped", transport: "gemini-api" },
    { provider: "perplexity", status: "skipped", transport: "perplexity-api" }
  ]);
  assert.ok(result.suggestions.some((suggestion) => suggestion.includes("inspect tools")));
  assert.ok(result.suggestions.every((suggestion) => !suggestion.includes("broader terms") && !suggestion.includes("--hq")));
});

for (const options of [
  { provider: "exa" },
  { provider: "exa", hq: true },
  { provider: "brave" },
  { provider: "gemini" },
  { provider: "gemini", hq: true },
  { provider: "perplexity" },
  { hq: true }
] satisfies Array<Partial<WebStrategyRequest>>) {
  test(`web/default reports a provider failure for ${JSON.stringify(options)}`, async () => {
    const calls: string[] = [];
    const sources = ["exa", "brave", "gemini", "perplexity"].map((name) => createSource(name, "mock", async () => {
      calls.push(name);
      throw new Error("upstream HTTP 503");
    }));
    const client = createClient({
      sources,
      strategies: [createWebDefaultStrategy({
        isBraveAvailable: async () => true,
        isGeminiApiAvailable: async () => false,
        isPerplexityAvailable: async () => true
      })]
    });

    const result = await client.run({ domain: "web", query: "OpenAI", ...options });

    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.error.code, "web_unavailable");
    assert.deepEqual(calls, ["provider" in options ? options.provider : "exa"]);
    assert.equal(result.summary?.attempts[0].status, "failed");
    assert.match(result.error.message, /upstream HTTP 503/);
  });
}

test("web/default keeps a genuine zero-result response distinct from later provider failures", async () => {
  const client = createClient({
    sources: [
      createSource("exa", "exa-mcp", async () => []),
      createSource("gemini", "gemini-web", async () => { throw new Error("browser unavailable"); })
    ],
    strategies: [createWebDefaultStrategy({
      isBraveAvailable: async () => false,
      isGeminiApiAvailable: async () => false,
      isPerplexityAvailable: async () => false
    })]
  });

  const result = await client.run({ domain: "web", query: "obscure query" });

  assert.equal(result.kind, "empty");
  if (result.kind !== "empty") return;
  assert.equal(result.summary.attempts[0].status, "success");
  assert.ok(result.summary.attempts.some((attempt) => attempt.status === "failed"));
});

test("web/default preserves an explicit provider's genuine empty response", async () => {
  const client = createClient({ sources: [createSource("exa", "exa-mcp", async () => [])] });

  const result = await client.run({ domain: "web", query: "obscure query", provider: "exa" });

  assert.equal(result.kind, "empty");
  if (result.kind !== "empty") return;
  assert.equal(result.summary.attempts.length, 1);
  assert.equal(result.summary.attempts[0].status, "success");
});

test("web/default stops cancelled searches before contacting providers", async () => {
  let calls = 0;
  const client = createClient({ sources: [createSource("exa", "exa-mcp", async () => {
    calls += 1;
    return [];
  })] });

  const result = await client.run({ domain: "web", query: "OpenAI", signal: AbortSignal.abort() });

  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "aborted");
  assert.equal(calls, 0);
});

test("web/default stops fallback after cancellation during a provider request", async () => {
  const controller = new AbortController();
  let availabilityCalls = 0;
  const unavailable = async () => { availabilityCalls += 1; return false; };
  const client = createClient({
    sources: [createSource("exa", "exa-mcp", async () => {
      controller.abort();
      throw controller.signal.reason;
    })],
    strategies: [createWebDefaultStrategy({
      isBraveAvailable: unavailable,
      isGeminiApiAvailable: unavailable,
      isPerplexityAvailable: unavailable
    })]
  });

  const result = await client.run({ domain: "web", query: "OpenAI", signal: controller.signal });

  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "aborted");
  assert.equal(result.summary?.attempts.length, 1);
  assert.equal(availabilityCalls, 0);
});
