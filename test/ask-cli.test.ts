import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ROOT_HELP } from "../src/lib/cli/help.js";

// Issue #6: `ask` is advertised but not implemented. Until the cross-domain
// `ask` domain ships, it must not appear in the advertised help surface, and
// invoking it must return a friendly "planned" envelope rather than the
// generic `Unknown command`.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8"
  });
}

function parseJson(output: string) {
  return JSON.parse(output) as {
    ok: boolean;
    command: string[];
    error?: { message: string; suggestions?: string[] };
  };
}

test("ask is not advertised in ROOT_HELP", () => {
  // No Domains line and no example should surface `ask` as an available command.
  assert.doesNotMatch(ROOT_HELP, /\bask\b/);
});

test("search ask returns a friendly planned-message envelope, not Unknown command", () => {
  const result = runCli(["ask", "compare bun vs node"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /planned but not yet implemented/);
  assert.doesNotMatch(result.stderr, /Unknown command/);
});

test("search ask --json returns a valid failure envelope with a planned message", () => {
  const result = runCli(["ask", "--json", "compare bun vs node"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stderr);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.command, ["ask"]);
  assert.match(payload.error?.message ?? "", /planned but not yet implemented/);
  assert.doesNotMatch(payload.error?.message ?? "", /Unknown command/);
  assert.equal(Array.isArray(payload.error?.suggestions), true);
});
