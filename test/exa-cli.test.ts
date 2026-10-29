import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isRecord } from "../src/lib/core/guards.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const mockImportPath = resolve(repoRoot, "test/fixtures/mock-web-fetch.mjs");

// Runs the CLI against the fetch mock with an empty HOME, so no real config or secrets load.
function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "srch-exa-home-"));
  try {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${mockImportPath}`].filter(Boolean).join(" "),
        ...env
      },
      encoding: "utf8"
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function at(value: unknown, ...path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof key === "number") return Array.isArray(current) ? current[key] : undefined;
    return isRecord(current) ? current[key] : undefined;
  }, value);
}

function jsonOutput(output: string): unknown {
  const parsed: unknown = JSON.parse(output);
  assert.equal(at(parsed, "ok"), true, output);
  return parsed;
}

test("search web keeps Exa highlights as snippets", () => {
  const result = runCli(["web", "widgetry cache", "--provider", "exa", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonOutput(result.stdout);
  const results = at(payload, "data", "results");
  assert.ok(Array.isArray(results) && results.length === 3);
  assert.match(String(at(results, 0, "snippet")), /^Cache settings Widgetry keeps rendered widgets in memory/);
  assert.equal(at(results, 1, "publishedDate"), "2025-03-14T00:00:00.000Z");
  assert.equal(at(results, 1, "author"), "Ada Example");
  assert.match(String(at(payload, "data", "answer")), /Widgetry keeps rendered widgets in memory/);
});

test("search fetch falls back to Exa when the page fetch fails", () => {
  const result = runCli(["fetch", "https://mock.local/blocked", "--json"], { GEMINI_API_KEY: "test-key" });
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonOutput(result.stdout);
  assert.equal(at(payload, "data", "source"), "exa-fetch");
  assert.equal(at(payload, "data", "title"), "Blocked Article");
  assert.match(String(at(payload, "data", "content")), /arrives through the Exa fallback/);
});

test("search inspect exa reports ok against the current schema", () => {
  const result = runCli(["inspect", "exa", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonOutput(result.stdout);
  assert.equal(at(payload, "data", "status"), "ok", JSON.stringify(at(payload, "data", "warnings")));
  assert.equal(at(payload, "data", "search", "itemsWithText"), 2);
  assert.equal(at(payload, "data", "fetch", "itemsWithText"), 1);
});

test("search inspect exa warns when hits lose the text Exa sent", () => {
  const result = runCli(["inspect", "exa"], { MOCK_EXA_FORMAT: "summary" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Exa MCP: warn/);
  assert.match(result.stdout, /web_search_exa: 2 of 2 results have no text, but the reply has \d+ characters of text/);
});
