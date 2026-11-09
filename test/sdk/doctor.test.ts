import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { doctorWeb } from "../../src/sdk/doctor.js";
import { createClient } from "../../src/sdk/client.js";
import type { HttpClient, SecretResolver } from "../../src/sdk/types.js";

const missingSecrets: SecretResolver = { resolve: async () => null };
const successHttp: HttpClient = {
  async fetch() {
    return Response.json({ result: { content: [{ type: "text", text: "Title: TypeScript\nURL: https://www.typescriptlang.org/docs/\nText: TypeScript documentation" }] } });
  }
};

test("doctor verifies free Exa retrieval even when all paid credentials are missing", async () => {
  const report = await doctorWeb({ http: successHttp, secrets: missingSecrets });
  assert.equal(report.ok, true);
  assert.equal(report.probe.status, "ok");
  assert.equal(report.probe.stage, "complete");
  assert.equal(report.probe.evidenceCount, 1);
  assert.equal(report.probe.httpStatus, 200);
  assert.ok(Object.values(report.credentials).every((check) => check.status === "missing"));
  assert.ok(["node", "bun"].includes(report.runtime.name));
  assert.equal(report.runtime.nodeVersion, process.versions.node);
  assert.match(report.package.sdkEntry, /\/src\/sdk\.ts$/);
  assert.equal(report.package.name, "srch");
  assert.ok(Number.isFinite(Date.parse(report.checkedAt)));
  assert.ok(report.durationMs >= report.probe.durationMs);
  assert.ok(report.proxy.variables.every((name) => /^[A-Za-z_]+$/.test(name)));
});

test("default doctor inspects credential presence without opening saved references", async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "srch-doctor-"));
  const names = ["SRCH_STATE_DIR", "EXA_API_KEY", "BRAVE_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(stateDir, { recursive: true, force: true });
  });
  for (const name of names) delete process.env[name];
  process.env.SRCH_STATE_DIR = stateDir;
  process.env.EXA_API_KEY = "private-env-value";
  writeFileSync(join(stateDir, "config.json"), JSON.stringify({
    braveApiKey: "private-config-value",
    secrets: { geminiApiKey: { source: "op", key: "op://private-reference" } }
  }));

  const report = await doctorWeb({ http: successHttp });
  assert.equal(report.credentials.exaApiKey.status, "configured");
  assert.equal(report.credentials.braveApiKey.status, "configured");
  assert.equal(report.credentials.geminiApiKey.status, "reference");
  assert.equal(report.credentials.perplexityApiKey.status, "unchecked");
  assert.doesNotMatch(JSON.stringify(report), /private-env-value|private-config-value|private-reference/);
});

test("doctor distinguishes credential presence from a DNS outage without exposing error text", async () => {
  const secret = "synthetic-secret-do-not-print";
  const report = await doctorWeb({
    secrets: { resolve: async () => secret },
    http: { async fetch() { throw new TypeError(`Proxy https://user:${secret}@proxy.invalid failed`, { cause: { code: "ENOTFOUND" } }); } }
  });
  assert.equal(report.ok, false);
  assert.equal(report.probe.stage, "dns");
  assert.equal(report.probe.code, "ENOTFOUND");
  assert.ok(Object.values(report.credentials).every((check) => check.status === "configured"));
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret|proxy\.invalid/);
});

test("doctor separates HTTP and malformed-response failures and drops upstream bodies", async () => {
  for (const scenario of [
    { status: 403, body: "private response token", stage: "http" },
    { status: 200, body: "private response token", stage: "response" }
  ]) {
    const report = await doctorWeb({
      secrets: missingSecrets,
      http: { fetch: async () => new Response(scenario.body, { status: scenario.status }) }
    });
    assert.equal(report.ok, false);
    assert.equal(report.probe.stage, scenario.stage);
    assert.equal(report.probe.httpStatus, scenario.status);
    assert.doesNotMatch(JSON.stringify(report), /private response token/);
  }
});

test("doctor does not describe a valid empty search as verified retrieval", async () => {
  const report = await doctorWeb({
    secrets: missingSecrets,
    http: { fetch: async () => Response.json({ result: { content: [{ type: "text", text: "No results found" }] } }) }
  });
  assert.equal(report.ok, false);
  assert.equal(report.probe.status, "empty");
  assert.equal(report.probe.evidenceCount, 0);
});

test("doctor finishes when HTTP and credentials ignore cancellation", async () => {
  let requestSignal: AbortSignal | null | undefined;
  const startedAt = Date.now();
  const report = await doctorWeb({
    timeoutMs: 30,
    secrets: { resolve: () => new Promise(() => {}) },
    http: { fetch: (_input, init) => { requestSignal = init?.signal; return new Promise(() => {}); } }
  });
  assert.equal(report.ok, false);
  assert.equal(report.probe.stage, "timeout");
  assert.equal(requestSignal?.aborted, true);
  assert.ok(Object.values(report.credentials).every((check) => check.status === "timeout"));
  assert.ok(Date.now() - startedAt < 1_000, "doctor must not wait for uncooperative work");
});

test("a hanging credential resolver cannot hide a successful free probe", async () => {
  const report = await doctorWeb({
    timeoutMs: 30,
    secrets: { resolve: () => new Promise(() => {}) },
    http: successHttp
  });
  assert.equal(report.ok, true);
  assert.equal(report.probe.status, "ok");
  assert.ok(Object.values(report.credentials).every((check) => check.status === "timeout"));
});

test("doctor respects cancellation before starting work and never prints its reason", async () => {
  const abort = new AbortController();
  abort.abort("private cancellation reason");
  let calls = 0;
  const report = await doctorWeb({
    signal: abort.signal,
    secrets: { resolve: async () => { calls++; return null; } },
    http: { fetch: async () => { calls++; return new Response(); } }
  });
  assert.equal(calls, 0);
  assert.equal(report.probe.stage, "cancelled");
  assert.ok(Object.values(report.credentials).every((check) => check.status === "cancelled"));
  assert.doesNotMatch(JSON.stringify(report), /private cancellation reason/);
});

test("doctor rejects invalid deadlines before touching dependencies", async () => {
  let calls = 0;
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 60_001]) {
    await assert.rejects(doctorWeb({
      timeoutMs,
      secrets: { resolve: async () => { calls++; return null; } },
      http: { fetch: async () => { calls++; return new Response(); } }
    }), /timeoutMs/);
  }
  assert.equal(calls, 0);
});

test("SDK status does not probe or label registered sources as healthy", async () => {
  let calls = 0;
  const client = createClient({
    secrets: { resolve: async () => { calls++; return null; } },
    http: { fetch: async () => { calls++; throw new Error("status must not request HTTP"); } }
  });
  const status = await client.status();
  assert.equal(calls, 0);
  assert.equal(status.summary.healthy, 0);
  assert.equal(status.summary.untested, status.summary.total);
  assert.ok(status.sources.every((source) => source.status === "untested"));
});
