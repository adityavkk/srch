import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { resolveSecret } from "../src/lib/core/secrets.js";
import { getGeminiCookies } from "../src/lib/fetch/chrome-cookies.js";
import { createSourceContext } from "../src/sdk/config.js";

test("pre-aborted secret and cookie lookups preserve cancellation before accessing stores", async () => {
  const controller = new AbortController();
  const reason = new Error("test cancellation");
  controller.abort(reason);
  const context = createSourceContext();

  await assert.rejects(resolveSecret("exaApiKey", controller.signal), (error) => error === reason);
  await assert.rejects(context.secrets.resolve("exaApiKey", controller.signal), (error) => error === reason);
  await assert.rejects(getGeminiCookies(controller.signal), (error) => error === reason);
});

test("cancellation terminates secret-store children and does not cache an aborted lookup", async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "srch-secret-cancel-"));
  const names = ["SRCH_STATE_DIR", "SRCH_TEST_CHILD_PID", "PATH", "BRAVE_API_KEY", "GEMINI_API_KEY"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const childPids: number[] = [];
  t.after(() => {
    for (const pid of childPids) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(stateDir, { recursive: true, force: true });
  });
  process.env.SRCH_STATE_DIR = stateDir;
  process.env.PATH = `${stateDir}${delimiter}${previous.get("PATH") ?? ""}`;
  delete process.env.BRAVE_API_KEY;
  delete process.env.GEMINI_API_KEY;

  for (const scenario of [
    { command: "fnox", field: "braveApiKey" },
    { command: "op", field: "geminiApiKey" }
  ] as const) {
    const marker = join(stateDir, `${scenario.command}.pid`);
    const executable = join(stateDir, scenario.command);
    process.env.SRCH_TEST_CHILD_PID = marker;
    writeFileSync(join(stateDir, "config.json"), JSON.stringify({
      secrets: { [scenario.field]: { source: scenario.command, key: "test-reference" } }
    }));
    writeFileSync(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.SRCH_TEST_CHILD_PID, String(process.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });

    const controller = new AbortController();
    const reason = new Error(`cancel ${scenario.command}`);
    const rejected = assert.rejects(resolveSecret(scenario.field, controller.signal), (error) => error === reason);
    t.after(() => controller.abort(reason));
    const startupDeadline = Date.now() + 3_000;
    while (!existsSync(marker) && Date.now() < startupDeadline) await delay(10);
    assert.ok(existsSync(marker), "fake secret store should start");
    const pid = Number(readFileSync(marker, "utf8"));
    assert.ok(Number.isInteger(pid) && pid > 0);
    childPids.push(pid);

    controller.abort(reason);
    await rejected;
    const exitDeadline = Date.now() + 1_000;
    let alive = true;
    while (alive && Date.now() < exitDeadline) {
      try { process.kill(pid, 0); await delay(10); } catch { alive = false; }
    }
    assert.equal(alive, false, "abort must stop the spawned credential process");
    childPids.splice(childPids.indexOf(pid), 1);

    writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write('test-key-after-abort');\n`, { mode: 0o700 });
    assert.equal(await resolveSecret(scenario.field), "test-key-after-abort", "an aborted attempt must not cache a missing key");
  }
});
