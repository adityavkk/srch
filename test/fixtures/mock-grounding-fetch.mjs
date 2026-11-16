// Offline Antigravity grounding, grounding redirects, Exa MCP, and a requested page.
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/fixture";
const ANSWER = "## Findings\n- Bun includes a SQLite driver.\n\n## Gaps\n- None";
const CLAIM = "Bun includes a SQLite driver.";
const encoder = new TextEncoder();

function grounded() {
  const startIndex = encoder.encode(ANSWER.slice(0, ANSWER.indexOf(CLAIM))).length;
  return {
    response: {
      candidates: [{
        content: { role: "model", parts: [{ text: ANSWER }] },
        groundingMetadata: {
          webSearchQueries: ["bun sqlite driver"],
          groundingChunks: [{ web: { uri: REDIRECT, title: "bun.sh" } }],
          groundingSupports: [{ segment: { text: CLAIM, startIndex, endIndex: startIndex + encoder.encode(CLAIM).length }, groundingChunkIndices: [0] }]
        }
      }],
      modelVersion: "gemini-fixture"
    }
  };
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.endsWith("/v1internal:generateContent")) {
    const authorization = new Headers(init?.headers).get("authorization");
    if (authorization !== "Bearer fixture-token") return new Response(JSON.stringify({ error: { message: "bad token" } }), { status: 401 });
    const prompt = JSON.parse(init.body).request.contents[0].parts[0].text;
    if (prompt.includes("quota")) return new Response(JSON.stringify({ error: { message: "Resource exhausted" } }), { status: 429 });
    return Response.json(grounded());
  }
  if (url === REDIRECT) return new Response(null, { status: 302, headers: { location: "https://bun.sh/docs/api/sqlite" } });
  if (url === "https://mcp.exa.ai/mcp") {
    return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Title: Exa fixture\nURL: https://example.com/exa\nHighlights:\nAn excerpt from the Exa fixture result." }] } });
  }
  throw new Error(`Unexpected URL in mock grounding transport: ${new URL(url).origin}`);
};
