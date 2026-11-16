import assert from "node:assert/strict";
import test from "node:test";
import { GroundingError } from "../src/lib/grounding/errors.js";
import { mergeRequestedUrls, parseGroundingResponse } from "../src/lib/grounding/parse.js";
import { citeGroundedAnswer, renderGroundedAnswer } from "../src/lib/grounding/render.js";
import { buildGenerateContentBody, validateGroundingRequest } from "../src/lib/grounding/request.js";
import type { GroundedAnswer } from "../src/lib/grounding/types.js";
import { groundingResponse } from "./helpers/grounding.js";

function sliced(parsed: ReturnType<typeof parseGroundingResponse>, index: number): string | undefined {
  const support = parsed.supports[index]!;
  return support.start === undefined ? undefined : parsed.text.slice(support.start, support.end);
}

test("direct and Antigravity-wrapped responses parse to the same grounding", () => {
  const options = {
    chunks: [{ uri: "https://a.example/one", title: "a.example" }, { uri: "https://b.example/two", title: "b.example" }],
    supports: [{ text: "Bun ships a built-in SQLite driver.", chunks: [0, 1] }]
  };
  const direct = parseGroundingResponse(groundingResponse(options));
  const wrapped = parseGroundingResponse(groundingResponse({ ...options, wrap: true }));
  assert.deepEqual(direct, wrapped);
  assert.equal(direct.text, "Bun ships a built-in SQLite driver.");
  assert.deepEqual(direct.queries, ["bun sqlite"]);
  assert.deepEqual(direct.sources.map((source) => [source.id, source.url, source.resolved]), [[0, "https://a.example/one", false], [1, "https://b.example/two", false]]);
  assert.deepEqual(direct.supports[0]!.sourceIds, [0, 1]);
  assert.equal(direct.modelVersion, "gemini-test-001");
  assert.deepEqual(direct.usage, { promptTokens: 10, outputTokens: 20, totalTokens: 30 });
  assert.equal(direct.searchEntryPoint, "<div>Google search suggestions</div>");
});

test("UTF-8 byte offsets map to verified UTF-16 positions for multibyte text", () => {
  const part = "Café ☕ setup: 日本語 docs say 🚀 launches fast. Then more.";
  const parsed = parseGroundingResponse(groundingResponse({
    parts: [part],
    supports: [{ text: "日本語 docs say 🚀 launches fast.", chunks: [0] }, { text: "Then more.", chunks: [0] }]
  }));
  assert.equal(sliced(parsed, 0), "日本語 docs say 🚀 launches fast.");
  assert.equal(sliced(parsed, 1), "Then more.");
});

test("offsets are relative to the joined answer across parts and skip thought parts", () => {
  const parsed = parseGroundingResponse(groundingResponse({
    parts: ["First part claim.", { text: "hidden reasoning", thought: true }, "Second ✓ part claim."],
    supports: [{ text: "Second ✓ part claim.", chunks: [0], partIndex: 2 }, { text: "First part claim.", chunks: [0], partIndex: 0 }]
  }));
  assert.equal(parsed.text, "First part claim.\n\nSecond ✓ part claim.");
  assert.doesNotMatch(parsed.text, /hidden reasoning/);
  assert.equal(sliced(parsed, 0), "Second ✓ part claim.");
  assert.equal(sliced(parsed, 1), "First part claim.");
});

test("wrong offsets fall back to locating the segment, and unlocatable segments carry no offsets", () => {
  const parsed = parseGroundingResponse(groundingResponse({
    parts: ["Alpha claim. Beta claim."],
    supports: [{ text: "Beta claim.", chunks: [0], offsets: "wrong" }, { text: "Beta claim.", chunks: [0], offsets: "none" }]
  }));
  assert.equal(sliced(parsed, 0), "Beta claim.");
  assert.equal(sliced(parsed, 1), "Beta claim.");

  const missing = parseGroundingResponse(groundingResponse({ parts: ["Alpha claim."], supports: [{ text: "Paraphrased claim.", chunks: [0], offsets: "wrong" }] }));
  assert.equal(missing.supports[0]!.start, undefined);
  assert.equal(missing.supports[0]!.text, "Paraphrased claim.");
});

test("non-web chunks keep original IDs and supports drop references to missing sources", () => {
  const parsed = parseGroundingResponse(groundingResponse({
    parts: ["Claim one. Claim two."],
    chunks: [{ retrievedContext: { uri: "gs://private" } }, { uri: "https://web.example/doc" }],
    supports: [{ text: "Claim one.", chunks: [0] }, { text: "Claim two.", chunks: [0, 1, 1, 7] }]
  }));
  assert.deepEqual(parsed.sources.map((source) => source.id), [1]);
  assert.equal(parsed.supports.length, 1);
  assert.deepEqual(parsed.supports[0]!.sourceIds, [1]);
});

