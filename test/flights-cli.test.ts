import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, resolve, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const duffelMockPath = resolve(repoRoot, "test/fixtures/duffel-mock.cjs");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SRCH_DUFFEL_MODULE: duffelMockPath,
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

test("search flights uses Duffel live search and filters by returned cabin", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--cabin", "C", "--json"], {
    DUFFEL_ACCESS_TOKEN: "dfl_test_123"
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights"]);
  assert.equal(payload.data?.provider, "duffel-sdk");
  assert.equal(payload.data?.result.total_results, 1);
  assert.equal(payload.data?.bestOffer.id, "off_business_best");
  assert.match(payload.data?.offerSummaries[0] ?? "", /business/);
});

test("search flights search alias supports return date and sort", () => {
  const result = runCli(["flights", "search", "JFK", "DEL", "2026-05-15", "--return", "2026-05-28", "--sort", "duration", "--json"], {
    DUFFEL_ACCESS_TOKEN: "dfl_test_123"
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "search"]);
  assert.equal(payload.data?.result.search_params.returnDate, "2026-05-28");
  assert.equal(payload.data?.result.search_params.sort, "duration");
});

test("search flights resolve returns Duffel place suggestions", () => {
  const result = runCli(["flights", "resolve", "berlin", "--json"], {
    DUFFEL_ACCESS_TOKEN: "dfl_test_123"
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "resolve"]);
  assert.equal(payload.data?.locations[0].code, "BER");
});

test("search flights text output reflects Duffel provider output", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15"], {
    DUFFEL_ACCESS_TOKEN: "dfl_test_123"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Provider: Duffel/);
  assert.doesNotMatch(result.stdout, /Action handoff:/);
});

test("search flights can persist text output with --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-flights-out-"));
  try {
    const outPath = join(dir, "flights.txt");
    const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--out", outPath], {
      DUFFEL_ACCESS_TOKEN: "dfl_test_123"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const saved = readFileSync(outPath, "utf8");
    assert.match(saved, /Provider: Duffel/);
    assert.equal(saved, result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search flights can persist json output with --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-flights-json-out-"));
  try {
    const outPath = join(dir, "flights.json");
    const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--json", "--out", outPath], {
      DUFFEL_ACCESS_TOKEN: "dfl_test_123"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const saved = readFileSync(outPath, "utf8");
    assert.equal(saved, result.stdout);
    const payload = parseJson(saved);
    assert.equal(payload.ok, true);
    assert.equal(payload.data?.savedTo, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search flights returns a clear token hint when Duffel token is missing", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--json"], {
    DUFFEL_ACCESS_TOKEN: ""
  });
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Duffel requires an access token/);
  assert.match(payload.error?.message ?? "", /duffelAccessToken/);
});

test("search install flights dry-run returns a no-op plan for built-in Duffel", () => {
  const result = runCli(["install", "flights", "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["install", "flights"]);
  assert.equal(payload.data?.plan.steps.length, 0);
});

test("search install all dry-run supports built-in flights target", () => {
  const result = runCli(["install", "all", "--dry-run", "--global", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["install", "all"]);
  assert.equal(payload.data?.plan.globalInstall, true);
  assert.equal(payload.data?.plan.steps.length, 0);
});

test("search install rejects unknown targets", () => {
  const result = runCli(["install", "hotels", "--json"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Unknown install target/);
});
