import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const letsfgMockPath = resolve(repoRoot, "test/fixtures/letsfg-mock.cjs");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SRCH_LETSFG_MODULE: letsfgMockPath,
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

test("search flights default search matches LetsFG README-style search flow", () => {
  const result = runCli(["flights", "GDN", "BER", "2026-03-03", "--sort", "price", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights"]);
  assert.equal(payload.data?.provider, "letsfg-sdk");
  assert.equal(payload.data?.result.origin, "GDN");
  assert.equal(payload.data?.result.destination, "BER");
  assert.equal(payload.data?.bestOffer.id, "off_best");
  assert.equal(payload.data?.offerSummaries[0], "EUR 89.00 | LO | GDN -> BER");
  assert.equal(payload.data?.handoff.tool, "letsfg");
  assert.match(payload.data?.handoff.commands[2] ?? "", /letsfg unlock off_best/);
});

test("search flights search alias accepts LetsFG-style return-trip flags", () => {
  const result = runCli(["flights", "search", "LON", "BCN", "2026-04-01", "--return", "2026-04-08", "--sort", "price", "--max-browsers", "4", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "search"]);
  assert.equal(payload.data?.result.search_params.returnDate, "2026-04-08");
  assert.equal(payload.data?.result.search_params.maxBrowsers, 4);
});

test("search flights resolve returns location candidates", () => {
  const result = runCli(["flights", "resolve", "berlin", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "resolve"]);
  assert.equal(payload.data?.locations.length, 2);
  assert.equal(payload.data?.locations[0].code, "BER");
  assert.equal(payload.data?.handoff.tool, "letsfg");
});

test("search flights text output includes letsfg handoff guidance", () => {
  const result = runCli(["flights", "GDN", "BER", "2026-03-03"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Action handoff:/);
  assert.match(result.stdout, /letsfg unlock off_best/);
});

test("search flights delegates transactional commands to native letsfg", () => {
  const result = runCli(["flights", "book", "off_best", "--json"]);
  assert.equal(result.status, 1);

  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /only supports search and resolve/);
  assert.match(payload.error?.message ?? "", /letsfg book off_best/);
});

test("search flights returns a clear install hint when LetsFG is missing", () => {
  const result = runCli(["flights", "GDN", "BER", "2026-03-03", "--json"], {
    SRCH_LETSFG_MODULE: resolve(repoRoot, "test/fixtures/does-not-exist.cjs")
  });
  assert.equal(result.status, 1);

  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /npm install letsfg/);
  assert.match(payload.error?.message ?? "", /pip install letsfg/);
});

test("search install flights dry-run returns install plan", () => {
  const result = runCli(["install", "flights", "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["install", "flights"]);
  assert.equal(payload.data?.dryRun, true);
  assert.equal(payload.data?.plan.target, "flights");
  assert.equal(payload.data?.plan.steps.length, 3);
  assert.equal(payload.data?.plan.steps[0].command, "npm");
  assert.deepEqual(payload.data?.plan.steps[0].args, ["install", "letsfg"]);
});

test("search install all dry-run supports global installs", () => {
  const result = runCli(["install", "all", "--dry-run", "--global", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["install", "all"]);
  assert.equal(payload.data?.plan.globalInstall, true);
  assert.deepEqual(payload.data?.plan.steps[0].args, ["install", "-g", "letsfg"]);
});

test("search install rejects unknown targets", () => {
  const result = runCli(["install", "hotels", "--json"]);
  assert.equal(result.status, 1);

  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error?.message ?? "", /Unknown install target/);
});