test("snake_case proto JSON and URL context statuses are accepted", () => {
  const parsed = parseGroundingResponse({
    candidates: [{
      content: { parts: [{ text: "Answer." }] },
      grounding_metadata: { web_search_queries: ["q"], grounding_chunks: [{ web: { uri: "https://x.example" } }], grounding_supports: [] },
      url_context_metadata: { url_metadata: [
        { retrieved_url: "https://ok.example", url_retrieval_status: "URL_RETRIEVAL_STATUS_SUCCESS" },
        { retrieved_url: "https://paid.example", url_retrieval_status: "URL_RETRIEVAL_STATUS_PAYWALL" },
        { retrieved_url: "https://bad.example", url_retrieval_status: "URL_RETRIEVAL_STATUS_UNSAFE" },
        { retrieved_url: "https://err.example", url_retrieval_status: "URL_RETRIEVAL_STATUS_ERROR" },
        { retrieved_url: "https://new.example", url_retrieval_status: "SOMETHING_NEW" }
      ] }
    }]
  });
  assert.deepEqual(parsed.queries, ["q"]);
  assert.equal(parsed.sources[0]!.url, "https://x.example");
  assert.deepEqual(parsed.urlRetrievals.map((item) => item.status), ["success", "paywall", "unsafe", "failed", "unknown"]);
  assert.deepEqual(mergeRequestedUrls(["https://ok.example/", "https://never.example"], parsed.urlRetrievals).slice(-1), [{ url: "https://never.example", status: "unknown" }]);
});

test("responses without a candidate are typed invalid responses, including blocked prompts", () => {
  for (const [data, message] of [
    [{ error: { message: "model overloaded" } }, /model overloaded/],
    [{ promptFeedback: { blockReason: "SAFETY" } }, /Prompt blocked: SAFETY/],
    [{ response: { candidates: [] } }, /no candidate/],
    ["not json object", /not a JSON object/]
  ] as const) {
    assert.throws(() => parseGroundingResponse(data), (error: unknown) => error instanceof GroundingError && error.code === "invalid_response" && message.test(error.message));
  }
});

test("request bodies enable URL context only with URLs and opt into thinking explicitly", () => {
  const plain = buildGenerateContentBody({ query: " q " });
  assert.deepEqual(plain.tools, [{ googleSearch: {} }]);
  assert.deepEqual(plain.generationConfig, {});
  assert.equal(plain.contents[0]!.parts[0]!.text, "q");
  const rich = buildGenerateContentBody({ query: "q", urls: ["https://a.example/doc"], instruction: "Prefer official docs", thinking: true });
  assert.deepEqual(rich.tools, [{ googleSearch: {} }, { urlContext: {} }]);
  assert.match(rich.contents[0]!.parts[0]!.text, /https:\/\/a\.example\/doc/);
  assert.match(rich.systemInstruction.parts[0]!.text, /Prefer official docs/);
  assert.equal(rich.generationConfig.thinkingConfig?.thinkingBudget, 4096);
});

test("invalid research input is rejected before any request", () => {
  for (const request of [
    { query: " " },
    { query: "q", urls: ["file:///etc/passwd"] },
    { query: "q", urls: ["https://user:pass@example.com"] },
    { query: "q", urls: Array.from({ length: 21 }, (_, index) => `https://example.com/${index}`) },
    { query: "q", thinking: "yes" as unknown as boolean }
  ]) {
    assert.throws(() => validateGroundingRequest(request), (error: unknown) => error instanceof GroundingError && error.code === "unsupported_request");
  }
});

test("rendering numbers verified claims by source position and lists requested URL status", () => {
  const parsed = parseGroundingResponse(groundingResponse({
    parts: ["Fact A. Fact B."],
    chunks: [{ uri: "https://one.example", title: "One" }, { uri: "https://two.example", title: "Two [beta]" }],
    supports: [{ text: "Fact A.", chunks: [1] }, { text: "Fact B.", chunks: [0, 1] }, { text: "Unverified.", chunks: [0], offsets: "none" }]
  }));
  const answer: GroundedAnswer = {
    ...parsed,
    sources: parsed.sources.map((source) => ({ ...source, resolved: true })),
    urlRetrievals: [{ url: "https://two.example", status: "paywall" }],
    transport: "antigravity", model: "m", attempts: []
  };
  assert.equal(citeGroundedAnswer(answer), "Fact A.[2] Fact B.[1][2]");
  const rendered = renderGroundedAnswer(answer);
  assert.match(rendered, /2\. \[Two \\\[beta\\\]\]\(https:\/\/two\.example\)/);
  assert.match(rendered, /https:\/\/two\.example: paywall/);
  assert.match(rendered, /via antigravity \(m\)/);
});
