import assert from "node:assert/strict";
import test from "node:test";
import { createClient, defineSource, fetchDefaultStrategy } from "../../src/sdk.js";
import type { Evidence, FetchEvidencePayload, Source, SourceRequest } from "../../src/sdk.js";

function document(source: string, url: string, content: string): Evidence<FetchEvidencePayload> {
  return {
    source,
    domain: "fetch",
    query: url,
    provenance: { kind: "web", url, transport: source === "exa-fetch" ? "exa-mcp" : "http", timestamp: Date.now(), cached: false },
    payload: { kind: "document", url, title: `${source} title`, content, images: [] }
  };
}

function createSource(name: string, run: Source<SourceRequest, FetchEvidencePayload>["run"]): Source<SourceRequest, FetchEvidencePayload> {
  return defineSource({ name, domain: "fetch", capabilities: ["fetch"], traits: [], transports: [name], run });
}

function clientWith(primary: Source<SourceRequest, FetchEvidencePayload>["run"], fallback: Source<SourceRequest, FetchEvidencePayload>["run"]) {
  const calls: string[] = [];
  const track = (name: string, run: Source<SourceRequest, FetchEvidencePayload>["run"]) =>
    createSource(name, async (req, ctx) => {
      calls.push(name);
      return run(req, ctx);
    });
  const client = createClient({ sources: [track("fetch-content", primary), track("exa-fetch", fallback)], strategies: [fetchDefaultStrategy] });
  return { client, calls };
}

test("fetch/default keeps the primary fetch when it returns text", async () => {
  const { client, calls } = clientWith(
    async (req) => [document("fetch-content", req.query, "Readable page text.")],
    async () => { throw new Error("must not run"); }
  );

  const result = await client.run({ domain: "fetch", query: "https://docs.example.com/page" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(calls, ["fetch-content"]);
  assert.equal(result.evidence[0].source, "fetch-content");
  assert.deepEqual(result.summary.sourceBreakdown, { "fetch-content": 1 });
  assert.equal(result.summary.attempts.length, 1);
});

test("fetch/default falls back to exa-fetch when the primary fetch fails", async () => {
  const { client, calls } = clientWith(
    async () => { throw new Error("HTTP 403: Forbidden"); },
    async (req) => [document("exa-fetch", req.query, "Text read by Exa.")]
  );

  const result = await client.run({ domain: "fetch", query: "https://docs.example.com/blocked" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(calls, ["fetch-content", "exa-fetch"]);
  assert.equal(result.evidence[0].payload.content, "Text read by Exa.");
  assert.deepEqual(result.summary.sourceBreakdown, { "exa-fetch": 1 });
  assert.deepEqual(result.summary.attempts.map((attempt) => [attempt.provider, attempt.status]), [["fetch-content", "failed"], ["exa-fetch", "success"]]);
});

test("fetch/default falls back to exa-fetch when the primary fetch returns no text", async () => {
  const { client, calls } = clientWith(
    async (req) => [document("fetch-content", req.query, "   ")],
    async (req) => [document("exa-fetch", req.query, "Text read by Exa.")]
  );

  const result = await client.run({ domain: "fetch", query: "https://docs.example.com/empty" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(calls, ["fetch-content", "exa-fetch"]);
  const [first] = result.summary.attempts;
  assert.equal(first.status === "failed" ? first.error : "", "fetch-content returned no text");
});

test("fetch/default reports both errors when the fallback also fails", async () => {
  const { client } = clientWith(
    async () => { throw new Error("HTTP 403: Forbidden"); },
    async () => { throw new Error("Exa could not read the page: CRAWL_UNKNOWN_ERROR"); }
  );

  const result = await client.run({ domain: "fetch", query: "https://docs.example.com/gone" });

  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "fetch_failed");
  assert.equal(result.error.message, "HTTP 403: Forbidden (exa-fetch: Exa could not read the page: CRAWL_UNKNOWN_ERROR)");
});

test("fetch/default skips the fallback after an abort", async () => {
  const controller = new AbortController();
  const { client, calls } = clientWith(
    async () => {
      controller.abort();
      throw new Error("Aborted");
    },
    async () => { throw new Error("must not run"); }
  );

  const result = await client.run({ domain: "fetch", query: "https://docs.example.com/slow", signal: controller.signal });

  assert.equal(result.kind, "error");
  assert.deepEqual(calls, ["fetch-content"]);
});
