import assert from "node:assert/strict";
import test from "node:test";
import { createClient, createExaFetchSource, type ExaFetchSourceDeps } from "../../src/sdk.js";

test("exa-fetch maps an Exa page into fetch evidence", async () => {
  const seen: Array<{ url: string; describeImages?: boolean }> = [];
  const deps: ExaFetchSourceDeps = {
    async extract(url, _signal, options) {
      seen.push({ url, describeImages: options?.describeImages });
      return {
        url,
        title: "Widgetry guide",
        content: "Widgetry keeps rendered widgets in memory.",
        error: null,
        images: [{ src: "https://docs.example.com/img/cache-flow.png", alt: "Cache flow diagram" }]
      };
    }
  };
  const source = createExaFetchSource(deps);
  const client = createClient({ sources: [source] });

  const evidence = await client.search(source, { query: "https://docs.example.com/widgetry/cache", describeImages: true });

  assert.deepEqual(seen, [{ url: "https://docs.example.com/widgetry/cache", describeImages: true }]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.source, "exa-fetch");
  assert.equal(evidence[0]?.provenance.kind, "web");
  assert.equal(evidence[0]?.provenance.kind === "web" ? evidence[0].provenance.transport : "", "exa-mcp");
  assert.deepEqual(evidence[0]?.payload, {
    kind: "document",
    url: "https://docs.example.com/widgetry/cache",
    title: "Widgetry guide",
    content: "Widgetry keeps rendered widgets in memory.",
    images: [{ src: "https://docs.example.com/img/cache-flow.png", alt: "Cache flow diagram" }]
  });
});

test("exa-fetch throws the Exa error when no text came back", async () => {
  const source = createExaFetchSource({
    async extract(url) {
      return { url, title: "", content: "", error: "Exa could not read the page: CRAWL_UNKNOWN_ERROR" };
    }
  });
  const client = createClient({ sources: [source] });

  await assert.rejects(client.search(source, { query: "https://broken.example.invalid/page" }), /CRAWL_UNKNOWN_ERROR/);
});
