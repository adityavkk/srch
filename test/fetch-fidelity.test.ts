import assert from "node:assert/strict";
import { test } from "node:test";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { readResponseBytes, MAX_DOCUMENT_BYTES } from "../src/lib/fetch/body.js";
import { fetchContent } from "../src/lib/fetch/content.js";
import { runFetchCommand } from "../src/lib/cli/sdk.js";
import { createClient } from "../src/sdk/client.js";
import type { FetchEvidencePayload } from "../src/sdk/sources/fetch-content.js";
import type { WebSearchContext } from "../src/lib/upstream/context.js";

const URL = "https://document.test/article";
const PARTIAL_HTML = "<html><head><title>Partial article</title></head><body><article><p>This is a short fragment of the document that contains a useful sentence but not the rest of the article.</p></article></body></html>";

function context(fetch: typeof globalThis.fetch, resolve: WebSearchContext["secrets"]["resolve"] = async () => null): WebSearchContext {
  return { http: { fetch }, secrets: { resolve } };
}

function makePdf(pageCount: number): Uint8Array<ArrayBuffer> {
  const fontId = 3 + pageCount * 2;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(" ")}] >>`];
  for (let page = 0; page < pageCount; page++) {
    const pageId = 3 + page * 2;
    const text = `BT /F1 12 Tf 10 100 Td (Document page ${page + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

test("PDF fetch returns the document text and reports page truncation without writing files", async (t) => {
  const writeFile = t.mock.method(fsPromises, "writeFile", async () => { throw new Error("PDF retrieval must not write files"); });
  syncBuiltinESMExports();
  t.after(() => { writeFile.mock.restore(); syncBuiltinESMExports(); });
  const runtime = context(async () => new Response(makePdf(101), { headers: { "content-type": "application/pdf" } }));
  const client = createClient(runtime);
  const result = await client.run({ domain: "fetch", query: "https://document.test/report.pdf" });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  const payload = result.evidence[0].payload;
  assert.match(payload.content, /Document page 1\b/);
  assert.match(payload.content, /Document page 100\b/);
  assert.doesNotMatch(payload.content, /Document page 101\b|saved to:|Downloads/);
  assert.equal(payload.extraction.transport, "http");
  assert.equal(payload.extraction.completeness, "partial");
  assert.deepEqual(payload.extraction.pages, { total: 101, extracted: 100 });
  assert.match(payload.extraction.warnings.join(" "), /100 of 101/);
  assert.equal(writeFile.mock.callCount(), 0);
});

test("empty successful HTTP responses produce no document evidence", async () => {
  const client = createClient(context(async () => new Response("  \n", { headers: { "content-type": "text/plain" } })));
  assert.deepEqual(await client.search("fetch-content", { query: URL }), []);
});

test("partial HTML keeps its warning through SDK evidence and CLI rendering", async (t) => {
  const fetch: typeof globalThis.fetch = async (input) => String(input) === URL
    ? new Response(PARTIAL_HTML, { headers: { "content-type": "text/html" } })
    : new Response("unavailable", { status: 503 });
  const result = await createClient(context(fetch)).run({ domain: "fetch", query: URL });
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.evidence[0].payload.extraction.completeness, "partial");
  assert.match(result.evidence[0].payload.extraction.warnings[0], /incomplete/);
  t.mock.method(globalThis, "fetch", fetch);
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "offline-test-key";
  try {
    const rendered = await runFetchCommand(URL, {});
    assert.equal(rendered.kind, "ok");
    if (rendered.kind !== "ok") return;
    assert.match(rendered.text, /Warning: Extracted content appears incomplete/);
    assert.equal((rendered.data.extraction as FetchEvidencePayload["extraction"]).completeness, "partial");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("Jina fallback uses injected HTTP and identifies its transport", async () => {
  const calls: string[] = [];
  const runtime = context(async (input) => {
    calls.push(String(input));
    return String(input).startsWith("https://r.jina.ai/")
      ? new Response(`Markdown Content:\n# Retrieved article\n${"Article body. ".repeat(20)}`)
      : new Response("unavailable", { status: 503 });
  }, async () => { throw new Error("Jina success must not resolve Gemini secrets"); });
  const [item] = await createClient(runtime).search("fetch-content", { query: URL });
  assert.equal(item.provenance.kind === "web" && item.provenance.transport, "jina");
  assert.equal(item.payload.extraction.generated, false);
  assert.equal(item.payload.extraction.completeness, "unknown");
  assert.deepEqual(calls, [URL, `https://r.jina.ai/${URL}`]);
});

test("Gemini fallback uses injected HTTP and secret and labels generated text", async () => {
  const calls: string[] = [];
  const secretCalls: string[] = [];
  const controller = new AbortController();
  const runtime = context(async (input, init) => {
    calls.push(String(input));
    if (!String(input).includes("generativelanguage")) return new Response("unavailable", { status: 503 });
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "injected-key");
    assert.ok(!String(input).includes("key="));
    assert.ok(init?.signal);
    return Response.json({ candidates: [{ content: { parts: [{ text: `# Generated article\n${"Generated body. ".repeat(10)}` }] } }] });
  }, async (name, signal) => {
    secretCalls.push(name);
    assert.equal(signal, controller.signal);
    return "injected-key";
  });
  const [item] = await createClient(runtime).search("fetch-content", { query: URL, signal: controller.signal });
  assert.equal(item.provenance.kind === "web" && item.provenance.transport, "gemini");
  assert.equal(item.payload.extraction.generated, true);
  assert.equal(item.payload.extraction.completeness, "unknown");
  assert.match(item.payload.extraction.warnings[0], /generated by Gemini/);
  assert.equal(calls.length, 3);
  assert.deepEqual(secretCalls, ["geminiApiKey"]);
});

test("GitHub fetch uses injected HTTP and optional token without local tools", async () => {
  const calls: string[] = [];
  const runtime = context(async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    return new Response("Repository document text");
  }, async (name) => name === "githubToken" ? "test-token" : null);
  const [item] = await createClient(runtime).search("fetch-content", { query: "https://github.com/example/repo/blob/main/docs/file.md" });
  assert.deepEqual(calls, ["https://api.github.com/repos/example/repo/contents/docs/file.md?ref=main"]);
  assert.equal(item.payload.content, "Repository document text");
  assert.equal(item.provenance.kind === "web" && item.provenance.transport, "github-api");
  assert.equal(item.payload.extraction.generated, false);
});

test("GitHub PDF blobs are extracted as text with PDF page metadata", async () => {
  const runtime = context(async () => new Response(makePdf(1), { headers: { "content-type": "application/pdf" } }));
  const [item] = await createClient(runtime).search("fetch-content", { query: "https://github.com/example/repo/blob/main/report.pdf" });
  assert.match(item.payload.content, /Document page 1/);
  assert.doesNotMatch(item.payload.content, /%PDF-1.4/);
  assert.equal(item.payload.extraction.transport, "github-api");
  assert.deepEqual(item.payload.extraction.pages, { total: 1, extracted: 1 });
});

test("GitHub blobs reject recognized binary formats instead of claiming decoded text is complete", async (t) => {
  for (const [path, contentType, body] of [
    ["image.png", "application/octet-stream", new Uint8Array([137, 80, 78, 71])],
    ["download", "audio/mpeg", new Uint8Array([255, 251])],
    ["archive.zip", "application/octet-stream", new Uint8Array([80, 75])],
    ["unknown.bin", "application/octet-stream", new Uint8Array([1, 0, 2])]
  ] as const) {
    await t.test(path, async () => {
      let calls = 0;
      const runtime = context(async () => { calls++; return new Response(body, { headers: { "content-type": contentType } }); });
      const result = await createClient(runtime).run({ domain: "fetch", query: `https://github.com/example/repo/blob/main/${path}` });
      assert.equal(result.kind, "error");
      if (result.kind === "error") assert.match(result.error.message, /Unsupported binary document/);
      assert.equal(calls, 1);
    });
  }
});

test("pre-cancelled fetch performs no HTTP or secret lookup", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled before retrieval"));
  const runtime = context(async () => { throw new Error("unexpected HTTP"); }, async () => { throw new Error("unexpected secret lookup"); });
  await assert.rejects(fetchContent(URL, controller.signal, runtime), /cancelled before retrieval/);
});

test("cancellation stops fallback after each transport, including GitHub", async (t) => {
  for (const cancelledStage of ["http", "jina", "gemini", "github"] as const) {
    await t.test(cancelledStage, async () => {
      const controller = new AbortController();
      const calls: string[] = [];
      const runtime = context(async (input) => {
        const url = String(input);
        const stage = url.includes("api.github.com") ? "github" : url.includes("generativelanguage") ? "gemini" : url.includes("r.jina.ai") ? "jina" : "http";
        calls.push(stage);
        if (stage === cancelledStage) controller.abort(new Error(`cancelled ${stage}`));
        return new Response("unavailable", { status: 503 });
      }, async () => "test-key");
      const url = cancelledStage === "github" ? "https://github.com/example/repo/blob/main/file.md" : URL;
      await assert.rejects(fetchContent(url, controller.signal, runtime), new RegExp(`cancelled ${cancelledStage}`));
      assert.equal(calls.at(-1), cancelledStage);
      assert.equal(calls.length, cancelledStage === "github" ? 1 : ["http", "jina", "gemini"].indexOf(cancelledStage) + 1);
    });
  }
});

test("bounded reader rejects declared and streamed excess and cancels the body", async () => {
  let cancelled = 0;
  const declared = new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-length": "5" } });
  await assert.rejects(readResponseBytes(declared, undefined, 4), /Response too large/);
  const streamed = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(2)); },
    cancel() { cancelled++; }
  }));
  await assert.rejects(readResponseBytes(streamed, undefined, 4), /Response too large/);
  assert.equal(cancelled, 2);
});

