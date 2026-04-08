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
