import { readFileSync } from "node:fs";

const realFetch = globalThis.fetch;

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

function exaFixture(name) {
  return readFileSync(new URL(`./exa-mcp/${name}`, import.meta.url), "utf8");
}

// Pages served by the mocked web_fetch_exa tool. Other URLs get an error line.
const exaPages = {
  "https://mock.local/blocked": "# Blocked Article\nURL: https://mock.local/blocked\n\nThis text arrives through the Exa fallback because the page refuses plain HTTP clients."
};

function exaMcpResponse(body) {
  const request = JSON.parse(body);
  const result = { content: [{ type: "text", text: request.params.name === "web_fetch_exa"
    ? request.params.arguments.urls.map((url) => exaPages[url] ?? `Error fetching ${url}: CRAWL_NOT_FOUND`).join("\n\n")
    : exaFixture("search-highlights.txt") }] };
  return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url === "https://mcp.exa.ai/mcp") {
    return exaMcpResponse(String(init?.body ?? "{}"));
  }

  if (url === "https://mock.local/blocked" || url.startsWith("https://r.jina.ai/https://mock.local/")) {
    return new Response("Forbidden", { status: url.startsWith("https://r.jina.ai/") ? 404 : 403, statusText: "Forbidden" });
  }

  if (url.startsWith("https://generativelanguage.googleapis.com/") && String(init?.body ?? "").includes("https://mock.local/blocked")) {
    return jsonResponse({ error: { message: "mock: url context unavailable" } }, { status: 500 });
  }

  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: "Diagram showing the execution ladder from request intake to durable work." }] } }]
    });
  }

  if (url === "https://api.exa.ai/answer") {
    return jsonResponse({
      answer: "Mock Exa answer",
      citations: [
        { title: "Mock Source", url: "https://example.com/mock-source" }
      ]
    });
  }

  if (url === "https://mock.local/article") {
    return new Response(`<!doctype html><html><head><title>Mock Article</title></head><body><main><h1>Mock Article</h1><p>First paragraph with enough text to be extracted cleanly for testing persisted fetch output behavior in the CLI.</p><p>Second paragraph for readability extraction.</p></main></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  if (url === "https://mock.local/rich") {
    return new Response(`<!doctype html><html><head><title>Rich Article</title></head><body><main><article><h1>Rich Article</h1><p>This article includes a comparison table and diagram image so agents can verify structured extraction without depending on live websites.</p><table><thead><tr><th>Option</th><th>Cost</th><th>Best for</th></tr></thead><tbody><tr><td>VM</td><td>Always on</td><td>steady workloads</td></tr><tr><td>Durable Object</td><td>Idle free</td><td>per-agent workloads</td></tr></tbody></table><p>The prose after the table is long enough for Readability to keep the article body and exercise the markdown conversion path in tests.</p><table><tr><td>Override</td><td>Purpose</td></tr><tr><td>getModel()</td><td>Return the language model</td></tr></table><img src="/diagram.png" alt="execution ladder"><p>Final paragraph with additional context about the execution ladder image and the comparison table above.</p></article></main></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  if (url === "https://mock.local/diagram.png") {
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png" }
    });
  }

  return realFetch(input, init);
};
