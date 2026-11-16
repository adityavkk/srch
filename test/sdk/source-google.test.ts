import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearCooldowns } from "../../src/lib/grounding/transport.js";
import { clearRedirectCache } from "../../src/lib/grounding/redirects.js";
import { createClient, googleSource, WebOptionsError } from "../../src/sdk.js";
import { groundingResponse, requestUrl } from "../helpers/grounding.js";
import { assertCapabilities, assertSuccessContract, assertTypedFailure, makeSourceContext } from "./source-contract.js";

const CREDENTIALS = JSON.stringify({ token: "host-token", projectId: "host-project" });

function antigravityOnly(response: () => Response): typeof fetch {
  return (async (input) => {
    assert.match(requestUrl(input), /cloudcode-pa.*v1internal:generateContent$/);
    return response();
  }) as typeof fetch;
}

const cited = () => Response.json(groundingResponse({
  wrap: true,
  parts: ["Bun has SQLite. It is fast. Unrelated."],
  chunks: [{ uri: "https://bun.sh/docs/api/sqlite", title: "bun.sh" }, { uri: "https://example.com/bench", title: "example.com" }, { uri: "https://third.example", title: "third" }],
  supports: [{ text: "Bun has SQLite.", chunks: [0] }, { text: "It is fast.", chunks: [0, 1] }]
}));

beforeEach(() => {
  clearCooldowns();
  clearRedirectCache();
});

test("google declares grounded search capabilities and both transports", () => {
  assertCapabilities(googleSource, {
    name: "google",
    domain: "web",
    capabilities: ["search", "grounded-answer", "url-context"],
    transports: ["antigravity", "gemini-api"]
  });
});

test("google maps grounding sources into web evidence with claim excerpts and the full answer", async () => {
  const ctx = { ...makeSourceContext({ secrets: { antigravityCredentials: CREDENTIALS } }), http: { fetch: antigravityOnly(cited) } };
  const evidence = await assertSuccessContract(googleSource, { query: "bun sqlite", transport: "antigravity" }, ctx);
  assert.deepEqual(evidence.map((item) => item.payload.url), ["https://bun.sh/docs/api/sqlite", "https://example.com/bench", "https://third.example"]);
  assert.deepEqual(evidence.map((item) => item.payload.snippet), ["Bun has SQLite. It is fast.", "It is fast.", ""]);
  assert.ok(evidence.every((item) => item.payload.answer === "Bun has SQLite. It is fast. Unrelated."));
  assert.ok(evidence.every((item) => item.provenance.kind === "web" && item.provenance.transport === "antigravity"));
  const grounding = evidence[0]!.payload.native.grounding;
  assert.equal(grounding.transport, "antigravity");
  assert.equal(grounding.sources.length, 3, "numResults never drops sources from the grounded answer");

  const limited = await googleSource.run({ query: "bun sqlite", transport: "antigravity", numResults: 1 }, ctx);
  assert.equal(limited.length, 1);
  assert.equal(limited[0]!.payload.native.grounding.sources.length, 3);
});

test("google rejects filters it cannot enforce before any request", async () => {
  const ctx = { ...makeSourceContext({ secrets: { antigravityCredentials: CREDENTIALS } }), http: { fetch: (async () => assert.fail("no request")) as typeof fetch } };
  for (const request of [{ domainFilter: ["bun.sh"] }, { recencyFilter: "week" as const }, { includeContent: true }]) {
    await assert.rejects(googleSource.run({ query: "q", ...request }, ctx), WebOptionsError);
  }
});

test("google failures surface as typed RunErrors through the strategy", async () => {
  const client = createClient({
    secrets: { resolve: async (name) => (name === "antigravityCredentials" ? CREDENTIALS : null) },
    http: { fetch: antigravityOnly(() => new Response("{}", { status: 429 })) }
  });
  const result = await assertTypedFailure(() => client.run({ domain: "web", query: "q", provider: "google" }), { kind: "error", domain: "web" });
  assert.equal(result.kind === "error" && result.error.code, "web_unavailable");
  assert.match(result.kind === "error" ? result.error.message : "", /google \(antigravity\)/);
});

test("plain retrieval accepts sources without answer text; research requires an answer", async () => {
  const sourcesOnly = () => Response.json(groundingResponse({ wrap: true, parts: [], chunks: [{ uri: "https://bun.sh/docs", title: "bun.sh" }] }));
  const ctx = { ...makeSourceContext({ secrets: { antigravityCredentials: CREDENTIALS } }), http: { fetch: antigravityOnly(sourcesOnly) } };
  const links = await googleSource.run({ query: "q", transport: "antigravity", requireAnswer: false }, ctx);
  assert.deepEqual(links.map((item) => item.payload.url), ["https://bun.sh/docs"]);
  await assert.rejects(googleSource.run({ query: "q", transport: "antigravity" }, ctx), /without answer text/);
});
