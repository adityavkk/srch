import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { geminiSource } from "../../src/sdk/sources/gemini.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// Gemini has two transports: a logged-in web profile (cookies read from HOME)
// and the generative-language API (gated on GEMINI_API_KEY). We isolate HOME so
// no real browser cookies are read (the web transport degrades to null), set
// GEMINI_API_KEY so the API path resolves its key from the env fast-path, and
// stub `fetch` so the API call stays offline. The success path pins
// `transport: "api"` to exercise the API backend deterministically.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalKey = process.env.GEMINI_API_KEY;
let homeDir = "";

function geminiApiResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "Bun ships a built-in sqlite module." }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://example.com/bun-sqlite", title: "Bun SQLite" } },
              { web: { uri: "https://example.com/guide", title: "Guide" } }
            ]
          }
        }
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-gemini-home-"));
  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = "dummy-gemini-key";
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

test("gemini declares the capabilities and transports it uses", () => {
  assertCapabilities(geminiSource, {
    name: "gemini",
    domain: "web",
    capabilities: ["search"],
    transports: ["gemini-web", "gemini-api"]
  });
});

// Pinning the web strategy to `provider: "gemini"` isolates the failure: with no
// browser profile the web transport yields nothing and the stubbed API returns
// 500, so the strategy degrades to a typed RunEmpty without throwing out of the
// source boundary.
test("gemini failure surfaces a typed RunEmpty without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream boom", { status: 500, statusText: "Server Error" })) as typeof fetch;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "web", query: "bun sqlite", provider: "gemini" }),
    { kind: "empty", domain: "web" }
  );

  assert.equal(result.kind, "empty");
});

test("gemini maps grounded API results into contract-conforming evidence", async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("generativelanguage.googleapis.com")) return geminiApiResponse();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    geminiSource,
    { query: "bun sqlite", transport: "api", numResults: 5 },
    makeSourceContext()
  );

  assert.equal(evidence.length, 2);
  const [first] = evidence;
  assert.equal(first?.provenance.kind, "web");
  if (first?.provenance.kind !== "web") throw new Error("expected web provenance");
  assert.equal(first.provenance.transport, "gemini-api");
  assert.equal(first.provenance.url, "https://example.com/bun-sqlite");
  assert.equal(first.payload.kind, "search-result");
  assert.equal(first.payload.title, "Bun SQLite");
  assert.equal(first.payload.content.kind, "none");
  assert.equal(first.payload.native.provider, "gemini-api");
});
