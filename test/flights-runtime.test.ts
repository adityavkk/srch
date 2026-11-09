import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { searchFlights } from "../src/lib/flights/fli.js";
import { createClient } from "../src/sdk/client.js";
import { flightsModule } from "../src/sdk/modules/flights.js";

async function withSlowFixture(run: (started: string, completed: string, release: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "srch-fli-cancellation-"));
  const previous = process.env.SRCH_FLI_FIXTURE;
  const previousPython = process.env.SRCH_FLI_PYTHON;
  const started = join(directory, "started");
  const completed = join(directory, "completed");
  const release = join(directory, "release");
  const fixture = join(directory, "slow.py");
  writeFileSync(fixture, `
import signal
import time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
def search_flights(payload):
    Path(${JSON.stringify(started)}).touch()
    deadline = time.monotonic() + 8
    while not Path(${JSON.stringify(release)}).exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    Path(${JSON.stringify(completed)}).touch()
    raise RuntimeError("fixture completed unexpectedly")
`);
  process.env.SRCH_FLI_FIXTURE = fixture;
  process.env.SRCH_FLI_PYTHON = "python3";
  try {
    await run(started, completed, release);
  } finally {
    if (previous === undefined) delete process.env.SRCH_FLI_FIXTURE;
    else process.env.SRCH_FLI_FIXTURE = previous;
    if (previousPython === undefined) delete process.env.SRCH_FLI_PYTHON;
    else process.env.SRCH_FLI_PYTHON = previousPython;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the Fli source cancels a running subprocess, including one that ignores SIGTERM", { timeout: 10_000 }, async () => {
  await withSlowFixture(async (started, completed, release) => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled flight search");
    const request = createClient({ config: { modules: [flightsModule] } }).search("fli", {
      query: "JFK CDG 2026-12-01", origin: "JFK", destination: "CDG", dateFrom: "2026-12-01", signal: controller.signal
    });
    const failure = assert.rejects(request, (error) => error === reason);
    const deadline = Date.now() + 5000;
    while (!existsSync(started) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(started), "fixture must start before the caller cancels");
    controller.abort(reason);
    await failure;
    writeFileSync(release, "");
    await delay(100);
    assert.equal(existsSync(completed), false, "cancelled child must not continue to completion");
  });
});

test("flight timeout stops the subprocess and returns TimeoutError", { timeout: 10_000 }, async () => {
  await withSlowFixture(async (_started, completed, release) => {
    await assert.rejects(searchFlights("JFK", "CDG", "2026-12-01", { timeoutMs: 100 }), { name: "TimeoutError" });
    writeFileSync(release, "");
    await delay(100);
    assert.equal(existsSync(completed), false, "timed out child must be stopped");
  });
});

for (const timeoutMs of [0, -1, 1.5, Infinity, 600_001]) {
  test(`invalid flight deadline ${timeoutMs} is rejected before spawning`, async () => {
    await assert.rejects(searchFlights("JFK", "CDG", "2026-12-01", { timeoutMs }), /timeoutMs must be an integer/);
  });
}
