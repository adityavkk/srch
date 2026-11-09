import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchesDomain, scoreWebEvaluation, type WebEvalCase, type WebEvalRun } from "../src/lib/eval/web.js";

const dataset = JSON.parse(readFileSync(new URL("../eval/web-cases.json", import.meta.url), "utf8")) as { cases: WebEvalCase[]; replay: WebEvalRun[] };
const excerpt = "A sufficiently long synthetic excerpt describing a documentation page.";
const caseFor = (id: string): WebEvalCase => ({ id, query: id, expectedDomains: ["example.com"] });
const runFor = (caseId: string, overrides: Partial<WebEvalRun> = {}): WebEvalRun => ({ caseId, status: "success", durationMs: 10, results: [{ url: "https://example.com/docs", snippet: excerpt }], ...overrides });

test("evaluation uses fixed top-five denominators and keeps empty and failed queries", () => {
  const report = scoreWebEvaluation([caseFor("one"), caseFor("two"), caseFor("three")], [
    runFor("one", { durationMs: 10 }), runFor("two", { status: "empty", results: [], durationMs: 20 }),
    runFor("three", { status: "error", results: [], durationMs: 100 })
  ]);
  assert.equal(report.summary.sourceMatchAt5, 1 / 5 / 3);
  assert.equal(report.summary.expectedSourceHitRate, 1 / 3);
  assert.equal(report.summary.excerptCoverageAt5, 1 / 5 / 3);
  assert.deepEqual(report.summary.latencyMs, { p50: 20, p95: 100 });
  assert.equal(report.summary.empty, 1);
  assert.equal(report.summary.error, 1);
});

test("source matching rejects deceptive hostnames, credentials, and non-web URLs", () => {
  assert.equal(matchesDomain("https://docs.example.com/page", "example.com"), true);
  for (const url of ["https://example.com.evil.test/", "https://badexample.com/", "https://example.com@evil.test/", "https://user@example.com/", "file://example.com/page"]) {
    assert.equal(matchesDomain(url, "example.com"), false, url);
  }
});

test("duplicate URLs and results after rank five cannot inflate scores", () => {
  const results = ["https://example.com/docs", "https://example.com/docs#part", "https://example.com/docs/", "https://other.test/a", "https://other.test/b", "https://example.com/sixth"].map((url) => ({ url, snippet: excerpt }));
  const report = scoreWebEvaluation([caseFor("one")], [runFor("one", { results })]);
  assert.equal(report.summary.sourceMatchAt5, 1 / 5);
  assert.equal(report.summary.excerptCoverageAt5, 3 / 5);
  assert.equal(report.perQuery[0].results.length, 5);
  assert.equal(report.perQuery[0].results[1].duplicate, true);
});

test("domain compliance honors exclusions and never passes an empty result", () => {
  const filtered = { ...caseFor("one"), domainFilter: ["example.com", "-private.example.com"] };
  const results = ["https://docs.example.com/a", "https://private.example.com/a", "https://example.com.evil.test/a"].map((url) => ({ url }));
  const report = scoreWebEvaluation([filtered], [runFor("one", { results })]);
  assert.equal(report.summary.domainCompliance, 1 / 3);
  const empty = scoreWebEvaluation([filtered], [runFor("one", { status: "empty", results: [] })]);
  assert.equal(empty.summary.domainCompliance, null);
  assert.equal(empty.summary.domainFilteredQueries, 1);
  assert.equal(empty.summary.domainFilteredQueriesWithResults, 0);
});

test("unknown costs stay unknown and failed request costs count toward cost per success", () => {
  const cases = [caseFor("one"), caseFor("two")];
  const runs = [runFor("one", { costUsd: 0.01 }), runFor("two", { status: "error", results: [] })];
  assert.deepEqual(scoreWebEvaluation(cases, runs).summary.cost, { knownUsd: 0.01, unknownRuns: 1, totalUsd: null, usdPerSuccess: null });
  runs[1].costUsd = 0.02;
  assert.deepEqual(scoreWebEvaluation(cases, runs).summary.cost, { knownUsd: 0.03, unknownRuns: 0, totalUsd: 0.03, usdPerSuccess: 0.03 });
});

test("skipped providers do not count as fallback and fixture replay is deterministic", () => {
  const one = runFor("one", { attempts: [{ provider: "brave", status: "skipped" }, { provider: "exa", status: "success" }] });
  assert.equal(scoreWebEvaluation([caseFor("one")], [one]).summary.fallbackRate, 0);
  one.attempts = [{ provider: "exa", transport: "exa-mcp", status: "failed" }, { provider: "exa", transport: "exa-mcp", status: "success" }];
  assert.equal(scoreWebEvaluation([caseFor("one")], [one]).summary.fallbackRate, 0);
  const first = scoreWebEvaluation(dataset.cases, dataset.replay);
  assert.deepEqual(first, scoreWebEvaluation(dataset.cases, dataset.replay));
  assert.equal(first.summary.queries, 6);
  assert.equal(first.summary.fallbackRate, 1 / 6);
  assert.equal(first.summary.domainCompliance, 0.5);
});

test("invalid datasets and observations fail rather than produce misleading scores", () => {
  assert.throws(() => scoreWebEvaluation([], []), /nonempty/);
  assert.throws(() => scoreWebEvaluation([caseFor("one"), caseFor("one")], [runFor("one"), runFor("two")]), /unique/);
  assert.throws(() => scoreWebEvaluation([caseFor("one")], [runFor("missing")]), /missing run/);
  assert.throws(() => scoreWebEvaluation([caseFor("one")], [runFor("one", { durationMs: NaN })]), /Invalid/);
  assert.throws(() => scoreWebEvaluation([caseFor("one")], [runFor("one", { costUsd: -1 })]), /Invalid/);
  assert.throws(() => scoreWebEvaluation([{ ...caseFor("one"), domainFilter: ["example.com/path"] }], [runFor("one")]), /Invalid/);
});
