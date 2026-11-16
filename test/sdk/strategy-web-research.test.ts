import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearRedirectCache } from "../../src/lib/grounding/redirects.js";
import { clearCooldowns } from "../../src/lib/grounding/transport.js";
import { coreModule, createClient, createWebResearchStrategy } from "../../src/sdk.js";
import { groundingResponse, requestUrl } from "../helpers/grounding.js";

const CREDENTIALS = JSON.stringify({ token: "host-token", projectId: "host-project" });
const ARTICLE = `<html><head><title>Requested doc</title></head><body><article><h1>Requested doc</h1>${"<p>Limits are documented here in detail. </p>".repeat(20)}</article></body></html>`;
const exaMcp = () => Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Title: Exa result\nURL: https://exa.example/result\nHighlights:\nA retrieved excerpt that is long enough to count." }] } });

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function http(route: Route, log: string[] = []): { fetch: typeof fetch } {
  return {
    fetch: (async (input, init) => {
      const url = requestUrl(input);
      log.push(new URL(url).host);
      const response = await route(url, init);
      if (!response) throw new Error(`unexpected request to ${url}`);
      return response;
    }) as typeof fetch
  };
}

function secrets(values: Record<string, string> = {}) {
  return { resolve: async (name: string) => values[name] ?? null };
}

const grounded = () => Response.json(groundingResponse({
  wrap: true, parts: ["Fact with support."],
  chunks: [{ uri: "https://docs.example/a", title: "docs.example" }],
  supports: [{ text: "Fact with support.", chunks: [0] }],
  urlMetadata: [{ retrievedUrl: "https://docs.example/page", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }]
}));

beforeEach(() => {
  clearCooldowns();
  clearRedirectCache();
});

test("research returns a grounded outcome with the answer, citations, and URL status", async () => {
  const client = createClient({ secrets: secrets({ antigravityCredentials: CREDENTIALS }), http: http((url) => (url.includes("cloudcode") ? grounded() : undefined)) });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", urls: ["https://docs.example/page"] });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.research.kind, "grounded");
  if (result.research.kind !== "grounded") return;
  assert.equal(result.research.answer.text, "Fact with support.");
  assert.deepEqual(result.research.answer.urlRetrievals, [{ url: "https://docs.example/page", status: "success" }]);
  assert.equal(result.evidence[0].source, "google");
  assert.deepEqual(result.summary.attempts.map(({ provider, status }) => `${provider}:${status}`), ["google:success"]);
});

test("without any grounding credential research degrades to labeled retrieval with fetched URLs", async () => {
  const hosts: string[] = [];
  const client = createClient({
    secrets: secrets(),
    http: http((url) => {
      if (url === "https://mcp.exa.ai/mcp") return exaMcp();
      if (url === "https://docs.example/page") return new Response(ARTICLE, { headers: { "content-type": "text/html" } });
      return undefined;
    }, hosts)
  });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", urls: ["https://docs.example/page"] });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.research.kind, "retrieval-only");
  if (result.research.kind !== "retrieval-only") return;
  assert.equal(result.research.reason.code, "auth_unavailable");
  assert.ok(result.research.reason.recovery.length > 0);
  assert.deepEqual(result.research.missing, ["grounded-answer", "claim-citations"]);
  assert.deepEqual(result.research.urlRetrievals, [{ url: "https://docs.example/page", status: "success" }]);
  assert.deepEqual(result.evidence.map((item) => item.source), ["fetch-content", "exa"]);
  assert.match(result.suggestions?.[0] ?? "", /Grounded research unavailable \(auth_unavailable\)/);
  assert.deepEqual(result.summary.attempts.map(({ provider, status }) => `${provider}:${status}`).slice(0, 3), ["google:failed", "fetch-content:success", "exa:success"]);
  assert.ok(!hosts.some((host) => host.includes("cloudcode") || host.includes("generativelanguage")), "no grounding request without credentials");
});

test("a quota failure keeps grounding attempts and still delivers retrieval results without retrying Google", async () => {
  const hosts: string[] = [];
  const client = createClient({
    secrets: secrets({ antigravityCredentials: CREDENTIALS }),
    http: http((url) => (url.includes("cloudcode") ? new Response("{}", { status: 429 }) : url === "https://mcp.exa.ai/mcp" ? exaMcp() : undefined), hosts)
  });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", providers: ["exa"] });
  assert.equal(result.kind, "success");
  if (result.kind !== "success" || result.research.kind !== "retrieval-only") return assert.fail("expected retrieval-only");
  assert.equal(result.research.reason.code, "quota_exhausted");
  assert.deepEqual(result.research.groundingAttempts.map((attempt) => `${attempt.transport}:${attempt.status === "failed" ? attempt.code : "success"}`), [
    "antigravity:quota_exhausted", "antigravity:quota_exhausted", "antigravity:quota_exhausted", "gemini-api:auth_unavailable"
  ]);
  assert.equal(hosts.filter((host) => host.includes("cloudcode")).length, 3, "one request per model; Google is not retried by the fallback");
});