test("size errors and GitHub HTTP failures do not wait for stalled stream cleanup", { timeout: 1000 }, async () => {
  const never = () => new Promise<void>(() => {});
  const declared = new Response(new ReadableStream({ cancel: never }), { headers: { "content-length": "5" } });
  await assert.rejects(readResponseBytes(declared, undefined, 4), /Response too large/);
  const streamed = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5)); },
    cancel: never
  }));
  await assert.rejects(readResponseBytes(streamed, undefined, 4), /Response too large/);
  const runtime = context(async (input) => String(input).includes("api.github.com")
    ? new Response(new ReadableStream({ cancel: never }), { status: 503 })
    : new Response("HTTP fallback text", { headers: { "content-type": "text/plain" } }));
  const result = await fetchContent("https://github.com/example/repo/blob/main/file.md", undefined, runtime);
  assert.equal(result.content, "HTTP fallback text");
});

test("body cancellation interrupts an injected stream that ignores fetch signals", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const pending = readResponseBytes(response, controller.signal);
  controller.abort(new Error("cancelled while reading"));
  await assert.rejects(pending, /cancelled while reading/);
  assert.equal(cancelled, true);
});

test("all HTTP document transports reject oversized bodies without further fallback", async (t) => {
  for (const oversizedStage of ["http", "jina", "gemini", "github"] as const) {
    await t.test(oversizedStage, async () => {
      const calls: string[] = [];
      const runtime = context(async (input) => {
        const url = String(input);
        const stage = url.includes("api.github.com") ? "github" : url.includes("generativelanguage") ? "gemini" : url.includes("r.jina.ai") ? "jina" : "http";
        calls.push(stage);
        return stage === oversizedStage
          ? new Response("", { headers: { "content-type": "text/plain", "content-length": String(MAX_DOCUMENT_BYTES + 1) } })
          : new Response("unavailable", { status: 503 });
      }, async () => "test-key");
      const query = oversizedStage === "github" ? "https://github.com/example/repo/blob/main/file.md" : URL;
      const result = await createClient(runtime).run({ domain: "fetch", query });
      assert.equal(result.kind, "error");
      if (result.kind === "error") assert.match(result.error.message, /Response too large/);
      assert.equal(calls.at(-1), oversizedStage);
    });
  }
});
