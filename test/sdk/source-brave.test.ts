import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { braveSource } from "../../src/sdk/sources/brave.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// Brave gates on an API key (`resolveSecret("braveApiKey")`) and then calls the
// Brave Search REST API over the global `fetch`. We point HOME at a throwaway
// dir so the real `~/.search/config.json` (which references 1Password) is never
// read, set BRAVE_API_KEY so the key resolves from the env fast-path without
// spawning any secret backend, and stub `fetch` so the run stays offline.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalKey = process.env.BRAVE_API_KEY;
let homeDir = "";

const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

function braveResponse(): Response {
  return new Response(
    JSON.stringify({
      web: {
        results: [
          { title: "Bun SQLite", url: "https://example.com/bun-sqlite", description: "fast embedded db" },
          { title: "Guide", url: "https://example.com/guide", description: "second result" }
        ]
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-brave-home-"));
  process.env.HOME = homeDir;
  process.env.BRAVE_API_KEY = "dummy-brave-key";
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = originalKey;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

test("brave declares the capabilities and transport it uses", () => {
  assertCapabilities(braveSource, {
    name: "brave",
    domain: "web",
    capabilities: ["search"],
    transports: ["brave-search-api"]
  });
});

// Pinning the web strategy to `provider: "brave"` isolates the failure to the
// source under test: the stubbed API returns 500, the source throws, and the
// strategy degrades to a typed RunEmpty rather than letting the error escape.
test("brave failure surfaces a typed RunEmpty without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream boom", { status: 500, statusText: "Server Error" })) as typeof fetch;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "web", query: "bun sqlite", provider: "brave" }),
    { kind: "empty", domain: "web" }
  );

  assert.equal(result.kind, "empty");
});

test("brave maps search results into contract-conforming evidence", async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(SEARCH_URL)) return braveResponse();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    braveSource,
    { query: "bun sqlite", numResults: 5 },
    makeSourceContext()
  );

  assert.equal(evidence.length, 2);
  const [first] = evidence;
  assert.equal(first?.provenance.kind, "web");
  if (first?.provenance.kind !== "web") throw new Error("expected web provenance");
  assert.equal(first.provenance.transport, "brave-search-api");
  assert.equal(first.provenance.url, "https://example.com/bun-sqlite");
  assert.equal(first.provenance.cached, false);
  assert.equal(first.payload.kind, "search-result");
  assert.equal(first.payload.title, "Bun SQLite");
  assert.equal(first.payload.snippet, "fast embedded db");
  assert.equal(first.payload.content.kind, "none");
  assert.equal(first.payload.native.provider, "brave-search-api");
});
