import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { birdSource } from "../../src/sdk/sources/bird.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

const realFetch = globalThis.fetch;
const TWEET_ID = "1850000000000000001";

// A minimal but faithful `SearchTimeline` GraphQL payload, shaped exactly as the
// @steipete/bird client expects: one TimelineAddEntries instruction carrying a
// tweet result with its author. The bird lib resolves query ids from its bundled
// cache, so intercepting this one endpoint keeps the run fully offline.
function searchTimelineResponse(): Response {
  const tweetResult = {
    rest_id: TWEET_ID,
    core: { user_results: { result: { rest_id: "42", core: {}, legacy: { screen_name: "alice", name: "Alice" } } } },
    legacy: { full_text: "Bun ships a fast built-in sqlite module", created_at: "Wed Oct 30 12:00:00 +0000 2024" }
  };
  const instructions = [
    {
      type: "TimelineAddEntries",
      entries: [
        {
          entryId: `tweet-${TWEET_ID}`,
          content: {
            entryType: "TimelineTimelineItem",
            itemContent: { itemType: "TimelineTweet", tweet_results: { result: tweetResult } }
          }
        }
      ]
    }
  ];
  return new Response(
    JSON.stringify({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions } } } } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

const originalEnv = { HOME: process.env.HOME, AUTH_TOKEN: process.env.AUTH_TOKEN, CT0: process.env.CT0 };
let homeDir = "";

before(() => {
  // Point HOME at an empty dir so no real browser cookies are ever read.
  homeDir = mkdtempSync(join(tmpdir(), "srch-bird-home-"));
  process.env.HOME = homeDir;
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalEnv.HOME;
  restoreCreds();
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

function setDummyCreds(): void {
  process.env.AUTH_TOKEN = "dummy-auth-token";
  process.env.CT0 = "dummy-ct0-token";
}

function restoreCreds(): void {
  if (originalEnv.AUTH_TOKEN === undefined) delete process.env.AUTH_TOKEN;
  else process.env.AUTH_TOKEN = originalEnv.AUTH_TOKEN;
  if (originalEnv.CT0 === undefined) delete process.env.CT0;
  else process.env.CT0 = originalEnv.CT0;
}

test("bird declares the capabilities and transport it uses", () => {
  assertCapabilities(birdSource, {
    name: "bird",
    domain: "social",
    capabilities: ["search"],
    transports: ["bird"]
  });
});

// Runs before the success path so the bird client cache stays empty: with no
// credentials the lib throws, which the social strategy must turn into a typed
// error rather than letting the exception escape.
test("bird failure surfaces a typed RunError without throwing out of the source", async () => {
  delete process.env.AUTH_TOKEN;
  delete process.env.CT0;
  const client = createClient({ config: { modules: [coreModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "social", query: "bun sqlite" }),
    { kind: "error", domain: "social" }
  );

  if (result.kind !== "error") throw new Error("expected RunError");
  assert.match(result.error.message, /auth/i);
});

test("bird maps timeline tweets into contract-conforming evidence", async () => {
  setDummyCreds();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("SearchTimeline")) return searchTimelineResponse();
    // Any auxiliary request (e.g. query-id refresh) gets a benign empty body so
    // the run never reaches the network.
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    birdSource,
    { query: "bun sqlite", count: 5 },
    makeSourceContext()
  );

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "web");
  if (item?.provenance.kind !== "web") throw new Error("expected web provenance");
  assert.equal(item.provenance.transport, "bird");
  assert.equal(item.provenance.url, `https://x.com/i/status/${TWEET_ID}`);
  assert.equal(item.payload.kind, "tweet");
  assert.equal(item.payload.id, TWEET_ID);
  assert.equal(item.payload.author, "alice");
  assert.equal(item.payload.text, "Bun ships a fast built-in sqlite module");
  assert.equal(item.payload.url, `https://x.com/i/status/${TWEET_ID}`);
});
