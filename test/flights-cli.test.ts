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
});

test("search flights register mirrors LetsFG register example", () => {
  const result = runCli(["flights", "register", "--name", "srch-agent", "--email", "me@example.com", "--owner", "Ada", "--description", "flight tests", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "register"]);
  assert.equal(payload.data?.api_key, "trav_test_123");
  assert.equal(payload.data?.agent_name, "srch-agent");
  assert.equal(payload.data?.owner_name, "Ada");
});

test("search flights unlock mirrors LetsFG unlock flow", () => {
  const result = runCli(["flights", "unlock", "off_best", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "unlock"]);
  assert.equal(payload.data?.unlock_status, "unlocked");
  assert.equal(payload.data?.offer_id, "off_best");
});

test("search flights book accepts repeated passenger flags like LetsFG examples", () => {
  const result = runCli([
    "flights",
    "book",
    "off_best",
    "--passenger",
    '{"id":"pas_ada","given_name":"Ada","family_name":"Lovelace","born_on":"1990-12-10"}',
    "--passenger",
    '{"id":"pas_charles","given_name":"Charles","family_name":"Babbage","born_on":"1991-12-10"}',
    "--email",
    "ada@example.com",
    "--idempotency-key",
    "idem_123",
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "book"]);
  assert.equal(payload.data?.booking_reference, "PNR123");
  assert.equal(payload.data?.details.passengers.length, 2);
  assert.equal(payload.data?.details.contactEmail, "ada@example.com");
  assert.equal(payload.data?.details.idempotencyKey, "idem_123");
});

test("search flights system-info returns LetsFG runtime details", () => {
  const result = runCli(["flights", "system-info", "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.command, ["flights", "system-info"]);
  assert.equal(payload.data?.info.tier, "standard");
  assert.equal(payload.data?.info.recommended_max_browsers, 8);
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
