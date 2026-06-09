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

// A realistic page wrapped in site chrome (nav/header/footer/aside) so the test
// pins Readability's job: keep the <article> prose, drop the boilerplate. This
// is the behaviour the @mozilla/readability 0.6 bump must preserve, so it acts
// as the guard for that breaking upgrade.
const CHROME_URL = "https://contract.local/chrome";
const BOILERPLATE_MARKER = "SUBSCRIBE-TO-OUR-NEWSLETTER";
const CHROME_HTML =
  "<!doctype html><html><head><title>Readable Body</title></head><body>" +
  `<nav><a href="/">Home</a><a href="/about">About</a></nav>` +
  `<header><div>${BOILERPLATE_MARKER}</div></header>` +
  "<main><article><h1>The Readable Heading</h1>" +
  "<p>The article opens with a substantial lead paragraph that carries well over two hundred " +
  "characters of genuine prose so the extractor is confident this document is a complete article " +
  "and not a thin fragment that should be discarded by the length guard in the source.</p>" +
  "<p>A second body paragraph reinforces the signal with more sentences of real content, keeping " +
  "the readable portion comfortably above the markdown length threshold used by fetch-content.</p>" +
  "</article></main>" +
  `<aside>${BOILERPLATE_MARKER}</aside>` +
  `<footer>${BOILERPLATE_MARKER}</footer>` +
  "</body></html>";

// Route every fetch through canned responses so the source (and its jina/gemini
// fallbacks) never touch the network. The article URLs succeed; everything else
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
    if (url === CHROME_URL) {
      return new Response(CHROME_HTML, {
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

test("fetch-content readable extraction keeps article prose and drops site chrome", async () => {
  // Guards the @mozilla/readability 0.5 -> 0.6 bump: the extractor must still
  // isolate the <article> body, convert it to markdown, and strip the
  // nav/header/aside/footer boilerplate around it.
  const evidence = await assertSuccessContract(fetchContentSource, { query: CHROME_URL });

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.payload.kind, "document");
  if (item?.payload.kind !== "document") throw new Error("expected document payload");

  assert.match(item.payload.title, /Readable Body|Readable Heading/);
  assert.match(item.payload.content, /The Readable Heading/);
  assert.match(item.payload.content, /substantial lead paragraph/);
  assert.match(item.payload.content, /second body paragraph/);
  assert.ok(
    !item.payload.content.includes(BOILERPLATE_MARKER),
    "readable extraction must drop nav/header/aside/footer boilerplate"
  );
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
