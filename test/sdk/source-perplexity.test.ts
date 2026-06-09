import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { perplexitySource } from "../../src/sdk/sources/perplexity.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// Perplexity gates on an API key (`resolveSecret("perplexityApiKey")`) and then
// POSTs to the Perplexity chat API over the global `fetch`. We isolate HOME from
// the real config, set PERPLEXITY_API_KEY so the key resolves from the env
// fast-path, and stub `fetch` so the run never reaches the network.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalKey = process.env.PERPLEXITY_API_KEY;
let homeDir = "";

const API_URL = "https://api.perplexity.ai/chat/completions";

function perplexityResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "Bun ships a built-in sqlite module." } }],
      citations: [
        { title: "Bun SQLite", url: "https://example.com/bun-sqlite" },
        "https://example.com/raw-citation"
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-perplexity-home-"));
  process.env.HOME = homeDir;
  process.env.PERPLEXITY_API_KEY = "dummy-perplexity-key";
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY;
  else process.env.PERPLEXITY_API_KEY = originalKey;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

test("perplexity declares the capabilities and transport it uses", () => {
  assertCapabilities(perplexitySource, {
    name: "perplexity",
    domain: "web",
    capabilities: ["search"],
    transports: ["perplexity-api"]
  });
});

// Pinning the web strategy to `provider: "perplexity"` isolates the failure: the
// stubbed API returns 500, the source throws, and the strategy degrades to a
// typed RunEmpty without letting the error escape the source boundary.
test("perplexity failure surfaces a typed RunEmpty without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream boom", { status: 500, statusText: "Server Error" })) as typeof fetch;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "web", query: "bun sqlite", provider: "perplexity" }),
    { kind: "empty", domain: "web" }
  );

  assert.equal(result.kind, "empty");
});

test("perplexity maps citations into contract-conforming evidence", async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === API_URL) return perplexityResponse();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    perplexitySource,
    { query: "bun sqlite", numResults: 5 },
    makeSourceContext()
  );

  assert.equal(evidence.length, 2);
  const [first] = evidence;
  assert.equal(first?.provenance.kind, "web");
  if (first?.provenance.kind !== "web") throw new Error("expected web provenance");
  assert.equal(first.provenance.transport, "perplexity-api");
  assert.equal(first.provenance.url, "https://example.com/bun-sqlite");
  assert.equal(first.payload.kind, "search-result");
  assert.equal(first.payload.title, "Bun SQLite");
  assert.equal(first.payload.content.kind, "none");
  assert.equal(first.payload.native.provider, "perplexity-api");
  assert.equal(evidence[1]?.payload.url, "https://example.com/raw-citation");
});
