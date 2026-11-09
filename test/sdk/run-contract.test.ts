import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createClient, codeDefaultStrategy, defineSource, defineStrategy } from "../../src/sdk.js";
import type { Domain, Evidence, RunResult, Source, StaticStrategy } from "../../src/sdk.js";
import { createSourceContext } from "../../src/sdk/config.js";

const evidence: Evidence = {
  source: "notes-source", domain: "notes", query: "test",
  provenance: { kind: "local", path: "notes.txt", timestamp: 0 }, payload: { text: "test" }
};

function source(name: string, domain: string, run: Source["run"]): Source {
  return defineSource({ name, domain, capabilities: ["search"], traits: [], transports: ["mock"], run });
}

function notesResult(): RunResult {
  return {
    kind: "success", domain: "notes", strategy: "notes/default", evidence: [evidence],
    summary: { totalEvidence: 1, sourceBreakdown: { "notes-source": 1 }, attempts: [{ provider: "notes-source", status: "success", transport: "mock", durationMs: 0, evidenceCount: 1 }], durationMs: 0 },
    trace: [{ label: "custom-detail", startedAt: 0 }]
  };
}

const notesDomain: Domain = { name: "notes", defaultStrategy: "notes/default", strategies: ["notes/default"], sources: ["notes-source"], capabilities: ["search"], subdomains: [] };

function notesClient(run: StaticStrategy["run"]) {
  return createClient({ trace: true, config: {
    modules: [], sources: [source("notes-source", "notes", async () => [evidence])],
    strategies: [defineStrategy({ kind: "static", name: "notes/default", domain: "notes", run })], domains: [notesDomain]
  } });
}

test("run resolves thrown strategy errors and preserves source attempts and trace", async () => {
  const client = notesClient(async (req, ctx) => {
    ctx.trace.step("before-failure");
    await ctx.search("notes-source", req);
    throw new Error("custom strategy failed");
  });
  const result = await client.run({ domain: "notes", query: "test" });
  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "strategy_failed");
  assert.equal(result.strategy, "notes/default");
  assert.equal(result.summary?.attempts[0].status, "success");
  assert.ok(result.trace.some((event) => event.label === "before-failure"));
});

test("docs provider rejection resolves to an error with failed attempt details", async () => {
  const client = createClient({ trace: true, sources: [source("docs-qmd", "docs", async (_req, ctx) => {
    ctx.trace.step("docs-failed");
    throw new Error("index unavailable");
  })] });
  const result = await client.run({ domain: "docs", query: "test" });
  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.message, "index unavailable");
  assert.equal(result.summary?.attempts[0].status, "failed");
  assert.ok(result.trace.some((event) => event.label === "docs-failed"));
});

test("run preserves trace supplied by custom strategies", async () => {
  const result = await notesClient(async (_req, ctx) => { ctx.trace.step("context-detail"); return notesResult(); }).run({ domain: "notes", query: "test" });
  assert.equal(result.kind, "success");
  assert.deepEqual(result.trace.map((event) => event.label), ["context-detail", "custom-detail"]);
});

test("run does not repeat a context trace returned by the strategy", async () => {
  const result = await notesClient(async (_req, ctx) => {
    ctx.trace.step("context-detail");
    return { ...notesResult(), trace: ctx.trace.snapshot() };
  }).run({ domain: "notes", query: "test" });
  assert.deepEqual(result.trace.map((event) => event.label), ["context-detail"]);
});

test("run rejects malformed success and wrong-domain results", async () => {
  for (const changed of [
    { evidence: [] }, { evidence: [undefined] }, { evidence: [{ ...evidence, domain: "web" }] },
    { evidence: [{ ...evidence, query: 42 }] }, { evidence: [{ ...evidence, source: null }] },
    { domain: "web" }, { summary: undefined },
    { summary: { totalEvidence: 1, attempts: [undefined] } }
  ]) {
    const client = notesClient(async () => ({ ...notesResult(), ...changed }) as RunResult);
    const result = await client.run({ domain: "notes", query: "test" });
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.error.code, "invalid_result");
  }
});

test("run honors cancellation even when a strategy returns success after abort", async () => {
  for (const reason of [new DOMException("stop", "AbortError"), new DOMException("deadline", "TimeoutError")]) {
    const controller = new AbortController();
    const client = notesClient(async (req, ctx) => {
      await ctx.search("notes-source", req);
      ctx.trace.step("before-abort");
      controller.abort(reason);
      return notesResult();
    });
    const result = await client.run({ domain: "notes", query: "test", signal: controller.signal });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.error.code, reason.name === "TimeoutError" ? "timeout" : "aborted");
    assert.equal(result.summary?.attempts[0].status, "success");
    assert.ok(result.trace.some((event) => event.label === "before-abort"));
  }
});

test("run does not execute a strategy when already cancelled", async () => {
  let called = false;
  const client = notesClient(async () => { called = true; return notesResult(); });
  const result = await client.run({ domain: "notes", query: "test", signal: AbortSignal.abort() });
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.error.code, "aborted");
  assert.equal(called, false);
});

