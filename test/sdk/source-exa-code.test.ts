import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { exaCodeSource } from "../../src/sdk/sources/exa-code.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// exa-code prefers the Exa Context API (gated on `resolveSecret("exaApiKey")`)
// and falls back to the Exa MCP endpoint. We isolate HOME from the real config,
// set EXA_API_KEY so the key resolves from the env fast-path, and stub `fetch`
// so the Context API call returns canned text without touching the network.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalKey = process.env.EXA_API_KEY;
let homeDir = "";

const CONTEXT_URL = "https://api.exa.ai/context";
const CODE_TEXT =
  "To open an embedded database in Bun, import Database from `bun:sqlite` and call " +
  "`new Database(\"app.db\")`, then `db.query(...)` for prepared statements.";

function contextResponse(): Response {
  return new Response(
    JSON.stringify({ response: CODE_TEXT, resultsCount: 3, outputTokens: 128 }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-exa-code-home-"));
  process.env.HOME = homeDir;
  process.env.EXA_API_KEY = "dummy-exa-key";
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalKey;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

test("exa-code declares the capabilities and transports it uses", () => {
  assertCapabilities(exaCodeSource, {
    name: "exa-code",
    domain: "code",
    capabilities: ["search", "context"],
    transports: ["exa-context-api", "exa-mcp"]
  });
});

// The code strategy fans out to exa-code, context7 and deepwiki; with both the
// Context API and every MCP call stubbed to fail, none yields evidence and the
// strategy degrades to a typed RunEmpty rather than letting an error escape.
test("exa-code empty path surfaces a typed RunEmpty without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream boom", { status: 500, statusText: "Server Error" })) as typeof fetch;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "code", query: "obscure private symbol" }),
    { kind: "empty", domain: "code" }
  );

  assert.equal(result.kind, "empty");
});

test("exa-code maps Context API output into contract-conforming evidence", async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === CONTEXT_URL) return contextResponse();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    exaCodeSource,
    { query: "bun sqlite", maxTokens: 2000 },
    makeSourceContext()
  );

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "api");
  if (item?.provenance.kind !== "api") throw new Error("expected api provenance");
  assert.equal(item.provenance.api, "exa");
  assert.equal(item.provenance.transport, "exa-context-api");
  assert.equal(item.payload.kind, "text");
  assert.equal(item.payload.title, "Exa code context");
  assert.equal(item.payload.text, CODE_TEXT);
  assert.equal(item.payload.native.provider, "exa-context-api");
});
