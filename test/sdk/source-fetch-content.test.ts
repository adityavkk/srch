import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { fetchContentSource } from "../../src/sdk/sources/fetch-content.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure
} from "./source-contract.js";

const realFetch = globalThis.fetch;

const ARTICLE_URL = "https://contract.local/article";
const ARTICLE_HTML =
  "<!doctype html><html><head><title>Contract Article</title></head><body><main><article>" +
  "<h1>Contract Article</h1><p>First paragraph with enough prose for Readability to keep the " +
  "article body and exercise the markdown conversion path used by the fetch-content source in " +
  "these contract tests without relying on any live website.</p><p>Second paragraph that adds " +
  "more than two hundred characters of readable text so the extractor treats the document as a " +
  "complete article rather than an incomplete fragment.</p></article></main></body></html>";

// Route every fetch through canned responses so the source (and its jina/gemini
// fallbacks) never touch the network. The article URL succeeds; everything else
// fails, modelling a dead host across all transports.
before(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === ARTICLE_URL) {
      return new Response(ARTICLE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    return new Response("unavailable", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "content-type": "text/html" }
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

test("fetch-content declares the capabilities and transport it uses", () => {
  assertCapabilities(fetchContentSource, {
    name: "fetch-content",
    domain: "fetch",
    capabilities: ["fetch", "extract"],
    transports: ["http|jina|gemini|github"]
  });
});

test("fetch-content extracts a document into contract-conforming evidence", async () => {
  const evidence = await assertSuccessContract(fetchContentSource, { query: ARTICLE_URL });

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "web");
  if (item?.provenance.kind !== "web") throw new Error("expected web provenance");
  assert.equal(item.provenance.transport, "http|jina|gemini|github");
  assert.equal(item.provenance.url, ARTICLE_URL);
  assert.equal(item.payload.kind, "document");
  assert.equal(item.payload.url, ARTICLE_URL);
  assert.match(item.payload.title, /Contract Article/);
  assert.match(item.payload.content, /First paragraph/);
});

test("fetch-content failure surfaces a typed RunError without throwing out of the source", async () => {
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "fetch", query: "https://contract.local/missing" }),
    { kind: "error", domain: "fetch" }
  );

  if (result.kind !== "error") throw new Error("expected RunError");
  assert.match(result.error.message, /HTTP 503/);
});