test("run returns promptly when an adapter ignores cancellation", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const client = createClient({ sources: [source("docs-qmd", "docs", async () => new Promise(() => {}))] });
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    const result = await client.run({ domain: "docs", query: "test", signal: controller.signal });
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.equal(result.error.code, "aborted");
      assert.equal(result.summary?.attempts[0].status, "failed");
    }
  } finally {
    clearTimeout(timer);
  }
});

test("run returns promptly when a custom strategy ignores cancellation", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const client = notesClient(async () => new Promise(() => {}));
  const timer = setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), 10);
  try {
    const result = await client.run({ domain: "notes", query: "test", signal: controller.signal });
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.error.code, "timeout");
  } finally {
    clearTimeout(timer);
  }
});

test("direct source cancellation rejects promptly and releases its abort listener", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const client = createClient({ sources: [source("docs-qmd", "docs", async () => new Promise(() => {}))] });
  const pending = client.search("docs-qmd", { query: "test", signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("successful direct search releases its abort listener", async () => {
  const controller = new AbortController();
  const client = createClient({ sources: [source("docs-qmd", "docs", async () => [])] });
  await client.search("docs-qmd", { query: "test", signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("run rejects cross-domain strategies before executing them", async () => {
  const result = await createClient().run({ domain: "web", strategy: "docs/default", query: "test" });
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.error.code, "invalid_strategy");
});

test("fetch with no evidence returns empty and records its actual transport when present", async () => {
  const empty = await createClient({ sources: [source("fetch-content", "fetch", async () => [])] }).run({ domain: "fetch", query: "https://example.test" });
  assert.equal(empty.kind, "empty");
  if (empty.kind === "empty") assert.equal(empty.summary.totalEvidence, 0);
  const result = await createClient({ sources: [source("fetch-content", "fetch", async () => [{ ...evidence, source: "fetch-content", domain: "fetch", provenance: { kind: "web", url: "https://example.test", transport: "jina", timestamp: 0, cached: false } }])] }).run({ domain: "fetch", query: "https://example.test" });
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.equal(result.summary.attempts[0].transport, "jina");
});

test("code distinguishes total outage, incomplete search, and successful empty search", async () => {
  for (const failedCount of [3, 2, 0]) {
    const sources = ["exa-code", "context7", "deepwiki"].map((name, index) => source(name, "code", async () => {
      if (index < failedCount) throw new Error(`${name} offline`);
      return [];
    }));
    const result = await createClient({ sources, strategies: [codeDefaultStrategy] }).run({ domain: "code", query: "test" });
    assert.equal(result.kind, failedCount === 0 ? "empty" : "error");
    if (result.kind === "error") assert.equal(result.error.code, failedCount === 3 ? "code_unavailable" : "code_incomplete");
    assert.equal(result.summary?.attempts.length, 3);
    assert.equal(result.summary?.attempts.filter((attempt) => attempt.status === "failed").length, failedCount);
  }
});

test("code retains partial evidence and failure details", async () => {
  const sources = ["exa-code", "context7", "deepwiki"].map((name, index) => source(name, "code", async () => {
    if (index === 0) return [{ ...evidence, source: name, domain: "code" }];
    throw new Error(`${name} offline`);
  }));
  const result = await createClient({ sources, strategies: [codeDefaultStrategy] }).run({ domain: "code", query: "test" });
  assert.equal(result.kind, "success");
  assert.equal(result.summary?.attempts.filter((attempt) => attempt.status === "failed").length, 2);
});

test("explicit domain configuration rejects missing and mismatched references", () => {
  const base = { modules: [], sources: [source("notes-source", "notes", async () => [])], strategies: [defineStrategy({ kind: "static", name: "notes/default", domain: "notes", run: async () => notesResult() })] };
  assert.throws(() => createClient({ config: { ...base, domains: [notesDomain, { ...notesDomain, name: "typo", defaultStrategy: "missing", strategies: ["missing"] }] } }), /typo.*unknown strategy missing/);
  assert.throws(() => createClient({ config: { ...base, domains: [{ ...notesDomain, sources: ["notes-source", "missing"] }] } }), /notes.*unknown source missing/);
  assert.throws(() => createClient({ config: { ...base, domains: [{ ...notesDomain, name: "other" }] } }), /belongs to domain notes, not other/);
  assert.throws(() => createClient({ config: { ...base, domains: [notesDomain], defaults: { strategy: "missing" } } }), /Default strategy missing/);
});

test("implicit built-in domains are still pruned for a subset of sources", async () => {
  const client = createClient({ sources: [source("docs-qmd", "docs", async () => [])] });
  assert.deepEqual((await client.status()).domains, ["docs"]);
});

test("injected transports disable local GitHub fallback", () => {
  assert.equal(createSourceContext().allowLocalGitHub, true);
  assert.equal(createSourceContext({ http: { fetch } }).allowLocalGitHub, false);
  assert.equal(createSourceContext({ secrets: { resolve: async () => null } }).allowLocalGitHub, false);
});
