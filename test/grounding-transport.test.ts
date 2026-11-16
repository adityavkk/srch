import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { GroundingError, parseRetryAfter } from "../src/lib/grounding/errors.js";
import { clearCooldowns, sendWithFallbacks } from "../src/lib/grounding/transport.js";
import { groundingResponse } from "./helpers/grounding.js";

type Step = Response | Error | ((signal: AbortSignal) => Promise<Response>);

function scripted(steps: Step[]) {
  const calls: Array<{ model: string; endpoint: string }> = [];
  const send = async (model: string, endpoint: string, signal: AbortSignal) => {
    calls.push({ model, endpoint });
    const step = steps.shift();
    if (!step) throw new Error("unexpected extra request");
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(signal) : step;
  };
  return { calls, send };
}

const ok = () => Response.json(groundingResponse());
const status = (code: number, body = "{}", headers: Record<string, string> = {}) => new Response(body, { status: code, headers });
const base = { transport: "antigravity" as const, quotaKey: "project-1", models: ["m1", "m2"], endpoints: ["https://e1.example", "https://e2.example"] };

beforeEach(() => clearCooldowns());

test("success returns the model and one success attempt", async () => {
  const { calls, send } = scripted([ok()]);
  const result = await sendWithFallbacks({ ...base, send });
  assert.equal(result.model, "m1");
  assert.deepEqual(calls, [{ model: "m1", endpoint: "https://e1.example" }]);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]!.status, "success");
  assert.equal(result.attempts[0]!.endpoint, "e1.example");
});

test("401 and 403 stop immediately with every attempt recorded", async () => {
  for (const code of [401, 403]) {
    const { calls, send } = scripted([status(code, JSON.stringify({ error: { message: "denied" } }))]);
    await assert.rejects(sendWithFallbacks({ ...base, send }), (error: unknown) => {
      assert.ok(error instanceof GroundingError);
      assert.equal(error.code, "auth_rejected");
      assert.equal(error.message, "denied");
      assert.equal(error.details.attempts?.length, 1);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("429 skips the model's other endpoints and cools it down for later calls", async () => {
  const first = scripted([status(429, "{}", { "retry-after": "30" }), ok()]);
  const result = await sendWithFallbacks({ ...base, send: first.send });
  assert.deepEqual(first.calls.map((call) => call.model), ["m1", "m2"]);
  assert.equal(result.model, "m2");
  assert.equal(result.attempts[0]!.status === "failed" && result.attempts[0]!.code, "quota_exhausted");

  const second = scripted([ok()]);
  const later = await sendWithFallbacks({ ...base, send: second.send });
  assert.deepEqual(second.calls.map((call) => call.model), ["m2"], "the cooled-down model is not requested again");
  assert.match(later.attempts[0]!.status === "failed" ? later.attempts[0]!.message : "", /cooling down/);
});

test("404 tries the next endpoint; a model-specific 400 moves to the next model", async () => {
  const notFound = scripted([status(404), ok()]);
  assert.equal((await sendWithFallbacks({ ...base, send: notFound.send })).attempts.length, 2);
  assert.deepEqual(notFound.calls.map((call) => call.endpoint), ["https://e1.example", "https://e2.example"]);

  const rejected = scripted([status(400, JSON.stringify({ error: { message: "thinking budget invalid argument" } })), ok()]);
  const result = await sendWithFallbacks({ ...base, send: rejected.send });
  assert.deepEqual(rejected.calls.map((call) => call.model), ["m1", "m2"]);
  assert.equal(result.model, "m2");
});

test("5xx, network errors, non-JSON, and retired models fall through until success", async () => {
  const retired = Response.json({ candidates: [{ content: { parts: [{ text: "Model m2 is no longer available. Please switch to m3." }] } }] });
  const { calls, send } = scripted([status(503), new Error("ECONNRESET"), new Response("<html>", { status: 200 }), retired, ok()]);
  const chain = { ...base, models: ["m1", "m2", "m3"], endpoints: ["https://e1.example", "https://e2.example", "https://e3.example"] };
  const result = await sendWithFallbacks({ ...chain, send });
  assert.deepEqual(calls.map((call) => call.model), ["m1", "m1", "m1", "m2", "m3"], "a retired model skips its remaining endpoints");
  assert.equal(result.model, "m3");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status === "failed" ? attempt.code : "success"),
    ["upstream_unavailable", "upstream_unavailable", "invalid_response", "model_unavailable", "success"]);
  assert.equal(calls.length, 5);
});

test("an unclassified 400 is a request error and is not retried", async () => {
  const { calls, send } = scripted([status(400, JSON.stringify({ error: { message: "contents is required" } }))]);
  await assert.rejects(sendWithFallbacks({ ...base, send }), (error: unknown) => error instanceof GroundingError && error.code === "unsupported_request");
  assert.equal(calls.length, 1);
});

test("exhausting every model reports the last error with the full history", async () => {
  const { send } = scripted([status(500), status(502), status(503), status(504)]);
  await assert.rejects(sendWithFallbacks({ ...base, send }), (error: unknown) => {
    assert.ok(error instanceof GroundingError);
    assert.equal(error.code, "upstream_unavailable");
    assert.deepEqual(error.details.attempts?.map((attempt) => attempt.status === "failed" && attempt.httpStatus), [500, 502, 503, 504]);
    return true;
  });
});

test("cancellation stops the chain without trying more endpoints", async () => {
  const controller = new AbortController();
  const { calls, send } = scripted([async () => { controller.abort(new DOMException("stop", "AbortError")); throw new Error("aborted"); }, ok()]);
  await assert.rejects(sendWithFallbacks({ ...base, send, signal: controller.signal }), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(calls.length, 1);
});

test("upstream error bodies are shortened to one line and Retry-After accepts seconds and dates", async () => {
  const { send } = scripted([status(500, `line one\n${"x".repeat(1000)}`), status(500, "")]);
  await assert.rejects(sendWithFallbacks({ ...base, models: ["m1"], send }), (error: unknown) => {
    assert.ok(error instanceof GroundingError);
    const first = error.details.attempts?.[0];
    assert.ok(first && first.status === "failed");
    assert.ok(first.message.length <= 300 && !first.message.includes("\n"));
    return true;
  });
  assert.equal(parseRetryAfter("2.5"), 2500);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(parseRetryAfter("soon"), undefined);
});

test("quota cooldowns are scoped to the quota identity", async () => {
  const first = scripted([status(429), ok()]);
  await sendWithFallbacks({ ...base, quotaKey: "account-a", send: first.send });
  const other = scripted([ok()]);
  const otherResult = await sendWithFallbacks({ ...base, quotaKey: "account-b", send: other.send });
  assert.deepEqual(other.calls.map((call) => call.model), ["m1"], "another account is not blocked");
  assert.equal(otherResult.model, "m1");
  const same = scripted([ok()]);
  await sendWithFallbacks({ ...base, quotaKey: "account-a", send: same.send });
  assert.deepEqual(same.calls.map((call) => call.model), ["m2"], "the same account still skips its cooled-down model");
});
