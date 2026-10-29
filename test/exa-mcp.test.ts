import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnoseExaArguments, diagnoseExaReply, inspectExa } from "../src/lib/cli/exa-inspect.js";
import { isRecord } from "../src/lib/core/guards.js";
import { extractWithExa } from "../src/lib/fetch/exa.js";
import { exaCodeSearchArguments } from "../src/lib/search/code.js";
import { exaBodyChars, excerpt, parseExaFetchResults, parseExaSearchResults } from "../src/lib/upstream/exa-format.js";
import { callExaMcpRaw, exaMcpText, listExaMcpTools } from "../src/lib/upstream/exa-mcp.js";
import { mapExaSearchHits, searchWithExa } from "../src/lib/upstream/exa.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/exa-mcp");

function fixture(name: string): string {
  return readFileSync(resolve(fixtureDir, name), "utf8");
}

type McpCall = { method: string; params: Record<string, unknown> };

function sse(message: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

function toolText(text: string): unknown {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } };
}

async function withMockExa<T>(reply: (call: McpCall) => Response, run: () => Promise<T>): Promise<{ value: T; calls: McpCall[] }> {
  const realFetch = globalThis.fetch;
  const calls: McpCall[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    assert.equal(url, "https://mcp.exa.ai/mcp");
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(isRecord(body) && typeof body.method === "string" && isRecord(body.params));
    const call = { method: body.method, params: body.params };
    calls.push(call);
    return reply(call);
  };
  try {
    return { value: await run(), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("parseExaSearchResults reads the Highlights format", () => {
  const hits = parseExaSearchResults(fixture("search-highlights.txt"));
  assert.deepEqual(hits.map((hit) => hit.url), [
    "https://docs.example.com/widgetry/cache",
    "https://blog.example.org/posts/widgetry-tips",
    "https://forum.example.net/t/42"
  ]);

  const [guide, tips, thread] = hits;
  assert.equal(guide.title, "Widgetry guide: cache settings");
  assert.match(guide.text, /^## Cache settings\n\nWidgetry keeps rendered widgets in memory/);
  assert.match(guide.text, /Note: the cache is per process, so each worker warms its own copy\.$/);
  assert.equal("publishedDate" in guide, false);
  assert.equal("author" in guide, false);
  assert.equal(tips.publishedDate, "2025-03-14T00:00:00.000Z");
  assert.equal(tips.author, "Ada Example");
  assert.match(tips.text, /Title: this line is tip text, not a new hit\.$/);
  assert.equal(thread.publishedDate, "2024-11-02");
  assert.equal(thread.text, "");
});

test("parseExaSearchResults still reads the older Text format", () => {
  const hits = parseExaSearchResults(fixture("search-legacy.txt"));
  assert.equal(hits.length, 2);
  assert.equal(hits[0].text, "Widgetry keeps rendered widgets in memory for five minutes.\nSet `cache.ttl` to change the lifetime.");
  assert.equal(hits[0].publishedDate, "2025-01-20");
  assert.equal(hits[0].author, "Ada Example");
  assert.equal(hits[1].title, "Widgetry release notes");
  assert.equal(hits[1].text, "Version 2 adds named widgets.");
});

test("parseExaFetchResults splits pages and error lines", () => {
  const pages = parseExaFetchResults(fixture("fetch-batch.txt"));
  assert.equal(pages.length, 3);

  const [guide, notes, broken] = pages;
  assert.ok(guide.kind === "page" && notes.kind === "page");
  assert.equal(guide.title, "Widgetry guide: cache settings");
  assert.equal(guide.publishedDate, "2025-01-20");
  assert.equal(guide.author, "Ada Example");
  assert.match(guide.text, /# Cache settings\n\nWidgetry keeps rendered widgets in memory/);
  assert.match(guide.text, /!\[Cache flow diagram\]\(\/img\/cache-flow\.png\)$/);
  assert.equal(notes.title, "");
  assert.equal(notes.url, "https://example.net/notes/plain.txt");
  assert.equal(notes.text, "Plain notes about Widgetry caching.");
  assert.deepEqual(broken, { kind: "error", url: "https://broken.example.invalid/page", error: "CRAWL_UNKNOWN_ERROR" });
});

test("exaBodyChars counts text outside known metadata", () => {
  assert.equal(exaBodyChars("Title: A\nURL: https://a.example\nPublished: N/A\nAuthor: N/A\nHighlights:\n\n---\n"), 0);
  assert.equal(exaBodyChars("Title: A\nURL: https://a.example\nSummary: twelve chars"), "twelve chars".length);
  assert.equal(exaBodyChars("# Page\nURL: https://a.example\n\nError fetching https://b.example/x: CRAWL_NOT_FOUND"), 0);
  assert.ok(exaBodyChars(fixture("search-highlights.txt")) > 200);
});

test("excerpt flattens markdown and cuts at a word boundary", () => {
  assert.equal(
    excerpt("## Title\n\nSee the [guide](https://docs.example.com) ![x](a.png) now.\n```ts\ncode();\n```"),
    "Title See the guide now. code();"
  );
  const cut = excerpt("word ".repeat(100), 40);
  assert.ok(cut.length <= 40);
  assert.match(cut, /^word( word)*\.\.\.$/);
});

test("mapExaSearchHits fills snippets, metadata and inline text", () => {
  const hits = parseExaSearchResults(fixture("search-highlights.txt"));
  const mapped = mapExaSearchHits(hits);

  assert.equal(mapped.results.length, 3);
  assert.match(mapped.results[0].snippet, /^Cache settings Widgetry keeps rendered widgets in memory for five minutes\./);
  assert.ok(mapped.results[0].snippet.length <= 300);
  assert.equal("publishedDate" in mapped.results[0], false);
  assert.equal(mapped.results[1].publishedDate, "2025-03-14T00:00:00.000Z");
  assert.equal(mapped.results[1].author, "Ada Example");
  assert.match(mapped.results[1].snippet, /show up in the debug panel and in error messages/);
  assert.equal(mapped.results[2].snippet, "");
  assert.deepEqual(mapped.inlineContent.map((item) => item.url), [hits[0].url, hits[1].url]);
  assert.equal(mapped.inlineContent[0].content, hits[0].text);
  assert.match(mapped.answer, /Source: Widgetry guide: cache settings \(https:\/\/docs\.example\.com\/widgetry\/cache\)/);
});

test("mapExaSearchHits prefers fetched page text for inline content", () => {
  const hits = parseExaSearchResults(fixture("search-highlights.txt"));
  const mapped = mapExaSearchHits(hits, [
    { kind: "page", url: "https://docs.example.com/widgetry/cache/", title: "Guide", text: "Full guide text." },
    { kind: "page", url: "https://forum.example.net/t/42", title: "Thread", text: "Thread body." },
    { kind: "error", url: "https://blog.example.org/posts/widgetry-tips", error: "CRAWL_UNKNOWN_ERROR" }
  ]);

  const content = (url: string) => mapped.inlineContent.find((item) => item.url === url)?.content;
  assert.equal(content(hits[0].url), "Full guide text.");
  assert.equal(content(hits[1].url), hits[1].text);
  assert.equal(content(hits[2].url), "Thread body.");
  assert.match(mapped.results[0].snippet, /^Cache settings/);
  assert.equal(mapped.results[2].snippet, "Thread body.");
});

test("searchWithExa sends only the arguments tools/list lists", async () => {
  const { value, calls } = await withMockExa(() => sse(toolText(fixture("search-highlights.txt"))), () => searchWithExa("widgetry cache ttl"));

  assert.deepEqual(calls, [{
    method: "tools/call",
    params: { name: "web_search_exa", arguments: { query: "widgetry cache ttl", numResults: 5, objective: "widgetry cache ttl" } }
  }]);
  assert.equal(value.results.length, 3);
  assert.ok(value.results[0].snippet.length > 0);
  assert.equal(value.inlineContent?.length, 2);
  assert.equal(value.native.fetch, undefined);
});

test("searchWithExa passes an explicit objective", async () => {
  const { calls } = await withMockExa(
    () => sse(toolText(fixture("search-highlights.txt"))),
    () => searchWithExa("widgetry cache", { objective: "  the cache TTL setting and its default  ", numResults: 3 })
  );
  assert.deepEqual(calls[0]?.params, {
    name: "web_search_exa",
    arguments: { query: "widgetry cache", numResults: 3, objective: "the cache TTL setting and its default" }
  });
});

test("code search's MCP fallback sends objective too", () => {
  assert.deepEqual(exaCodeSearchArguments("react suspense cache", 5000), {
    query: "react suspense cache site:github.com OR site:stackoverflow.com OR programming",
    numResults: 10,
    objective: "react suspense cache"
  });
});

test("searchWithExa reads pages with web_fetch_exa when includeContent is set", async () => {
  const { value, calls } = await withMockExa(
    (call) => sse(toolText(call.params.name === "web_fetch_exa" ? fixture("fetch-batch.txt") : fixture("search-highlights.txt"))),
    () => searchWithExa("widgetry cache", { includeContent: true })
  );

  assert.deepEqual(calls.map((call) => call.params.name), ["web_search_exa", "web_fetch_exa"]);
  assert.deepEqual(calls[1]?.params.arguments, {
    urls: ["https://docs.example.com/widgetry/cache", "https://blog.example.org/posts/widgetry-tips", "https://forum.example.net/t/42"],
    maxCharacters: 10_000
  });
  assert.match(value.inlineContent?.[0]?.content ?? "", /^Widgetry guide: cache settings\n\n# Cache settings/);
  assert.ok(value.native.fetch && "response" in value.native.fetch);
});

test("searchWithExa keeps highlights when web_fetch_exa fails", async () => {
  const { value } = await withMockExa(
    (call) => call.params.name === "web_fetch_exa" ? new Response("rate limited", { status: 429 }) : sse(toolText(fixture("search-highlights.txt"))),
    () => searchWithExa("widgetry cache", { includeContent: true })
  );

  assert.equal(value.inlineContent?.[0]?.content, parseExaSearchResults(fixture("search-highlights.txt"))[0].text);
  assert.ok(value.native.fetch && "error" in value.native.fetch);
  assert.match(value.native.fetch.error, /Exa MCP error 429/);
});

test("callExaMcpRaw rejects malformed messages and surfaces JSON-RPC errors", async () => {
  await assert.rejects(
    withMockExa(() => sse({ jsonrpc: "2.0", id: 1, result: { content: "not a list" } }), () => callExaMcpRaw("web_search_exa", { query: "x" })),
    /Exa MCP returned empty content/
  );

  const { value } = await withMockExa(
    () => sse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "rate limit" } }),
    () => callExaMcpRaw("web_search_exa", { query: "x" })
  );
  assert.throws(() => exaMcpText(value), /Exa MCP error -32000: rate limit/);
});

test("listExaMcpTools reads tool names, arguments and required fields", async () => {
  const tools: unknown = JSON.parse(fixture("tools-list.json"));
  const { value, calls } = await withMockExa(() => sse(tools), () => listExaMcpTools());

  assert.deepEqual(calls, [{ method: "tools/list", params: {} }]);
  assert.deepEqual(value, [
    { name: "web_search_exa", arguments: ["query", "numResults", "objective"], required: ["query", "objective"] },
    { name: "web_fetch_exa", arguments: ["urls", "maxCharacters"], required: ["urls"] }
  ]);
});

test("extractWithExa returns page markdown with image metadata", async () => {
  const { value, calls } = await withMockExa(() => sse(toolText(fixture("fetch-batch.txt"))), () => extractWithExa("https://docs.example.com/widgetry/cache"));

  assert.deepEqual(calls[0]?.params, { name: "web_fetch_exa", arguments: { urls: ["https://docs.example.com/widgetry/cache"], maxCharacters: 50_000 } });
  assert.equal(value.error, null);
  assert.equal(value.title, "Widgetry guide: cache settings");
  assert.match(value.content, /# Cache settings/);
  assert.deepEqual(value.images, [{ alt: "Cache flow diagram", src: "https://docs.example.com/img/cache-flow.png" }]);
});

test("extractWithExa reports crawl errors as fetch errors", async () => {
  const { value } = await withMockExa(
    () => sse(toolText("Error fetching https://broken.example.invalid/page: CRAWL_UNKNOWN_ERROR")),
    () => extractWithExa("https://broken.example.invalid/page")
  );
  assert.equal(value.content, "");
  assert.equal(value.error, "Exa could not read the page: CRAWL_UNKNOWN_ERROR");
});

test("diagnoseExaArguments flags arguments that drift from tools/list", () => {
  const tools = [{ name: "web_search_exa", arguments: ["query", "numResults", "objective"], required: ["query", "objective"] }];
  assert.deepEqual(diagnoseExaArguments(tools, "web_search_exa", ["query", "numResults", "objective"]), []);
  assert.deepEqual(diagnoseExaArguments(tools, "web_search_exa", ["query", "numResults", "livecrawl"]), [
    "web_search_exa: srch sends \"livecrawl\", which tools/list does not list",
    "web_search_exa: tools/list requires \"objective\", which srch does not send"
  ]);
  assert.deepEqual(diagnoseExaArguments(tools, "web_fetch_exa", ["urls"]), ["web_fetch_exa is missing from tools/list"]);
});

test("diagnoseExaReply warns when results lose text the reply carried", () => {
  const lost = { tool: "web_search_exa", rawChars: 7053, bodyChars: 6400, items: 3, itemsWithText: 0, itemsMissingText: 3 };
  assert.deepEqual(diagnoseExaReply(lost), ["web_search_exa: 3 of 3 results have no text, but the reply has 6400 characters of text"]);
  assert.deepEqual(diagnoseExaReply({ ...lost, itemsWithText: 2, itemsMissingText: 0 }), []);
  assert.deepEqual(diagnoseExaReply({ ...lost, items: 0, itemsWithText: 0, itemsMissingText: 0 }), ["web_search_exa: reply has 6400 characters of text, but srch parsed no results"]);
});

function exaServer(searchText: string): (call: McpCall) => Response {
  return (call) => {
    if (call.method === "tools/list") return sse(JSON.parse(fixture("tools-list.json")));
    if (call.params.name === "web_fetch_exa") {
      return sse(toolText("# Widgetry guide: cache settings\nURL: https://docs.example.com/widgetry/cache\n\nWidgetry keeps rendered widgets in memory."));
    }
    return sse(toolText(searchText));
  };
}

test("inspectExa reports ok when schema and replies match srch", async () => {
  const { value, calls } = await withMockExa(exaServer(fixture("search-highlights.txt")), () => inspectExa("widgetry cache"));

  assert.equal(value.status, "ok", value.warnings.join("\n"));
  assert.deepEqual(calls.map((call) => call.method === "tools/list" ? call.method : call.params.name), ["tools/list", "web_search_exa", "web_fetch_exa"]);
  assert.equal(value.search?.items, 3);
  assert.equal(value.search?.itemsWithText, 2);
  assert.equal(value.search?.itemsMissingText, 0);
  assert.equal(value.fetch?.url, "https://docs.example.com/widgetry/cache");
  assert.equal(value.fetch?.itemsWithText, 1);
});

test("inspectExa warns when hits arrive without text the reply carried", async () => {
  const summaries = ["Widgetry keeps rendered widgets in memory.", "Name every widget."];
  const drifted = `Title: Widgetry guide\nURL: https://docs.example.com/widgetry/cache\nSummary: ${summaries[0]}\n\n---\n\nTitle: Widgetry tips\nURL: https://blog.example.org/posts/widgetry-tips\nSummary: ${summaries[1]}`;
  const { value } = await withMockExa(exaServer(drifted), () => inspectExa("widgetry cache"));

  assert.equal(value.status, "warn");
  assert.deepEqual(value.warnings, [`web_search_exa: 2 of 2 results have no text, but the reply has ${summaries.join("").length} characters of text`]);
});
