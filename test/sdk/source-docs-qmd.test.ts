import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { docsQmdSource } from "../../src/sdk/sources/docs-qmd.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// docs-qmd is backed by a local qmd SQLite index resolved from HOME at module
// load. We point HOME at a throwaway dir so the source reads an isolated index:
// the empty-index path runs first (no collection -> RunEmpty), then we seed a
// collection and exercise the populated success path against the same index.
const originalHome = process.env.HOME;
let homeDir = "";
let docsDir = "";

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-docs-home-"));
  docsDir = mkdtempSync(join(tmpdir(), "srch-docs-src-"));
  process.env.HOME = homeDir;
});

after(() => {
  process.env.HOME = originalHome;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  if (docsDir) rmSync(docsDir, { recursive: true, force: true });
});

test("docs-qmd declares the capabilities and transport it uses", () => {
  assertCapabilities(docsQmdSource, {
    name: "docs-qmd",
    domain: "docs",
    capabilities: ["search"],
    transports: ["qmd-sdk"]
  });
});

// Runs before the index is seeded: an empty local index yields zero evidence,
// which the docs strategy must report as a typed RunEmpty with suggestions
// rather than throwing.
test("docs-qmd empty index surfaces a typed RunEmpty without throwing out of the source", async () => {
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "docs", query: "nothing indexed yet" }),
    { kind: "empty", domain: "docs" }
  );

  assert.equal(result.kind, "empty");
});

test("docs-qmd maps indexed documents into contract-conforming evidence", async () => {
  writeFileSync(
    join(docsDir, "bun.md"),
    "# Bun SQLite Guide\n\nBun ships a fast built-in sqlite module for embedded databases.\n"
  );

  const { docsAddCollection, docsUpdate } = await import("../../src/lib/docs/qmd.js");
  await docsAddCollection(docsDir, "contract-docs", "**/*.md");
  await docsUpdate();

  const evidence = await assertSuccessContract(
    docsQmdSource,
    { query: "bun sqlite", limit: 5 },
    makeSourceContext()
  );

  const [item] = evidence;
  assert.equal(item?.provenance.kind, "local");
  if (item?.provenance.kind !== "local") throw new Error("expected local provenance");
  assert.ok(item.provenance.path.length > 0);
  assert.equal(item.payload.kind, "doc-result");
  assert.match(item.payload.title, /Bun SQLite Guide/);
  assert.equal(item.payload.file, item.provenance.path);
  assert.equal(typeof item.payload.score, "number");
  assert.ok(item.payload.snippet.length > 0);
  assert.ok(item.payload.native !== undefined);
});
