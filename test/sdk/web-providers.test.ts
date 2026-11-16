import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearRedirectCache } from "../../src/lib/grounding/redirects.js";
import { clearCooldowns } from "../../src/lib/grounding/transport.js";
import { coreModule, createClient, createWebDefaultStrategy, DEFAULT_WEB_PROVIDERS } from "../../src/sdk.js";
import { groundingResponse, requestUrl } from "../helpers/grounding.js";

const CREDENTIALS = JSON.stringify({ token: "host-token", projectId: "host-project" });
const grounded = () => Response.json(groundingResponse({ wrap: true, chunks: [{ uri: "https://g.example/doc", title: "g.example" }], supports: [{ text: "Bun ships a built-in SQLite driver.", chunks: [0] }] }));

function client(values: Record<string, string>, route: (url: string) => Response | undefined, hosts: string[] = [], overrides = {}) {
  return createClient({
    secrets: { resolve: async (name) => values[name] ?? null },
    http: { fetch: (async (input) => {
      const url = requestUrl(input);
      hosts.push(new URL(url).host);
      const response = route(url);
      if (!response) throw new Error(`offline: ${url}`);
      return response;
    }) as typeof fetch },
    config: { modules: [coreModule], strategies: [createWebDefaultStrategy(overrides)] }
  });
}

beforeEach(() => {
  clearCooldowns();
  clearRedirectCache();
});

test("the measured default keeps Exa first for link retrieval and Google second", () => {
  assert.deepEqual(DEFAULT_WEB_PROVIDERS, ["exa", "google", "brave", "gemini", "perplexity"]);
});

test("when Exa fails, automatic search falls back to Google with the signed-in account", async () => {
  const web = client({ antigravityCredentials: CREDENTIALS }, (url) => (url.includes("cloudcode") ? grounded() : undefined));
  const result = await web.run({ domain: "web", query: "bun sqlite" });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.evidence[0].source, "google");
  assert.equal(result.evidence[0].payload.url, "https://g.example/doc");
  assert.deepEqual(result.summary.attempts.map(({ provider, transport, status }) => `${provider}/${transport}:${status}`), ["exa/exa-mcp:failed", "google/antigravity:success"]);
});

test("Google without credentials is skipped with a clear reason, and the shared API wire is tried once", async () => {
  const hosts: string[] = [];
  const web = client({}, () => undefined, hosts);
  const result = await web.run({ domain: "web", query: "q", providers: ["google", "gemini"] });
  assert.equal(result.kind, "error");
  const attempts = result.summary?.attempts ?? [];
  assert.deepEqual(attempts.map(({ provider, transport, status }) => `${provider}/${transport}:${status}`), [
    "google/antigravity:skipped", "google/gemini-api:skipped", "gemini/gemini-web:failed"
  ]);
  assert.equal(attempts[0]?.status === "skipped" && attempts[0].reason, "no signed-in Antigravity account");
  assert.ok(!hosts.some((host) => host.includes("cloudcode")));
});

test("a request order overrides the default and an explicit Google provider reports its own error", async () => {
  const hosts: string[] = [];
  const web = client({ antigravityCredentials: CREDENTIALS }, (url) => (url.includes("cloudcode") ? grounded() : undefined), hosts);
  const ordered = await web.run({ domain: "web", query: "q", providers: ["google", "exa"] });
  assert.equal(ordered.kind === "success" && ordered.evidence[0].source, "google");
  assert.ok(!hosts.includes("mcp.exa.ai"), "Exa is not contacted after Google succeeds");

  const unauthenticated = client({}, () => undefined);
  const explicit = await unauthenticated.run({ domain: "web", query: "q", provider: "google" });
  assert.equal(explicit.kind, "error");
  assert.match(explicit.kind === "error" ? explicit.error.message : "", /google \(antigravity\): No antigravityCredentials/);
});

test("the default order can come from configuration", async () => {
  const web = client({ antigravityCredentials: CREDENTIALS }, (url) => (url.includes("cloudcode") ? grounded() : undefined), [], { defaultProviders: () => ["google", "exa"] as const });
  const result = await web.run({ domain: "web", query: "q" });
  assert.equal(result.kind === "success" && result.summary.attempts[0]?.provider, "google");
});

test("invalid provider orders fail before any request", async () => {
  const hosts: string[] = [];
  const web = client({}, () => undefined, hosts);
  for (const request of [
    { providers: [] },
    { providers: ["bing"] },
    { providers: ["exa", "exa"] },
    { providers: ["exa"], provider: "brave" as const },
    { providers: ["exa"], hq: true }
  ]) {
    const result = await web.run({ domain: "web", query: "q", ...request } as Parameters<typeof web.run>[0]);
    assert.equal(result.kind, "error", JSON.stringify(request));
    assert.match(result.kind === "error" ? result.error.code : "", /invalid_request|unsupported_option/);
  }
  assert.deepEqual(hosts, []);
});
