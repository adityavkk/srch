import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { clearSecretCache, resolveSecret } from "../src/lib/core/secrets.js";

test("credentials follow environment, configuration and store changes without restarting", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "srch-secret-freshness-"));
  const names = ["SRCH_STATE_DIR", "PATH", "EXA_API_KEY"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    clearSecretCache();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const firstDir = join(dir, "first");
  const secondDir = join(dir, "second");
  mkdirSync(firstDir);
  mkdirSync(secondDir);
  process.env.SRCH_STATE_DIR = firstDir;
  process.env.PATH = `${dir}${delimiter}${previous.get("PATH") ?? ""}`;
  const store = (value: string) => writeFileSync(join(dir, "fnox"),
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(value)});\n`, { mode: 0o700 });
  const config = (state: string, value: unknown) => writeFileSync(join(state, "config.json"), JSON.stringify(value));
  clearSecretCache();

  process.env.EXA_API_KEY = "synthetic-env-first";
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-env-first");
  process.env.EXA_API_KEY = "synthetic-env-rotated";
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-env-rotated");
  delete process.env.EXA_API_KEY;

  config(firstDir, { exaApiKey: "synthetic-config-first" });
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-config-first");
  config(firstDir, { exaApiKey: "synthetic-config-rotated" });
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-config-rotated");
  config(firstDir, {});

  store("");
  assert.equal(await resolveSecret("exaApiKey"), null);
  store("synthetic-store-first");
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-store-first", "a missing credential must not be cached");
  store("synthetic-store-rotated");
  clearSecretCache();
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-store-rotated");

  store("synthetic-other-reference");
  config(firstDir, { secrets: { exaApiKey: { source: "fnox", key: "different-reference" } } });
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-other-reference");

  store("synthetic-other-state");
  process.env.SRCH_STATE_DIR = secondDir;
  assert.equal(await resolveSecret("exaApiKey"), "synthetic-other-state", "state directories must not share credentials");

  const controller = new AbortController();
  const reason = new Error("cancel cached lookup");
  controller.abort(reason);
  await assert.rejects(resolveSecret("exaApiKey", controller.signal), (error) => error === reason);
});
