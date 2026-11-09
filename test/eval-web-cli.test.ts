import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/eval-web.mjs", import.meta.url));
const denyNetwork = `data:text/javascript,${encodeURIComponent("globalThis.fetch = () => { throw new Error('Unexpected network request in offline evaluation'); };")}`;

function evaluate(args: string[] = []) {
  return spawnSync(process.execPath, ["--import", denyNetwork, script, ...args], {
    encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH }
  });
}

test("evaluation replay is deterministic without network and persists the same JSON it prints", () => {
  const directory = mkdtempSync(join(tmpdir(), "srch-eval-"));
  try {
    const path = join(directory, "report.json");
    const saved = evaluate(["--out", path]);
    assert.equal(saved.status, 0, saved.stderr);
    const report = JSON.parse(saved.stdout);
    assert.equal(report.mode, "synthetic-replay");
    assert.equal(report.summary.queries, 6);
    assert.equal(report.summary.error, 1);
    assert.equal(report.summary.cost.totalUsd, null);
    assert.equal(readFileSync(path, "utf8"), saved.stdout);
    const again = evaluate();
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, saved.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evaluation rejects live-only flags without explicit live mode", () => {
  const result = evaluate(["--provider", "brave"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require --live/);
  assert.equal(result.stdout, "");
});

test("evaluation accepts explicit costs and rejects negative costs", () => {
  const directory = mkdtempSync(join(tmpdir(), "srch-eval-cost-"));
  try {
    const path = join(directory, "costs.json");
    writeFileSync(path, JSON.stringify({ "node-test": 0.02 }));
    const result = evaluate(["--costs", path]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).summary.cost, { knownUsd: 0.02, unknownRuns: 5, totalUsd: null, usdPerSuccess: null });
    writeFileSync(path, JSON.stringify({ "node-test": -1 }));
    const invalid = evaluate(["--costs", path]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /nonnegative USD/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
