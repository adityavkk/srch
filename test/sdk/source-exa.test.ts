import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { createExaSource, type ExaSourceDeps } from "../../src/sdk/sources/exa.js";

const deps: ExaSourceDeps = {
  async searchMcp(query, options) {
    return {
      answer: "",
      results: [{ title: "Example", url: "https://example.com", snippet: "Example snippet" }],
      inlineContent: options.includeContent
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
