import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { searchWithGeminiWeb } from "../../src/lib/upstream/gemini-web.js";
import type { WebSearchContext } from "../../src/lib/upstream/context.js";

function inputUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(typeof input === "string" || input instanceof URL ? input : input.url);
}

function json(body: unknown): Response {
  return Response.json(body);
}

test("built-in web providers use the client's HTTP transport and secret resolver", async () => {
  const requested: string[] = [];
  const resolved: string[] = [];
  const context: WebSearchContext = {
    secrets: {
      async resolve(name) {
        resolved.push(name);
        return `test-${name}`;
      }
    },
    http: {
      async fetch(input, init) {
        assert.equal(this, context.http, "HTTP methods must retain their client receiver");
        const url = inputUrl(input);
        const headers = new Headers(init?.headers);
        requested.push(url.host);
        switch (url.host) {
          case "mcp.exa.ai":
            return json({ result: { content: [{ type: "text", text: "Title: Exa MCP\nURL: https://example.com/exa-mcp\nText: Search snippet" }] } });
          case "api.exa.ai":
            assert.equal(headers.get("x-api-key"), "test-exaApiKey");
            return json({ results: [{ title: "Exa API", url: "https://example.com/exa-api", text: "API snippet" }] });
          case "api.search.brave.com":
            assert.equal(headers.get("x-subscription-token"), "test-braveApiKey");
            return json({ web: { results: [{ title: "Brave", url: "https://example.com/brave", description: "Brave snippet" }] } });
          case "generativelanguage.googleapis.com":
            assert.equal(url.searchParams.has("key"), false);
            assert.equal(headers.get("x-goog-api-key"), "test-geminiApiKey");
            return json({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: "Gemini", uri: "https://example.com/gemini" } }] } }] });
          case "api.perplexity.ai":
            assert.equal(headers.get("authorization"), "Bearer test-perplexityApiKey");
            return json({ citations: [{ title: "Perplexity", url: "https://example.com/perplexity" }] });
          default:
            throw new Error(`Unexpected test URL: ${url.origin}`);
        }
      }
    }
  };
  const client = createClient(context);
  const exaMcp = await client.search("exa", { query: "test" });
  const exaApi = await client.search("exa", { query: "test", mode: "api", numResults: 1 });
  const brave = await client.search("brave", { query: "test" });
  // Auto must consult the injected key, not the process environment or config.
  const gemini = await client.search("gemini", { query: "test", transport: "auto" });
  const perplexity = await client.search("perplexity", { query: "test" });
  assert.deepEqual([exaMcp, exaApi, brave, gemini, perplexity].map((items) => items[0]?.payload.url), [
    "https://example.com/exa-mcp", "https://example.com/exa-api", "https://example.com/brave", "https://example.com/gemini", "https://example.com/perplexity"
  ]);
  assert.deepEqual(requested, ["mcp.exa.ai", "api.exa.ai", "api.search.brave.com", "generativelanguage.googleapis.com", "api.perplexity.ai"]);
  assert.deepEqual([...new Set(resolved)].sort(), ["braveApiKey", "exaApiKey", "geminiApiKey", "perplexityApiKey"]);
});

test("default web fallback uses a client-supplied key and HTTP transport", async () => {
  const requests: string[] = [];
  const client = createClient({
    secrets: { resolve: async (name) => name === "braveApiKey" ? "test-brave-key" : null },
    http: {
      fetch: async (input, init) => {
        const host = inputUrl(input).host;
        requests.push(host);
        if (host === "mcp.exa.ai") throw new Error("test transport failure");
        assert.equal(host, "api.search.brave.com");
        assert.equal(new Headers(init?.headers).get("x-subscription-token"), "test-brave-key");
        return json({ web: { results: [{ title: "Fallback", url: "https://example.com/fallback" }] } });
      }
    }
  });
  const result = await client.run({ domain: "web", query: "test" });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.evidence[0].source, "brave");
  assert.deepEqual(result.summary.attempts.map(({ provider, status }) => ({ provider, status })), [
    { provider: "exa", status: "failed" }, { provider: "brave", status: "success" }
  ]);
  assert.deepEqual(requests, ["mcp.exa.ai", "api.search.brave.com"]);
});

test("an injected missing secret prevents a paid request", async () => {
  const resolved: string[] = [];
  const client = createClient({
    secrets: { resolve: async (name) => { resolved.push(name); return null; } },
    http: { fetch: async () => { throw new Error("HTTP must not be reached without a key"); } }
  });
  await assert.rejects(client.search("exa", { query: "test", mode: "api" }), /requires an API key/);
  await assert.rejects(client.search("brave", { query: "test" }), /missing API key/);
  await assert.rejects(client.search("gemini", { query: "test", transport: "api" }), /Missing Gemini API key/);
  await assert.rejects(client.search("perplexity", { query: "test" }), /missing API key/);
  assert.deepEqual(resolved, ["exaApiKey", "braveApiKey", "geminiApiKey", "perplexityApiKey"]);
});

test("Gemini credentials do not appear in request URLs or URL-based failure diagnostics", async () => {
  const key = "test-gemini-secret-not-for-urls";
  const client = createClient({
    secrets: { resolve: async (name) => name === "geminiApiKey" ? key : null },
    http: {
      fetch: async (input, init) => {
        assert.equal(new Headers(init?.headers).get("x-goog-api-key"), key);
        throw new Error(`Request failed: ${inputUrl(input)}`);
      }
    }
  });
  const result = await client.run({ domain: "web", query: "test", provider: "gemini", hq: true });
  assert.equal(result.kind, "error");
  assert.equal(JSON.stringify(result).includes(key), false);
});

test("Gemini browser transport distinguishes missing cookies from HTTP and network failures", async () => {
  let requests = 0;
  const context = {
    secrets: { resolve: async () => null },
    getCookies: async () => null,
    http: { fetch: async () => { requests++; return new Response("unavailable", { status: 503 }); } }
  };
  assert.equal(await searchWithGeminiWeb("test", {}, context), null);
  assert.equal(requests, 0);

  const withCookies = { ...context, getCookies: async () => ({ testCookie: "test-value" }) };
  await assert.rejects(searchWithGeminiWeb("test", {}, withCookies), /Gemini web HTTP error 503/);
  assert.equal(requests, 1);

  const failure = new TypeError("test connection failure");
  await assert.rejects(searchWithGeminiWeb("test", {}, {
    ...withCookies,
    http: { fetch: async () => { throw failure; } }
  }), (error) => error === failure);
});
