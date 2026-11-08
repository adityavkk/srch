import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, resolve, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { FLI_MANAGED_PYTHON, FLI_REQUIREMENT, FLI_RUNTIME_DIR } from "../src/lib/flights/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const fliFixturePath = resolve(repoRoot, "test/fixtures/fli-mock.py");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}, entryPoint = cliPath) {
  return spawnSync(process.execPath, ["--import", "tsx", entryPoint, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SRCH_FLI_FIXTURE: fliFixturePath,
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

test("search flights uses Fli SDK search and preserves requested cabin", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--cabin", "C", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights"]);
  assert.equal(payload.data?.provider, "fli-sdk");
  assert.equal(payload.data?.result.total_results, 2);
  assert.equal(payload.data?.bestOffer.id, "fli_best");
  assert.equal(payload.data?.result.search_params.requestedCabinClass, "business");
  assert.equal(payload.data?.result.search_params.requestedPassengers, 1);
  assert.match(payload.data?.offerSummaries[0] ?? "", /business/);
  assert.equal(payload.data?.result.offers.some((offer: { id: string }) => offer.id === "fli_bogus_zero"), false);
});

test("search flights search alias supports return date and sort", () => {
  const result = runCli(["flights", "search", "JFK", "DEL", "2026-05-15", "--return", "2026-05-28", "--sort", "duration", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "search"]);
  assert.equal(payload.data?.result.search_params.returnDate, "2026-05-28");
  assert.equal(payload.data?.result.search_params.sort, "duration");
  assert.equal(payload.data?.result.search_params.requestedPassengers, 1);
});

test("search flights surfaces requested passenger count", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--adults", "4", "--children", "1", "--infants", "1", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.data?.result.search_params.requestedPassengers, 6);
  assert.equal(payload.data?.result.passenger_ids.length, 6);
});

test("search flights resolve returns Fli airport suggestions", () => {
  const result = runCli(["flights", "resolve", "berlin", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "resolve"]);
  assert.equal(payload.data?.locations[0].code, "BER");
});

test("search flights text output reflects Fli provider output", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Provider: Fli/);
  assert.match(result.stdout, /Requested passengers: 1/);
  assert.match(result.stdout, /Pricing returned for: 1 passenger/);
  assert.match(result.stdout, /Dropped 1 invalid offer/);
});

test("search flights can persist text output with --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-flights-out-"));
  try {
    const outPath = join(dir, "flights.txt");
    const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--out", outPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const saved = readFileSync(outPath, "utf8");
    assert.match(saved, /Provider: Fli/);
    assert.equal(saved, result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search flights can persist json output with --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "srch-flights-json-out-"));
  try {
    const outPath = join(dir, "flights.json");
    const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--json", "--out", outPath]);
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

test("search flights returns a clear install hint when Fli is unavailable", () => {
  const result = runCli(["flights", "JFK", "DEL", "2026-05-15", "--json"], {
    SRCH_FLI_FIXTURE: "",
    SRCH_FLI_PYTHON: "python-does-not-exist"
  });
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /search install flights/);
  assert.match(payload.error?.message ?? "", /managed runtime/);
});

test("search install flights dry-run returns a plan for optional Fli install", () => {
  const result = runCli(["install", "flights", "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["install", "flights"]);
  assert.equal(payload.data?.plan.steps.length, 2);
  assert.equal(payload.data?.plan.steps[0].command, "uv");
  assert.equal(payload.data?.plan.steps[0].id, "fli-python-runtime");
  assert.deepEqual(payload.data?.plan.steps[0].args, ["venv", "--python", "3.12", "--allow-existing", FLI_RUNTIME_DIR]);
  assert.deepEqual(payload.data?.plan.steps[1].args, ["pip", "install", "--python", FLI_MANAGED_PYTHON, FLI_REQUIREMENT]);
});

test("search install all dry-run includes Fli install", () => {
  const result = runCli(["install", "all", "--dry-run", "--global", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["install", "all"]);
  assert.equal(payload.data?.plan.globalInstall, true);
  assert.equal(payload.data?.plan.steps.length, 2);
  assert.deepEqual(payload.data?.plan.steps[1].args, ["pip", "install", "--python", FLI_MANAGED_PYTHON, FLI_REQUIREMENT]);
});

test("flight install honors an explicit Python override without replacing it", () => {
  const result = runCli(["install", "flights", "--dry-run", "--json"], { SRCH_FLI_PYTHON: "custom-python" });
  assert.equal(result.status, 0, result.stderr);
  const steps = parseJson(result.stdout).data?.plan.steps;
  assert.equal(steps[0].command, "custom-python");
  assert.match(steps[0].args[1], /Python 3\.10\+/);
  assert.equal(steps[1].command, "custom-python");
  assert.deepEqual(steps[1].args, ["-m", "pip", "install", FLI_REQUIREMENT]);
});

test("flight response validation distinguishes upstream failure from empty inventory", () => {
  const result = spawnSync(process.env.SRCH_FLI_PYTHON?.trim() || "python3", [resolve(here, "flights-bridge.test.py")], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});

test("built CLI includes and executes the Python bridge", () => {
  const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.equal(
    readFileSync(resolve(repoRoot, "dist/lib/flights/fli-bridge.py"), "utf8"),
    readFileSync(resolve(repoRoot, "src/lib/flights/fli-bridge.py"), "utf8")
  );
  const result = runCli(["flights", "JFK", "CUN", "2026-11-25", "--json"], {}, resolve(repoRoot, "dist/cli.js"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseJson(result.stdout).data?.bestOffer.id, "fli_best");
});

test("search install rejects unknown targets", () => {
  const result = runCli(["install", "hotels", "--json"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Unknown install target/);
});
