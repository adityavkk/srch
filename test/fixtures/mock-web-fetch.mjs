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

  if (url === "https://mock.local/rich") {
    return new Response(`<!doctype html><html><head><title>Rich Article</title></head><body><main><article><h1>Rich Article</h1><p>This article includes a comparison table and diagram image so agents can verify structured extraction without depending on live websites.</p><table><thead><tr><th>Option</th><th>Cost</th><th>Best for</th></tr></thead><tbody><tr><td>VM</td><td>Always on</td><td>steady workloads</td></tr><tr><td>Durable Object</td><td>Idle free</td><td>per-agent workloads</td></tr></tbody></table><p>The prose after the table is long enough for Readability to keep the article body and exercise the markdown conversion path in tests.</p><img src="/diagram.png" alt="execution ladder"><p>Final paragraph with additional context about the execution ladder image and the comparison table above.</p></article></main></body></html>`, {
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
