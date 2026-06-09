import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResponse } from "../../src/lib/core/types.js";
import { mapSearchResponseEvidence } from "../../src/sdk/sources/web-shared.js";
import { assertEvidenceContract } from "./source-contract.js";

type Native = { provider: string; ok: boolean };

function response(native: Native, results: SearchResponse["results"]): SearchResponse & { native: Native } {
  return { answer: "", results, native };
}

test("mapSearchResponseEvidence maps results into contract-conforming web evidence", () => {
  const native: Native = { provider: "brave", ok: true };
  const mapped = mapSearchResponseEvidence(
    "brave",
    "bun sqlite",
    response(native, [
      { title: "Bun SQLite", url: "https://example.com/a", snippet: "fast embedded db" },
      { title: "Guide", url: "https://example.com/b", snippet: "second result" }
    ]),
    "brave-api"
  );

  assert.equal(mapped.length, 2);
  assertEvidenceContract(mapped, { source: "brave", domain: "web", query: "bun sqlite" });

  const [first] = mapped;
  assert.equal(first?.provenance.kind, "web");
  if (first?.provenance.kind !== "web") throw new Error("expected web provenance");
  assert.equal(first.provenance.transport, "brave-api");
  assert.equal(first.provenance.url, "https://example.com/a");
  assert.equal(first.provenance.cached, false);
  assert.equal(first.payload.kind, "search-result");
  assert.equal(first.payload.title, "Bun SQLite");
  assert.equal(first.payload.content.kind, "none");
  assert.deepEqual(first.payload.native, native);
});

test("mapSearchResponseEvidence attaches inline content when provided for a url", () => {
  const native: Native = { provider: "perplexity", ok: true };
  const inline = new Map<string, string>([["https://example.com/a", "Full inline body"]]);
  const mapped = mapSearchResponseEvidence(
    "perplexity",
    "durable objects",
    response(native, [
      { title: "With content", url: "https://example.com/a", snippet: "snippet a" },
      { title: "Without content", url: "https://example.com/b", snippet: "snippet b" }
    ]),
    "perplexity-api",
    inline
  );

  assert.equal(mapped[0]?.payload.content.kind, "inline");
  if (mapped[0]?.payload.content.kind !== "inline") throw new Error("expected inline content");
  assert.equal(mapped[0].payload.content.text, "Full inline body");
  assert.equal(mapped[1]?.payload.content.kind, "none");
});

test("mapSearchResponseEvidence returns an empty array when the transport returns no results", () => {
  const native: Native = { provider: "brave", ok: true };
  const mapped = mapSearchResponseEvidence("brave", "no hits", response(native, []), "brave-api");

  assert.deepEqual(mapped, []);
});
