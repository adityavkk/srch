import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { clearAntigravityAuthCache, type AntigravityAuthDeps } from "../src/lib/grounding/antigravity-auth.js";
import { createAntigravityTransport, FALLBACK_ENDPOINTS, FALLBACK_USER_AGENT } from "../src/lib/grounding/antigravity-transport.js";
import { GroundingError } from "../src/lib/grounding/errors.js";
import { createGeminiApiTransport } from "../src/lib/grounding/gemini-api-transport.js";
import type { RuntimeLoad } from "../src/lib/grounding/pi-runtime.js";
import { clearRedirectCache, resolveGroundingSources } from "../src/lib/grounding/redirects.js";
import { runGrounding } from "../src/lib/grounding/run.js";
import { clearCooldowns, type GroundingContext } from "../src/lib/grounding/transport.js";
import { groundingResponse, requestUrl } from "./helpers/grounding.js";

const NOW = Date.now();
let agentDir = "";
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-token";

function auth(load: RuntimeLoad = { kind: "unavailable", packageDir: "/missing", reason: "pi-antigravity is not installed" }): AntigravityAuthDeps {
  return { agentDir: () => agentDir, loadRuntime: async () => load, now: () => NOW };
}

function piRuntime(refreshed: string[]): RuntimeLoad {
  return {
    kind: "available",
    runtime: {
      packageDir: "/fake",
      refresh: async (record) => { refreshed.push(record.refresh); return { ...record, access: "renewed-token", expires: NOW + 3_600_000 }; },
      userAgent: () => "pi-antigravity/9.9",
      endpoints: () => ["https://pi-endpoint.example"],
      defaultProjectId: () => "derived"
    }
  };
}

function signIn(): void {
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ antigravity: { type: "oauth", access: "stored-token", refresh: "refresh-token", expires: NOW + 3_600_000, projectId: "project-1" } }));
}

function context(fetcher: typeof fetch, secrets: Record<string, string> = {}): GroundingContext {
  return { http: { fetch: fetcher }, secrets: { resolve: async (name) => secrets[name] ?? null }, allowLocalAuth: true };
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "srch-run-"));
  clearAntigravityAuthCache();
  clearCooldowns();
  clearRedirectCache();
});
afterEach(() => rmSync(agentDir, { recursive: true, force: true }));

test("Antigravity sends the Cloud Code envelope with the account token and resolves redirects", async () => {
  signIn();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (input, init) => {
    const url = requestUrl(input);
    requests.push({ url, init });
    if (url === REDIRECT) return new Response(null, { status: 302, headers: { location: "https://docs.example/page" } });
    return Response.json(groundingResponse({ wrap: true, chunks: [{ uri: REDIRECT, title: "docs.example" }], supports: [{ text: "Bun ships a built-in SQLite driver.", chunks: [0] }] }));
  }) as typeof fetch;
  const transport = createAntigravityTransport({ models: ["model-a"], auth: auth(piRuntime([])) });

  const answer = await runGrounding({ query: "bun sqlite", urls: ["https://bun.sh/docs"], instruction: "official docs" }, context(fetcher), { transports: [transport] });

  const [call, redirect] = requests;
  assert.equal(call!.url, "https://pi-endpoint.example/v1internal:generateContent");
  const headers = new Headers(call!.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer stored-token");
  assert.equal(headers.get("user-agent"), "pi-antigravity/9.9");
  const body = JSON.parse(String(call!.init?.body));
  assert.equal(body.project, "project-1");
  assert.equal(body.model, "model-a");
  assert.equal(body.requestType, "agent");
  assert.match(body.requestId, /^agent\/[\w-]+\/\d+\/[\w-]+\/1$/);
  assert.deepEqual(body.request.tools, [{ googleSearch: {} }, { urlContext: {} }]);
  assert.equal(redirect!.url, REDIRECT);
  assert.equal(redirect!.init?.redirect, "manual");

  assert.equal(answer.transport, "antigravity");
  assert.equal(answer.model, "model-a");
  assert.deepEqual(answer.sources[0], { id: 0, title: "docs.example", url: "https://docs.example/page", groundingUrl: REDIRECT, resolved: true, domain: "docs.example" });
  assert.deepEqual(answer.urlRetrievals, [{ url: "https://bun.sh/docs", status: "unknown" }]);
  assert.equal(JSON.stringify(answer).includes("stored-token"), false, "credentials never appear in results");
});

