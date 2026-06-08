import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const mockImportPath = resolve(repoRoot, "test/fixtures/mock-web-fetch.mjs");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${mockImportPath}`].filter(Boolean).join(" "),
      ...env
    },
    encoding: "utf8"
  });
}

function parseJson(output: string) {
  return JSON.parse(output) as {
    ok: boolean;
    command: string[];
    data?: Record<string, any>;
    error?: { message: string };
  };
}

function withTempHome(fn: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "srch-home-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("search web can persist json output with --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-web-out-"));
  try {
    const outPath = join(dir, "web.json");
    const result = runCli(["web", "mock query", "--provider", "exa", "--hq", "--json", "--out", outPath], {
      EXA_API_KEY: "test_exa_key"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const saved = readFileSync(outPath, "utf8");
    assert.equal(saved, result.stdout);
    const payload = parseJson(saved);
    assert.equal(payload.ok, true);
    assert.equal(payload.data?.provider, "exa");
    assert.equal(payload.data?.answer, "Mock Exa answer");
    assert.equal(payload.data?.savedTo, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search fetch can persist text output with --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-fetch-out-"));
  try {
    const outPath = join(dir, "fetch.txt");
    const result = runCli(["fetch", "https://mock.local/article", "--out", outPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const saved = readFileSync(outPath, "utf8");
    assert.equal(saved, result.stdout);
    assert.match(saved, /^# /);
    assert.match(saved, /mock\.local|Mock Article|provided URL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search history can persist json output with --out", () => {
  withTempHome((home) => {
    const seed = runCli(["config", "set", "provider", "exa"], { HOME: home });
    assert.equal(seed.status, 0, seed.stderr);

    const dir = mkdtempSync(join(tmpdir(), "srch-history-out-"));
    try {
      const outPath = join(dir, "history.json");
      const result = runCli(["history", "--json", "--out", outPath], { HOME: home });
      assert.equal(result.status, 0, result.stderr);
      const saved = readFileSync(outPath, "utf8");
      const payload = parseJson(saved);
      assert.equal(payload.ok, true);
      assert.equal(payload.data?.savedTo, outPath);
      assert.equal(Array.isArray(payload.data?.entries), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("search config can persist text output with --out", () => {
  withTempHome((home) => {
    const dir = mkdtempSync(join(tmpdir(), "srch-config-out-"));
    try {
      const outPath = join(dir, "config.txt");
      const result = runCli(["config", "set", "provider", "exa", "--out", outPath], { HOME: home });
      assert.equal(result.status, 0, result.stderr);
      const saved = readFileSync(outPath, "utf8");
      assert.equal(saved, result.stdout);
      assert.match(saved, /provider=exa/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Flag-order ergonomics (GitHub issue #4) ---------------------------------
// Coding agents frequently place flags before the positional query/url/task.
// These cases lock in that `--json` (and friends) parse identically before or
// after the positional, and that malformed flags fail loudly instead of
// silently misparsing into a confusing "Missing query".

const exaEnv = { EXA_API_KEY: "test_exa_key" } as const;

test("search web parses --json before and after the query equivalently", () => {
  const flagsFirst = runCli(["web", "--json", "--provider", "exa", "--hq", "mock query"], exaEnv);
  const queryFirst = runCli(["web", "--provider", "exa", "--hq", "mock query", "--json"], exaEnv);
  assert.equal(flagsFirst.status, 0, flagsFirst.stderr);
  assert.equal(queryFirst.status, 0, queryFirst.stderr);

  const a = parseJson(flagsFirst.stdout);
  const b = parseJson(queryFirst.stdout);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.data?.answer, "Mock Exa answer");
  assert.equal(a.data?.answer, b.data?.answer);
  assert.equal(a.data?.provider, b.data?.provider);
});

test("search web accepts global flags before the command name", () => {
  const result = runCli(["--json", "web", "--provider", "exa", "--hq", "mock query"], exaEnv);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data?.provider, "exa");
  assert.equal(payload.data?.answer, "Mock Exa answer");
});

test("search web honors --out regardless of flag order", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-web-order-out-"));
  try {
    const outPath = join(dir, "web.json");
    const result = runCli(["web", "--out", outPath, "--json", "--provider", "exa", "--hq", "mock query"], exaEnv);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const payload = parseJson(readFileSync(outPath, "utf8"));
    assert.equal(payload.ok, true);
    assert.equal(payload.data?.savedTo, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search fetch parses --json before and after the url equivalently", () => {
  const flagsFirst = runCli(["fetch", "--json", "https://mock.local/article"]);
  const urlFirst = runCli(["fetch", "https://mock.local/article", "--json"]);
  assert.equal(flagsFirst.status, 0, flagsFirst.stderr);
  assert.equal(urlFirst.status, 0, urlFirst.stderr);
  const a = parseJson(flagsFirst.stdout);
  const b = parseJson(urlFirst.stdout);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.data?.url, b.data?.url);
});

test("search web reports a missing flag value instead of Missing query", () => {
  const result = runCli(["web", "--out", "--json", "mock query"], exaEnv);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Missing value for --out/);
});

test("search web rejects unknown flags with an actionable error", () => {
  const result = runCli(["web", "--bogus", "mock query", "--json"], exaEnv);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Unknown flag --bogus/);
});
