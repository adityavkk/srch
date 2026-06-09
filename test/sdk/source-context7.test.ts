import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { context7Source } from "../../src/sdk/sources/context7.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// Context7 talks to its MCP endpoint over the global `fetch`, returning
// server-sent-event frames. The lib first resolves a library id, then fetches
// docs for it; we stub both calls so the run is fully offline. Docs text must
// clear the lib's 80-char "meaningful" threshold to surface as evidence.
//
// The empty-path test drives the whole code strategy, which also runs exa-code;
// we isolate HOME and set a dummy EXA_API_KEY so its secret lookup never spawns
// a real `op`/`fnox` credential helper against the developer's config.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalExaKey = process.env.EXA_API_KEY;
let homeDir = "";

function sseFrame(payload: unknown): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function mcpText(text: string): unknown {
  return { result: { content: [{ type: "text", text }] } };
}

const DOCS_TEXT =
  "Bun ships a fast built-in sqlite module exposed as `bun:sqlite`. It provides a synchronous, " +
  "high-performance API for embedded databases with prepared statements and transactions.";

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-context7-home-"));
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

test("context7 declares the capabilities and transport it uses", () => {
  assertCapabilities(context7Source, {
    name: "context7",
    domain: "code",
    capabilities: ["search", "docs"],
    transports: ["context7-mcp"]
  });
});

// The code strategy fans out to exa-code, context7 and deepwiki; with every MCP
// call stubbed to fail, none yields evidence and the strategy degrades to a
// typed RunEmpty rather than letting any source error escape.
test("context7 empty path surfaces a typed RunEmpty without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream boom", { status: 500, statusText: "Server Error" })) as typeof fetch;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "code", query: "no/such-library obscure symbol" }),
    { kind: "empty", domain: "code" }
  );

  assert.equal(result.kind, "empty");
});

test("context7 maps resolved docs into contract-conforming evidence", async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    // First call resolves the library id, second returns the docs text.
    return call === 1
      ? sseFrame(mcpText("Selected library: /oven-sh/bun"))
      : sseFrame(mcpText(DOCS_TEXT));
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    context7Source,
    { query: "bun sqlite" },
    makeSourceContext()
  );

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "api");
  if (item?.provenance.kind !== "api") throw new Error("expected api provenance");
  assert.equal(item.provenance.api, "context7");
  assert.equal(item.provenance.transport, "context7-mcp");
  assert.equal(item.payload.kind, "text");
  assert.match(item.payload.title, /\/oven-sh\/bun/);
  assert.equal(item.payload.text, DOCS_TEXT);
  assert.ok(item.payload.native.resolve !== undefined);
  assert.ok(item.payload.native.docs !== undefined);
});