test("without pi-antigravity, a fresh token still works over the built-in endpoints", async () => {
  signIn();
  const seen: string[] = [];
  const fetcher = (async (input, init) => {
    seen.push(`${requestUrl(input)} ${new Headers(init?.headers).get("user-agent")}`);
    return Response.json(groundingResponse({ wrap: true }));
  }) as typeof fetch;
  await runGrounding({ query: "q" }, context(fetcher), { transports: [createAntigravityTransport({ models: ["m"], auth: auth() })] });
  assert.deepEqual(seen, [`${FALLBACK_ENDPOINTS[0]}/v1internal:generateContent ${FALLBACK_USER_AGENT}`]);
});

test("a rejected token is refreshed once and the request retried", async () => {
  signIn();
  const refreshed: string[] = [];
  const tokens: string[] = [];
  const fetcher = (async (_input, init) => {
    const token = new Headers(init?.headers).get("authorization")!;
    tokens.push(token);
    return token === "Bearer stored-token" ? new Response("{}", { status: 401 }) : Response.json(groundingResponse({ wrap: true }));
  }) as typeof fetch;
  const answer = await runGrounding({ query: "q" }, context(fetcher), { transports: [createAntigravityTransport({ models: ["m"], auth: auth(piRuntime(refreshed)) })] });
  assert.deepEqual(tokens, ["Bearer stored-token", "Bearer renewed-token"]);
  assert.deepEqual(refreshed, ["refresh-token"]);
  assert.deepEqual(answer.attempts.map((attempt) => attempt.status === "failed" ? attempt.code : "success"), ["auth_rejected", "success"]);
});

test("a rejected token without refresh support reports auth_rejected and the refresh failure", async () => {
  signIn();
  const fetcher = (async () => new Response(JSON.stringify({ error: { message: "token revoked" } }), { status: 401 })) as typeof fetch;
  await assert.rejects(
    runGrounding({ query: "q" }, context(fetcher), { transports: [createAntigravityTransport({ models: ["m"], auth: auth() })], transport: "antigravity" }),
    (error: unknown) => error instanceof GroundingError && error.code === "auth_rejected" && /token revoked; refresh failed/.test(error.message)
  );
});

test("auto falls back from Antigravity to the Gemini API key and records both", async () => {
  signIn();
  const fetcher = (async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("cloudcode")) return new Response("{}", { status: 503 });
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "gemini-key");
    assert.doesNotMatch(url, /gemini-key/);
    return Response.json(groundingResponse());
  }) as typeof fetch;
  const transports = [createAntigravityTransport({ models: ["m"], auth: auth() }), createGeminiApiTransport({ models: ["g"] })];
  const answer = await runGrounding({ query: "q" }, context(fetcher, { geminiApiKey: "gemini-key" }), { transports });
  assert.equal(answer.transport, "gemini-api");
  assert.deepEqual(answer.attempts.map((attempt) => `${attempt.transport}:${attempt.status}`), [
    "antigravity:failed", "antigravity:failed", "antigravity:failed", "gemini-api:success"
  ]);
});

test("auto skips transports without credentials; an explicit transport reports its own error", async () => {
  const fetcher = (async () => { throw new Error("no request expected"); }) as typeof fetch;
  const transports = [createAntigravityTransport({ auth: auth() }), createGeminiApiTransport()];
  await assert.rejects(runGrounding({ query: "q" }, context(fetcher), { transports }), (error: unknown) => {
    assert.ok(error instanceof GroundingError);
    assert.equal(error.code, "auth_unavailable");
    assert.deepEqual(error.details.attempts?.map((attempt) => attempt.transport), ["antigravity", "gemini-api"]);
    return true;
  });
  await assert.rejects(runGrounding({ query: "q" }, context(fetcher), { transports, transport: "gemini-api" }),
    (error: unknown) => error instanceof GroundingError && error.code === "auth_unavailable" && /Missing Gemini API key/.test(error.message));
});

