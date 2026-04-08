const realFetch = globalThis.fetch;

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

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

  return realFetch(input, init);
};
