import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { createExaSource, type ExaSourceDeps } from "../../src/sdk/sources/exa.js";

const deps: ExaSourceDeps = {
  async searchMcp(query, options) {
    return {
      answer: "",
      results: [{ title: "Example", url: "https://example.com", snippet: "Example snippet" }],
      inlineContent: options?.includeContent
        ? [{ url: "https://example.com", title: "Example", content: "Full content", error: null }]
        : undefined,
      native: {
        provider: "exa-mcp",
        mode: "mcp",
        request: { query },
        response: { ok: true }
      }
    };
  },
  async searchApi(query) {
    return {
      answer: "",
      results: [{ title: `API ${query}`, url: "https://api.example.com", snippet: "API snippet" }],
      native: {
        provider: "exa-api",
        mode: "search",
        request: { query },
        response: { ok: true }
      }
    };
  }
};

test("createClient search() maps exa results into typed evidence", async () => {
  const source = createExaSource(deps);
  const client = createClient({ sources: [source] });

  const evidence = await client.search(source, {
    query: "bun sqlite",
    includeContent: true
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.source, "exa");
  assert.equal(evidence[0]?.domain, "web");
  assert.equal(evidence[0]?.provenance.kind, "web");
  assert.equal(evidence[0]?.provenance.transport, "exa-mcp");
  assert.equal(evidence[0]?.payload.kind, "search-result");
  assert.equal(evidence[0]?.payload.content.kind, "inline");

  if (evidence[0]?.payload.content.kind !== "inline") {
    throw new Error("expected inline content");
  }

  assert.equal(evidence[0].payload.content.text, "Full content");
});

test("createClient status() reports registered sources and domains", async () => {
  const source = createExaSource(deps);
  const client = createClient({ sources: [source] });

  const status = await client.status();

  assert.deepEqual(status.domains, ["web"]);
  assert.equal(status.summary.healthy, 1);
  assert.equal(status.summary.total, 1);
  assert.deepEqual(status.sources, [{ name: "exa", status: "healthy" }]);
  assert.deepEqual(status.recentRuns, []);
});

test("exa source forwards objective and keeps published date, author and inline text", async () => {
  const objectives: Array<string | undefined> = [];
  const source = createExaSource({
    async searchMcp(query, options) {
      objectives.push(options?.objective);
      return {
        answer: "",
        results: [{ title: "Widgetry guide", url: "https://docs.example.com/widgetry/cache", snippet: "Widgetry keeps rendered widgets in memory.", publishedDate: "2025-01-20", author: "Ada Example" }],
        inlineContent: [{ url: "https://docs.example.com/widgetry/cache", title: "Widgetry guide", content: "Widgetry keeps rendered widgets in memory for five minutes.", error: null }],
        native: { provider: "exa-mcp", mode: "mcp", request: { query }, response: { ok: true } }
      };
    },
    searchApi: deps.searchApi
  });
  const client = createClient({ sources: [source] });

  const evidence = await client.search(source, { query: "widgetry cache", objective: "the cache TTL default" });

  assert.deepEqual(objectives, ["the cache TTL default"]);
  assert.equal(evidence[0]?.payload.snippet, "Widgetry keeps rendered widgets in memory.");
  assert.equal(evidence[0]?.payload.publishedDate, "2025-01-20");
  assert.equal(evidence[0]?.payload.author, "Ada Example");
  assert.deepEqual(evidence[0]?.payload.content, { kind: "inline", text: "Widgetry keeps rendered widgets in memory for five minutes." });
});