test("an uncited answer is a failed attempt and the next transport is tried", async () => {
  signIn();
  const fetcher = (async (input) => requestUrl(input).includes("cloudcode")
    ? Response.json(groundingResponse({ wrap: true, chunks: [] }))
    : Response.json(groundingResponse())) as typeof fetch;
  const transports = [createAntigravityTransport({ models: ["m"], auth: auth() }), createGeminiApiTransport({ models: ["g"] })];
  const answer = await runGrounding({ query: "q" }, context(fetcher, { geminiApiKey: "k" }), { transports });
  assert.equal(answer.transport, "gemini-api");
  assert.ok(answer.attempts.some((attempt) => attempt.status === "failed" && attempt.code === "uncited_answer"));
});

test("validation fails before credentials or network are touched", async () => {
  let touched = false;
  const ctx: GroundingContext = { http: { fetch: (async () => { touched = true; throw new Error("x"); }) as typeof fetch }, secrets: { resolve: async () => { touched = true; return null; } } };
  await assert.rejects(runGrounding({ query: "q", urls: ["ftp://x"] }, ctx), (error: unknown) => error instanceof GroundingError && error.code === "unsupported_request");
  assert.equal(touched, false);
});

test("redirect resolution only contacts Google's redirect host and keeps unresolved sources", async () => {
  const contacted: string[] = [];
  const fetcher = (async (input) => {
    const url = requestUrl(input);
    contacted.push(url);
    if (url.endsWith("/ok")) return new Response(null, { status: 302, headers: { location: "https://dest.example/a" } });
    if (url.endsWith("/bad-location")) return new Response(null, { status: 302, headers: { location: "javascript:alert(1)" } });
    if (url.endsWith("/throws")) throw new Error("network");
    return new Response("not a redirect", { status: 200 });
  }) as typeof fetch;
  const host = "https://vertexaisearch.cloud.google.com/grounding-api-redirect";
  const sources = ["ok", "bad-location", "throws", "plain"].map((suffix, id) => ({ id, title: suffix, url: `${host}/${suffix}`, groundingUrl: `${host}/${suffix}`, resolved: false }));
  sources.push({ id: 9, title: "direct", url: "http://169.254.169.254/latest", groundingUrl: "http://169.254.169.254/latest", resolved: false });
  sources.push({ id: 10, title: "lookalike", url: "https://vertexaisearch.cloud.google.com.evil.example/x", groundingUrl: "https://vertexaisearch.cloud.google.com.evil.example/x", resolved: false });

  const resolved = await resolveGroundingSources(sources, fetcher);
  assert.deepEqual(contacted.sort(), [`${host}/bad-location`, `${host}/ok`, `${host}/plain`, `${host}/throws`]);
  assert.deepEqual(resolved.map((source) => [source.url, source.resolved]), [
    ["https://dest.example/a", true],
    [`${host}/bad-location`, false],
    [`${host}/throws`, false],
    [`${host}/plain`, false],
    ["http://169.254.169.254/latest", true],
    ["https://vertexaisearch.cloud.google.com.evil.example/x", true]
  ]);
});

test("a failure from an attempted transport is reported over a later credential skip", async () => {
  signIn();
  const fetcher = (async () => new Response("{}", { status: 429 })) as typeof fetch;
  const transports = [createAntigravityTransport({ models: ["m"], auth: auth() }), createGeminiApiTransport()];
  await assert.rejects(runGrounding({ query: "q" }, context(fetcher), { transports }), (error: unknown) => {
    assert.ok(error instanceof GroundingError);
    assert.equal(error.code, "quota_exhausted");
    assert.deepEqual(error.details.attempts?.map((attempt) => attempt.status === "failed" && attempt.code), ["quota_exhausted", "auth_unavailable"]);
    return true;
  });
});
