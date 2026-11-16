import assert from "node:assert/strict";
import test from "node:test";
import { callExaMcpRaw, exaMcpText } from "../src/lib/upstream/exa-mcp.js";
import { searchWithExa, searchWithExaPaid } from "../src/lib/upstream/exa.js";
import type { WebSearchContext } from "../src/lib/upstream/context.js";

const fullText = "TypeScript supports static type checking. ".repeat(20).trim();
const mcpFixture = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    content: [{
      type: "text",
      text: `Title: TypeScript documentation\nURL: https://www.typescriptlang.org/docs/\nText: ${fullText}\n---\nTitle: Handbook\nURL: https://www.typescriptlang.org/docs/handbook/intro.html\nText: Read the handbook.\n---`
    }]
  }
};

function context(fetcher: typeof fetch, key: string | null = null): WebSearchContext {
  return { http: { fetch: fetcher }, secrets: { resolve: async () => key } };
}

test("Exa MCP accepts JSON and SSE through the supplied HTTP client", async () => {
  for (const body of [JSON.stringify(mcpFixture), `event: message\ndata: ${JSON.stringify(mcpFixture)}\n\n`]) {
    const ctx = context(async (input, init) => {
      assert.equal(input, "https://mcp.exa.ai/mcp");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "web_search_exa", arguments: { query: "typescript" } }
      });
      return new Response(body);
    });
    const response = await callExaMcpRaw("web_search_exa", { query: "typescript" }, undefined, ctx);
    assert.equal(exaMcpText(response), mcpFixture.result.content[0].text);
  }
});

test("Exa MCP labels transport failures and preserves the original cause and network code", async () => {
  const connectionError = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
  for (const original of [connectionError, new TypeError("fetch failed", { cause: connectionError })]) {
    const ctx = context(async () => { throw original; });
    await assert.rejects(
      () => callExaMcpRaw("web_search_exa", { query: "typescript" }, undefined, ctx),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^Exa MCP transport error \(ECONNREFUSED\):/);
        assert.equal(error.cause, original);
        assert.equal((error as Error & { code?: string }).code, "ECONNREFUSED");
        return true;
      }
    );
  }
});

test("Exa MCP preserves abort and timeout errors", async () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    const original = new DOMException("Request stopped", name);
    const ctx = context(async () => { throw original; });
    await assert.rejects(
      () => callExaMcpRaw("web_search_exa", {}, undefined, ctx),
      (error: unknown) => {
        assert.equal(error, original);
        assert.equal((error as Error).name, name);
        return true;
      }
    );
  }
});

test("Exa MCP preserves arbitrary cancellation reasons without starting cancelled requests", async () => {
  for (const reason of [new Error("Cancelled by caller"), "stop", { cancelled: true }]) {
    const controller = new AbortController();
    controller.abort(reason);
    let httpCalls = 0;
    const ctx = context(async () => {
      httpCalls++;
      throw new Error("HTTP must not run after cancellation");
    });
    await assert.rejects(
      () => callExaMcpRaw("web_search_exa", {}, controller.signal, ctx),
      (error: unknown) => {
        assert.equal(error, reason);
        return true;
      }
    );
    assert.equal(httpCalls, 0);
  }
});

test("Exa MCP preserves cancellation while a request is in flight", async () => {
  const controller = new AbortController();
  const reason = { cancelled: "in flight" };
  const ctx = context(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    controller.abort(reason);
  }));
  await assert.rejects(
    () => callExaMcpRaw("web_search_exa", {}, controller.signal, ctx),
    (error: unknown) => {
      assert.equal(error, reason);
      return true;
    }
  );
});

test("Exa MCP keeps HTTP and parsing failures distinct from transport failures", async () => {
  await assert.rejects(
    () => callExaMcpRaw("web_search_exa", {}, undefined, context(async () => new Response("limited", { status: 429 }))),
    /^Error: Exa MCP error 429: limited$/
  );
  await assert.rejects(
    () => callExaMcpRaw("web_search_exa", {}, undefined, context(async () => new Response("not JSON or SSE"))),
    /^Error: Exa MCP returned an invalid response:/
  );
  assert.throws(() => exaMcpText({ result: { content: [] } }), /^Error: Exa MCP returned empty content$/);
});

test("Exa MCP keeps result text as snippets and optional full content", async () => {
  const ctx = context(async () => new Response(JSON.stringify(mcpFixture)));
  for (const includeContent of [false, true]) {
    const response = await searchWithExa("typescript", { includeContent }, ctx);
    assert.equal(response.results.length, 2);
    assert.equal(response.results[0].snippet, fullText.slice(0, 500));
    assert.equal(response.results[1].snippet, "Read the handbook.");
    assert.equal(response.results[0].url, "https://www.typescriptlang.org/docs/");
    assert.equal(response.inlineContent?.[0].content, includeContent ? fullText : undefined);
    assert.equal(response.inlineContent?.[1].content, includeContent ? "Read the handbook." : undefined);
  }
});

test("Exa MCP keeps highlight excerpts as snippets", async () => {
  const text = [
    "Title: URL context",
    "URL: https://ai.google.dev/gemini-api/docs/url-context",
    "Published: N/A",
    "Author: N/A",
    "Highlights:",
    "The tool can process up to 20 URLs per request.",
    "",
    "...",
    "",
    "URL content size is limited to 34MB.",
    "---",
    "Title: No excerpt",
    "URL: https://example.com/empty"
  ].join("\n");
  const ctx = context(async () => Response.json({ result: { content: [{ type: "text", text }] } }));
  const response = await searchWithExa("url context limits", {}, ctx);
  assert.deepEqual(response.results.map((item) => item.snippet), [
    "The tool can process up to 20 URLs per request.\n\n...\n\nURL content size is limited to 34MB.",
    ""
  ]);
});

test("Exa paid search keeps highlights or text as snippets and uses supplied secrets", async () => {
  const text = "Detailed documentation. ".repeat(80);
  let secretName = "";
  const ctx = context(async (input, init) => {
    assert.equal(input, "https://api.exa.ai/search");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "test-key");
    return new Response(JSON.stringify({ results: [
      { title: "Highlights", url: "https://example.com/highlights", highlights: ["First point.", "Second point."], text },
      { title: "Text", url: "https://example.com/text", text }
    ] }));
  });
  ctx.secrets.resolve = async (name) => { secretName = name; return "test-key"; };
  const response = await searchWithExaPaid("typescript", { includeContent: true }, ctx);
  assert.equal(secretName, "exaApiKey");
  assert.equal(response.results[0].snippet, "First point. Second point.");
  assert.equal(response.results[1].snippet, text.slice(0, 1000));
  assert.equal(response.inlineContent?.[1].content, text);
});

test("Exa paid search respects a missing key from the supplied resolver", async () => {
  const ctx = context(async () => { throw new Error("HTTP must not run without a key"); });
  await assert.rejects(() => searchWithExaPaid("typescript", {}, ctx), /Exa paid API requires an API key/);
});
