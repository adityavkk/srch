import assert from "node:assert/strict";
import test from "node:test";
import { createClient, createWebDefaultStrategy, defineSource } from "../../src/sdk.js";
import type { Evidence, Source, SourceRequest } from "../../src/sdk.js";
import type { WebSourceRequest } from "../../src/sdk/sources/web-shared.js";

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

test("web/default forwards objective to the exa source", async () => {
  const objectives: Array<string | undefined> = [];
  const exa = defineSource<WebSourceRequest, { title: string }>({
    name: "exa",
    domain: "web",
    capabilities: ["search"],
    traits: [],
    transports: ["exa-mcp"],
    async run(req) {
      objectives.push(req.objective);
      return [makeEvidence("exa", req.query, "exa-mcp")];
    }
  });
  const client = createClient({
    sources: [exa],
    strategies: [createWebDefaultStrategy({
      isBraveAvailable: async () => false,
      isGeminiApiAvailable: async () => false,
      isPerplexityAvailable: async () => false
    })]
  });

  const result = await client.run({ domain: "web", query: "widgetry cache", objective: "the cache TTL default" });

  assert.equal(result.kind, "success");
  assert.deepEqual(objectives, ["the cache TTL default"]);
});
