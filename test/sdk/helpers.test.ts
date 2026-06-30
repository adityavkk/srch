import assert from "node:assert/strict";
import test from "node:test";
import { documentText } from "../../src/sdk/helpers.js";
import { documentText as documentTextPublic } from "../../src/sdk.js";

test("documentText returns content when it is a string", () => {
  assert.equal(documentText({ content: "body" }), "body");
});

test("documentText returns text for text-bearing payloads", () => {
  assert.equal(documentText({ text: "text body" }), "text body");
});

test("documentText prefers content over text", () => {
  assert.equal(documentText({ content: "canonical body", text: "text body" }), "canonical body");
});

test("documentText returns empty string for non-string content without text", () => {
  assert.equal(documentText({ content: 123 }), "");
  assert.equal(documentText({ content: { kind: "inline", text: "web body" } }), "");
});

test("documentText falls back to text when content is not a string", () => {
  assert.equal(documentText({ content: 123, text: "text body" }), "text body");
});

test("documentText returns empty string for missing or non-object payloads", () => {
  assert.equal(documentText({}), "");
  assert.equal(documentText(null), "");
  assert.equal(documentText(undefined), "");
  assert.equal(documentText("payload"), "");
  assert.equal(documentText(123), "");
});

test("documentText reads a realistic fetch document payload", () => {
  const payload = {
    kind: "document",
    url: "https://example.com/article",
    title: "Article",
    content: "hello",
    images: []
  };

  assert.equal(documentText(payload), "hello");
});

test("documentText is reachable from the public srch entry", () => {
  assert.equal(documentTextPublic({ content: "body" }), "body");
});