test("fallback none reports the grounding failure without retrieval", async () => {
  const hosts: string[] = [];
  const client = createClient({ secrets: secrets(), http: http(() => undefined, hosts) });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", fallback: "none" });
  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "auth_unavailable");
  assert.equal(result.summary?.attempts[0]?.provider, "google");
  assert.deepEqual(hosts, []);
});

test("when retrieval also fails research returns an error that still explains the grounding failure", async () => {
  const client = createClient({ secrets: secrets(), http: http((url) => (url === "https://mcp.exa.ai/mcp" ? new Response("down", { status: 503 }) : undefined)) });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", providers: ["exa"] });
  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.equal(result.error.code, "research_unavailable");
  assert.match(result.error.message, /auth_unavailable.*retrieval fallback failed/);
  assert.equal(result.research?.reason.code, "auth_unavailable");
});

test("a stalled grounding call leaves the reserved time for retrieval", async () => {
  const client = createClient({
    secrets: secrets({ antigravityCredentials: CREDENTIALS }),
    http: http((url, init) => {
      if (url === "https://mcp.exa.ai/mcp") return exaMcp();
      if (!url.includes("cloudcode")) return undefined;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }),
    config: { modules: [coreModule], strategies: [createWebResearchStrategy({ fallbackReserveMs: 150 })] }
  });
  const started = Date.now();
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", timeoutMs: 400 });
  assert.ok(Date.now() - started < 400, "returns within the deadline");
  assert.equal(result.kind, "success");
  if (result.kind !== "success" || result.research.kind !== "retrieval-only") return assert.fail("expected retrieval-only");
  assert.equal(result.research.reason.code, "timeout");
  assert.equal(result.evidence[0].source, "exa");
});

test("caller cancellation stops research instead of degrading", async () => {
  const controller = new AbortController();
  const client = createClient({
    secrets: secrets({ antigravityCredentials: CREDENTIALS }),
    http: http((_url, init) => new Promise<Response>((_resolve, reject) => {
      controller.abort(new DOMException("stop", "AbortError"));
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }))
  });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q", signal: controller.signal });
  assert.equal(result.kind, "error");
  assert.equal(result.kind === "error" && result.error.code, "aborted");
});

test("invalid research input fails before credentials or network", async () => {
  let touched = false;
  const client = createClient({
    secrets: { resolve: async () => { touched = true; return null; } },
    http: { fetch: (async () => { touched = true; throw new Error("x"); }) as typeof fetch }
  });
  for (const request of [{ urls: ["not a url"] }, { fallback: "maybe" as "none" }, { providers: ["bing" as "exa"] }, { numResults: 0 }]) {
    const result = await client.run({ domain: "web", strategy: "web/research", query: "q", ...request });
    assert.equal(result.kind === "error" && result.error.code, "invalid_request");
  }
  assert.equal(touched, false);
});

test("the retrieval-only fallback never calls generative providers even when they are configured", async () => {
  const hosts: string[] = [];
  const client = createClient({
    secrets: secrets({ antigravityCredentials: CREDENTIALS, geminiApiKey: "g-key", perplexityApiKey: "p-key" }),
    http: http((url) => {
      if (url.includes("cloudcode")) return new Response("{}", { status: 503 });
      if (url.includes("generativelanguage")) return new Response("{}", { status: 503 });
      if (url === "https://mcp.exa.ai/mcp") return new Response("down", { status: 503 });
      if (url.includes("perplexity")) return Response.json({ choices: [{ message: { content: "generated" } }], citations: ["https://p.example"] });
      return undefined;
    }, hosts)
  });
  const result = await client.run({ domain: "web", strategy: "web/research", query: "q" });
  assert.equal(result.kind, "error");
  assert.equal(result.kind === "error" && result.error.code, "research_unavailable");
  assert.equal(hosts.filter((host) => host.includes("generativelanguage")).length, 1, "only the grounding attempt uses the Gemini API");
  assert.ok(!hosts.some((host) => host.includes("perplexity")), "Perplexity generates answers and is not a retrieval fallback");
});

test("research rejects options it cannot honor before credentials or network", async () => {
  let touched = false;
  const client = createClient({
    secrets: { resolve: async () => { touched = true; return null; } },
    http: { fetch: (async () => { touched = true; throw new Error("x"); }) as typeof fetch }
  });
  for (const option of [{ domainFilter: ["a.example"] }, { recencyFilter: "week" }, { includeContent: true }, { provider: "exa" }, { hq: true }]) {
    const result = await client.run({ domain: "web", strategy: "web/research", query: "q", ...option } as Parameters<typeof client.run>[0]);
    assert.equal(result.kind === "error" && result.error.code, "unsupported_option", JSON.stringify(option));
  }
  const generative = await client.run({ domain: "web", strategy: "web/research", query: "q", providers: ["perplexity" as "exa"] });
  assert.equal(generative.kind === "error" && generative.error.code, "invalid_request");
  assert.equal(touched, false);
});
