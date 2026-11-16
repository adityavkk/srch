import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  ANTIGRAVITY_CREDENTIALS_SECRET,
  clearAntigravityAuthCache,
  hasAntigravityCredential,
  inspectAntigravityAuth,
  resolveAntigravityCredential,
  type AntigravityAuthDeps
} from "../src/lib/grounding/antigravity-auth.js";
import { GroundingError } from "../src/lib/grounding/errors.js";
import type { PiAntigravityRecord, RuntimeLoad } from "../src/lib/grounding/pi-runtime.js";

const NOW = 1_800_000_000_000;
let agentDir = "";

function writeAuth(record: Partial<PiAntigravityRecord> | null, extra: Record<string, unknown> = {}): string {
  const path = join(agentDir, "auth.json");
  writeFileSync(path, JSON.stringify({ other: { type: "oauth", access: "unrelated" }, ...(record ? { antigravity: { type: "oauth", ...record } } : {}), ...extra }));
  return path;
}

function runtime(refresh: (record: PiAntigravityRecord) => Promise<PiAntigravityRecord>, calls: { refresh: number } = { refresh: 0 }): RuntimeLoad {
  return {
    kind: "available",
    runtime: {
      packageDir: "/fake/pi-antigravity",
      refresh: async (record) => { calls.refresh++; return refresh(record); },
      userAgent: () => "fake-agent/1.0",
      endpoints: () => ["https://fake.example"],
      defaultProjectId: (seed) => `derived-${seed}`
    }
  };
}

function deps(load: RuntimeLoad = { kind: "unavailable", packageDir: "/missing", reason: "pi-antigravity is not installed" }): AntigravityAuthDeps {
  return { agentDir: () => agentDir, loadRuntime: async () => load, now: () => NOW };
}

const noSecrets = { resolve: async () => null };
const local = { secrets: noSecrets, allowLocalAuth: true };
const fresh: Partial<PiAntigravityRecord> = { access: "stored-token", refresh: "refresh-token", expires: NOW + 30 * 60_000, projectId: "project-1", email: "me@example.com" };
const expired: Partial<PiAntigravityRecord> = { ...fresh, expires: NOW - 1 };

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "srch-auth-"));
  clearAntigravityAuthCache();
});
afterEach(() => rmSync(agentDir, { recursive: true, force: true }));

function rejectsWith(code: string, pattern?: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof GroundingError, String(error));
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    assert.ok(error.recovery.length > 0);
    return true;
  };
}

test("an injected credential wins and is never refreshed", async () => {
  writeAuth(fresh);
  const secrets = { resolve: async (name: string) => name === ANTIGRAVITY_CREDENTIALS_SECRET ? JSON.stringify({ token: "host-token", projectId: "host-project" }) : null };
  const credential = await resolveAntigravityCredential({ secrets, allowLocalAuth: true }, {}, deps());
  assert.deepEqual(credential, { token: "host-token", projectId: "host-project", source: "injected", refreshable: false });
});

test("a malformed injected credential fails without echoing its value", async () => {
  const secrets = { resolve: async () => "token-without-json-secret-value" };
  await assert.rejects(resolveAntigravityCredential({ secrets }, {}, deps()), (error: unknown) => {
    assert.ok(error instanceof GroundingError && error.code === "auth_unavailable");
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});

test("a fresh Pi login is used as stored, without loading pi-antigravity", async () => {
  writeAuth(fresh);
  let loads = 0;
  const credential = await resolveAntigravityCredential(local, {}, { ...deps(), loadRuntime: async () => { loads++; return deps().loadRuntime(); } });
  assert.deepEqual(credential, { token: "stored-token", projectId: "project-1", source: "pi-auth", refreshable: true });
  assert.equal(loads, 0);
});

test("local auth is off for injected runtimes, and absent logins report the right cause", async () => {
  writeAuth(fresh);
  await assert.rejects(resolveAntigravityCredential({ secrets: noSecrets }, {}, deps()), rejectsWith("auth_unavailable", /SDK host/));
  assert.equal(await hasAntigravityCredential({ secrets: noSecrets }, deps()), false);
  writeAuth(null);
  await assert.rejects(resolveAntigravityCredential(local, {}, deps()), rejectsWith("auth_unavailable", /No Antigravity account/));
  assert.equal(await hasAntigravityCredential(local, deps()), false);
  writeFileSync(join(agentDir, "auth.json"), "{not json");
  await assert.rejects(resolveAntigravityCredential(local, {}, deps()), rejectsWith("auth_unavailable"));
});

test("an expired login refreshes once in memory for concurrent callers and never writes auth.json", async () => {
  const path = writeAuth(expired);
  const before = readFileSync(path, "utf8");
  const mtime = statSync(path).mtimeMs;
  const calls = { refresh: 0 };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const load = runtime(async (record) => { await gate; return { ...record, access: "refreshed-token", expires: NOW + 60 * 60_000 }; }, calls);
  const pending = Promise.all([1, 2, 3].map(() => resolveAntigravityCredential(local, {}, deps(load))));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const credentials = await pending;
  assert.equal(calls.refresh, 1);
  assert.ok(credentials.every((credential) => credential.token === "refreshed-token"));

  const cached = await resolveAntigravityCredential(local, {}, deps(load));
  assert.equal(cached.token, "refreshed-token");
  assert.equal(calls.refresh, 1, "the refreshed token is reused while valid");
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(statSync(path).mtimeMs, mtime);
});

test("forceRefresh replaces a token the service rejected", async () => {
  writeAuth(fresh);
  const calls = { refresh: 0 };
  const load = runtime(async (record) => ({ ...record, access: "replacement", expires: NOW + 60 * 60_000 }), calls);
  const credential = await resolveAntigravityCredential(local, { forceRefresh: true }, deps(load));
  assert.equal(credential.token, "replacement");
  assert.equal(calls.refresh, 1);
});

test("expired logins report auth_expired when refresh is unavailable or fails", async () => {
  writeAuth(expired);
  await assert.rejects(resolveAntigravityCredential(local, {}, deps()), rejectsWith("auth_expired", /not installed/));
  const failing = runtime(async () => { throw new Error("invalid_grant"); });
  await assert.rejects(resolveAntigravityCredential(local, {}, deps(failing)), rejectsWith("auth_expired", /invalid_grant/));
});

test("a stalled refresh honors cancellation", async () => {
  writeAuth(expired);
  const stalled = runtime(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = resolveAntigravityCredential(local, { signal: controller.signal }, deps(stalled));
  controller.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
});

test("a login without a project ID uses pi-antigravity's derivation", async () => {
  writeAuth({ ...fresh, projectId: undefined });
  const credential = await resolveAntigravityCredential(local, {}, deps(runtime(async (record) => record)));
  assert.equal(credential.projectId, "derived-me@example.com");
  await assert.rejects(resolveAntigravityCredential(local, {}, deps()), rejectsWith("auth_unavailable", /project ID/));
});

test("diagnostics report session state without credential values", async () => {
  writeAuth(expired);
  const status = await inspectAntigravityAuth(deps());
  assert.deepEqual(status, {
    account: "signed-in", sessionFresh: false, expiresInMinutes: 0,
    refresh: { available: false, packageDir: "/missing", reason: "pi-antigravity is not installed" }
  });
  assert.doesNotMatch(JSON.stringify(status), /stored-token|refresh-token/);
  writeAuth(null);
  assert.equal((await inspectAntigravityAuth(deps(runtime(async (record) => record)))).account, "missing");
});
