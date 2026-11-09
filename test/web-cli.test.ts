import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repoRoot, runCli } from "./helpers/cli.js";

const imports = [join(repoRoot, "test/fixtures/mock-web-fetch.mjs")];

test("web uses a saved provider, accepts Brave, and lets an explicit provider win", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "srch-provider-"));
  try {
    const env = { SRCH_STATE_DIR: stateDir, BRAVE_API_KEY: "test-key" };
    const saved = runCli(["config", "set", "provider", "brave", "--json"], env, imports);
    assert.equal(saved.status, 0, saved.stderr);
    const selected = runCli(["web", "query", "--json"], env, imports);
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(JSON.parse(selected.stdout).data.provider, "brave");
    const override = runCli(["web", "query", "--provider", "exa", "--json"], env, imports);
    assert.equal(override.status, 0, override.stderr);
    assert.equal(JSON.parse(override.stdout).data.provider, "exa");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("web rejects invalid provider and request options instead of selecting auto", () => {
  for (const flags of [["--provider", "typo"], ["--limit", "invalid"], ["--recent", "decade"], ["--timeout-ms", "0"]]) {
    const result = runCli(["web", "query", ...flags, "--json"], {}, imports);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(JSON.parse(result.stderr).ok, false);
    assert.doesNotMatch(result.stderr, /network|No web search provider completed/);
  }
});

test("web forwards result, date and domain restrictions to a capable provider", () => {
  const result = runCli(["web", "query", "--provider", "brave", "--limit", "3", "--recent", "week", "--domain", "example.com", "--json"], { BRAVE_API_KEY: "test-key" }, imports);
  assert.equal(result.status, 0, result.stderr);
  const snippet = JSON.parse(result.stdout).data.results[0].snippet;
  assert.match(snippet, /count=3/);
  assert.match(snippet, /freshness=pw/);
  assert.match(snippet, /site:example\.com/);
});

test("web rejects unsupported restrictions and honors its total deadline", () => {
  const restricted = runCli(["web", "query", "--provider", "exa", "--recent", "week", "--json"], {}, imports);
  assert.equal(restricted.status, 1);
  assert.equal(JSON.parse(restricted.stderr).error.code, "unsupported_option");
  const timed = runCli(["web", "mock hanging provider", "--provider", "exa", "--timeout-ms", "30", "--json"], {}, imports);
  assert.equal(timed.status, 1);
  assert.equal(JSON.parse(timed.stderr).error.code, "timeout");
});

test("doctor reports a tested connection without exposing credential values", () => {
  const result = runCli(["doctor", "web", "--json"], { EXA_API_KEY: "test-secret-never-print" }, imports);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout).data;
  assert.equal(report.ok, true);
  assert.equal(report.probe.status, "ok");
  assert.equal(report.credentials.exaApiKey.status, "configured");
  assert.match(report.package.sdkEntry, /dist[/\\]sdk\.js$/);
  assert.doesNotMatch(result.stdout, /test-secret-never-print/);
});

test("doctor failure preserves structured diagnostics and can save its report", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-doctor-"));
  try {
    const out = join(dir, "report.json");
    const result = runCli(["doctor", "web", "--json", "--out", out]);
    assert.equal(result.status, 1);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.ok, false);
    assert.equal(failure.error.diagnostics.probe.status, "failed");
    assert.equal(readFileSync(out, "utf8"), result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ordinary status does not claim untested sources are healthy", () => {
  const result = runCli([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 healthy, \d+ untested/);
});

test("web preserves generated provider answers alongside their source URLs", () => {
  for (const provider of ["gemini", "perplexity"]) {
    const flags = provider === "gemini" ? ["--hq"] : [];
    const result = runCli(["web", "query", "--provider", provider, ...flags, "--json"], {
      GEMINI_API_KEY: "synthetic-gemini", PERPLEXITY_API_KEY: "synthetic-perplexity"
    }, imports);
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout).data;
    assert.equal(data.answer, `The complete ${provider === "gemini" ? "Gemini" : "Perplexity"} answer.`);
    assert.equal(data.results[0].url, `https://example.com/${provider}`);
  }
});

test("web does not report an uncited provider answer as an empty search", () => {
  const result = runCli(["web", "uncited", "--provider", "gemini", "--hq", "--json"], {
    GEMINI_API_KEY: "synthetic-gemini"
  }, imports);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr).error;
  assert.match(error.message, /without source URLs/);
  assert.doesNotMatch(result.stderr, /The complete Gemini answer/);
});
