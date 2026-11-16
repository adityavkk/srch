import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { repoRoot, runCli } from "./helpers/cli.js";

const imports = [join(repoRoot, "test/fixtures/mock-grounding-fetch.mjs")];
let signedIn = "";
let signedOut = "";

before(() => {
  signedIn = mkdtempSync(join(tmpdir(), "srch-pi-in-"));
  signedOut = mkdtempSync(join(tmpdir(), "srch-pi-out-"));
  writeFileSync(join(signedIn, "auth.json"), JSON.stringify({
    antigravity: { type: "oauth", access: "fixture-token", refresh: "fixture-refresh", expires: Date.now() + 3_600_000, projectId: "fixture-project" }
  }));
});
after(() => {
  rmSync(signedIn, { recursive: true, force: true });
  rmSync(signedOut, { recursive: true, force: true });
});

test("research uses the signed-in Pi account and returns a cited grounded answer", () => {
  const json = runCli(["web", "bun", "sqlite", "--research", "--json"], { PI_CODING_AGENT_DIR: signedIn }, imports);
  assert.equal(json.status, 0, json.stderr);
  const data = JSON.parse(json.stdout).data;
  assert.equal(data.research.kind, "grounded");
  assert.equal(data.research.answer.transport, "antigravity");
  assert.equal(data.research.answer.sources[0].url, "https://bun.sh/docs/api/sqlite");
  assert.deepEqual(data.results.map((row: { url: string }) => row.url), ["https://bun.sh/docs/api/sqlite"]);
  assert.doesNotMatch(json.stdout, /fixture-token|fixture-refresh/);

  const text = runCli(["web", "bun", "sqlite", "--research"], { PI_CODING_AGENT_DIR: signedIn }, imports);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Bun includes a SQLite driver\.\[1\]/);
  assert.match(text.stdout, /1\. \[bun\.sh\]\(https:\/\/bun\.sh\/docs\/api\/sqlite\)/);
  assert.match(text.stdout, /Grounded by Google Search via antigravity/);
});

test("without a login research degrades to labeled retrieval and still exits successfully", () => {
  const json = runCli(["web", "bun", "sqlite", "--research", "--json"], { PI_CODING_AGENT_DIR: signedOut }, imports);
  assert.equal(json.status, 0, json.stderr);
  const data = JSON.parse(json.stdout).data;
  assert.equal(data.research.kind, "retrieval-only");
  assert.equal(data.research.reason.code, "auth_unavailable");
  assert.equal(data.results[0].url, "https://example.com/exa");
  assert.equal(data.answer, undefined, "no generated answer is presented");

  const text = runCli(["web", "bun", "sqlite", "--research"], { PI_CODING_AGENT_DIR: signedOut }, imports);
  assert.match(text.stdout, /Grounded research unavailable \(auth_unavailable\)/);
  assert.match(text.stdout, /No answer was generated/);
});

test("a quota error degrades with the quota reason; --no-fallback fails with it", () => {
  const degraded = runCli(["web", "quota", "--research", "--json"], { PI_CODING_AGENT_DIR: signedIn }, imports);
  assert.equal(degraded.status, 0, degraded.stderr);
  assert.equal(JSON.parse(degraded.stdout).data.research.reason.code, "quota_exhausted");

  const strict = runCli(["web", "quota", "--research", "--no-fallback", "--json"], { PI_CODING_AGENT_DIR: signedIn }, imports);
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stderr).error.code, "quota_exhausted");
});

test("research flags are validated before any request", () => {
  for (const args of [
    ["--research", "--hq"], ["--research", "--domain", "bun.sh"], ["--research", "--transport", "carrier-pigeon"],
    ["--url", "https://bun.sh"], ["--thinking"], ["--providers", "google,google"], ["--providers", "exa", "--provider", "brave"]
  ]) {
    const result = runCli(["web", "q", ...args, "--json"], { PI_CODING_AGENT_DIR: signedIn }, imports);
    assert.equal(result.status, 1, `${args.join(" ")}: ${result.stdout}`);
    assert.equal(JSON.parse(result.stderr).ok, false);
  }
});

test("a configured provider order puts Google first for automatic web search", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "srch-order-"));
  try {
    const env = { SRCH_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: signedIn };
    assert.equal(runCli(["config", "set", "web-providers", "bogus"], env, imports).status, 1);
    const saved = runCli(["config", "set", "web-providers", "google,exa", "--json"], env, imports);
    assert.equal(saved.status, 0, saved.stderr);
    assert.deepEqual(JSON.parse(saved.stdout).data.config.webProviders, ["google", "exa"]);
    const search = runCli(["web", "bun", "sqlite", "--json"], env, imports);
    assert.equal(search.status, 0, search.stderr);
    assert.equal(JSON.parse(search.stdout).data.provider, "google");
    const override = runCli(["web", "bun", "sqlite", "--providers", "exa", "--json"], env, imports);
    assert.equal(JSON.parse(override.stdout).data.provider, "exa");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("inspect tools reports the Antigravity session without credential values", () => {
  const result = runCli(["inspect", "tools", "--json"], { PI_CODING_AGENT_DIR: signedIn }, imports);
  assert.equal(result.status, 0, result.stderr);
  const google = JSON.parse(result.stdout).data.providers.google;
  assert.equal(google.antigravity.account, "signed-in");
  assert.equal(google.antigravity.sessionFresh, true);
  assert.equal(google.antigravity.refresh.available, false);
  assert.doesNotMatch(result.stdout, /fixture-token|fixture-refresh/);
});
