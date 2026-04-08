import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const mockImportPath = resolve(repoRoot, "test/fixtures/mock-seats-aero-fetch.mjs");
const mockBaseUrl = "https://mock.seats.aero/partnerapi";

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SRCH_SEATS_AERO_BASE_URL: mockBaseUrl,
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
  const home = mkdtempSync(resolve(tmpdir(), "srch-home-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("search rewards-flights default search uses Seats.aero cached search", () => {
  const result = runCli(["rewards-flights", "JFK", "CDG", "--date", "2026-07-01", "--cabin", "business", "--source", "flyingblue", "--json"], {
    SEATS_AERO_API_KEY: "pro_test_123"
  });
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["rewards-flights"]);
  assert.equal(payload.data?.provider, "seats-aero");
  assert.equal(payload.data?.count, 2);
  assert.equal(payload.data?.nextCursor, 42);
  assert.equal(payload.data?.rateLimitRemaining, "997");
  assert.match(payload.data?.summaries[0] ?? "", /50,000 pts/);
});

test("search rewards-flights routes lists routes for a source", () => {
  const result = runCli(["rewards-flights", "routes", "flyingblue", "--json"], {
    SEATS_AERO_API_KEY: "pro_test_123"
  });
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["rewards-flights", "routes"]);
  assert.equal(payload.data?.count, 1);
  assert.match(payload.data?.summaries[0] ?? "", /JFK -> CDG/);
});

test("search rewards-flights trips fetches trip-level details", () => {
  const result = runCli(["rewards-flights", "trips", "avail_1", "--json"], {
    SEATS_AERO_API_KEY: "pro_test_123"
  });
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["rewards-flights", "trips"]);
  assert.equal(payload.data?.count, 1);
  assert.match(payload.data?.summaries[0] ?? "", /AF011/);
  assert.match(payload.data?.summaries[0] ?? "", /777-300ER/);
});

test("search rewards-flights text output includes award summary", () => {
  const result = runCli(["rewards-flights", "JFK", "CDG", "--date", "2026-07-01"], {
    SEATS_AERO_API_KEY: "pro_test_123"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /award results for JFK -> CDG/);
  assert.match(result.stdout, /flyingblue/);
});

test("search rewards-flights fails cleanly when API key is missing", () => {
  const result = runCli(["rewards-flights", "JFK", "CDG", "--json"], {
    SEATS_AERO_API_KEY: ""
  });
  assert.equal(result.status, 1);

  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Seats\.aero requires an API key/);
  assert.match(payload.error?.message ?? "", /seatsAeroApiKey/);
});

test("search rewards-flights auth status shows setup guidance", () => {
  withTempHome((home) => {
    const result = runCli(["rewards-flights", "auth", "status", "--json"], {
      HOME: home,
      SEATS_AERO_API_KEY: ""
    });
    assert.equal(result.status, 0, result.stderr);

    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.data?.configured, false);
    assert.match(payload.data?.instructions ?? "", /Settings -> API/);
  });
});

test("search rewards-flights auth set stores the key and clear removes it", () => {
  withTempHome((home) => {
    const setResult = runCli(["rewards-flights", "auth", "set", "pro_saved_123", "--json"], {
      HOME: home,
      SEATS_AERO_API_KEY: ""
    });
    assert.equal(setResult.status, 0, setResult.stderr);
    const setPayload = parseJson(setResult.stdout);
    assert.equal(setPayload.ok, true);
    assert.equal(setPayload.data?.config.seatsAeroApiKey, "[set]");

    const statusResult = runCli(["rewards-flights", "auth", "status", "--json"], {
      HOME: home,
      SEATS_AERO_API_KEY: ""
    });
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const statusPayload = parseJson(statusResult.stdout);
    assert.equal(statusPayload.data?.configured, true);
    assert.equal(statusPayload.data?.source, "config");

    const clearResult = runCli(["rewards-flights", "auth", "clear", "--json"], {
      HOME: home,
      SEATS_AERO_API_KEY: ""
    });
    assert.equal(clearResult.status, 0, clearResult.stderr);
    const clearPayload = parseJson(clearResult.stdout);
    assert.equal(clearPayload.ok, true);

    const afterClearResult = runCli(["rewards-flights", "auth", "status", "--json"], {
      HOME: home,
      SEATS_AERO_API_KEY: ""
    });
    assert.equal(afterClearResult.status, 0, afterClearResult.stderr);
    const afterClearPayload = parseJson(afterClearResult.stdout);
    assert.equal(afterClearPayload.data?.configured, false);
  });
});
