import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { deepwikiSource } from "../../src/sdk/sources/deepwiki.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// DeepWiki first infers an `owner/repo` from the query, then asks its MCP
// endpoint over the global `fetch`. We stub the MCP call so the run is offline;
// the answer text must clear the lib's 80-char "meaningful" threshold to
// surface as evidence.
//
// The empty-path test drives the whole code strategy, which also runs exa-code;
// we isolate HOME and set a dummy EXA_API_KEY so its secret lookup never spawns
// a real `op`/`fnox` credential helper against the developer's config.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalExaKey = process.env.EXA_API_KEY;
let homeDir = "";

const ANSWER_TEXT =
  "Bun's sqlite support lives in the `bun:sqlite` module, a synchronous embedded database API " +
  "with prepared statements, transactions and a fast native backend implemented in Zig.";

function deepwikiResponse(): Response {
  const payload = {
    result: {
      structuredContent: { result: ANSWER_TEXT },
      content: [{ type: "text", text: ANSWER_TEXT }],
      isError: false
    }
  };
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-deepwiki-home-"));
  process.env.HOME = homeDir;
  process.env.EXA_API_KEY = "dummy-exa-key";
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalHome;
  if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalExaKey;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

test("deepwiki declares the capabilities and transport it uses", () => {
  assertCapabilities(deepwikiSource, {
    name: "deepwiki",
    domain: "code",
    capabilities: ["search", "docs"],
    transports: ["deepwiki-mcp"]
  });
});

// The code strategy fans out to exa-code, context7 and deepwiki; with the MCP
// calls stubbed to fail none yields evidence, so the strategy degrades to a
// typed RunEmpty rather than letting a source error escape.
test("deepwiki empty path surfaces a typed RunEmpty without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream boom", { status: 500, statusText: "Server Error" })) as typeof fetch;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "code", query: "oven-sh/bun obscure symbol" }),
    { kind: "empty", domain: "code" }
  );

  assert.equal(result.kind, "empty");
});

test("deepwiki maps a repo answer into contract-conforming evidence", async () => {
  globalThis.fetch = (async () => deepwikiResponse()) as typeof fetch;

  const evidence = await assertSuccessContract(
    deepwikiSource,
    { query: "oven-sh/bun how does sqlite support work" },
    makeSourceContext()
  );

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "api");
  if (item?.provenance.kind !== "api") throw new Error("expected api provenance");
  assert.equal(item.provenance.api, "deepwiki");
  assert.equal(item.provenance.transport, "deepwiki-mcp");
  assert.equal(item.payload.kind, "text");
  assert.match(item.payload.title, /oven-sh\/bun/);
  assert.equal(item.payload.text, ANSWER_TEXT);
});
