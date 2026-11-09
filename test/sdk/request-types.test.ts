import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("built-in request types reject invalid options while custom domains remain extensible", () => {
  const result = spawnSync(process.execPath, [
    resolve("node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck",
    "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
    resolve("test/fixtures/sdk-request-types.ts")
  ], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}${result.stderr}`);
});
