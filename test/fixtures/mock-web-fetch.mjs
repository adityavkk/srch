import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url === "https://api.exa.ai/answer") {
    const query = JSON.parse(init.body).query;
    if (query === "mock history failure") {
      const writeFileSync = fs.writeFileSync;
      fs.writeFileSync = (path, ...args) => {
        if (String(path).endsWith("/.search/history.json")) {
          throw Object.assign(new Error("Test history write denied"), { code: "EACCES" });
        }
        return writeFileSync(path, ...args);
      };
      syncBuiltinESMExports();
    }
    if (query === "mock provider failure") {
      return jsonResponse({ error: "Search backend unavailable" }, { status: 503 });
    }
    if (query === "mock empty query") {
      return jsonResponse({ answer: "", citations: [] });
    }
    return jsonResponse({
      answer: "Mock Exa answer",
      citations: [
        { title: "Mock Source", url: "https://example.com/mock-source" }
      ]
    });
  }

  if (url === "https://mcp.exa.ai/mcp") {
    return jsonResponse({
      jsonrpc: "2.0", id: 1,
      result: { content: [{ type: "text", text: "Title: Mock Source\nURL: https://example.com/mock-source\nText: A useful excerpt from the search result." }] }
    });
  }

  if (url === "https://mock.local/article") {
    return new Response(`<!doctype html><html><head><title>Mock Article</title></head><body><main><h1>Mock Article</h1><p>First paragraph with enough text to be extracted cleanly for testing persisted fetch output behavior in the CLI.</p><p>Second paragraph for readability extraction.</p></main></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  throw new Error(`Unexpected URL in mock web transport: ${new URL(url).origin}`);
};
