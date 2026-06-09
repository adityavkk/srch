import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { flightsModule } from "../../src/sdk/modules/flights.js";
import { seatsAeroSource } from "../../src/sdk/sources/seats-aero.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// seats-aero gates on an API key (`resolveSecret("seatsAeroApiKey")`) and then
// calls the seats.aero partner API over the global `fetch`. We isolate HOME from
// the real config, set SEATS_AERO_API_KEY so the key resolves from the env
// fast-path, and stub `fetch` so the run stays offline.
const realFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalKey = process.env.SEATS_AERO_API_KEY;
let homeDir = "";

function availabilityResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          ID: "avail-1",
          Source: "united",
          Date: "2026-07-01",
          OriginAirport: "JFK",
          DestinationAirport: "CDG",
          YAvailable: true,
          YRemainingSeats: 4,
          YMileageCost: 30000,
          YTotalTaxes: 50
        }
      ],
      cursor: 42
    }),
    { status: 200, headers: { "content-type": "application/json", "X-RateLimit-Remaining": "99" } }
  );
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), "srch-seats-aero-home-"));
  process.env.HOME = homeDir;
  process.env.SEATS_AERO_API_KEY = "dummy-seats-aero-key";
});

after(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env.SEATS_AERO_API_KEY;
  else process.env.SEATS_AERO_API_KEY = originalKey;
  if (homeDir) rmSync(homeDir, { recursive: true, force: true });
});

test("seats-aero declares the capabilities and transport it uses", () => {
  assertCapabilities(seatsAeroSource, {
    name: "seats-aero",
    domain: "rewards-flights",
    capabilities: ["search"],
    transports: ["seats-aero"]
  });
});

// A 401 from the partner API surfaces as a thrown error in the source; the
// rewards strategy must catch it and return a typed RunError rather than letting
// it escape the source boundary.
test("seats-aero failure surfaces a typed RunError without throwing out of the source", async () => {
  globalThis.fetch = (async () =>
    new Response("unauthorized", { status: 401, statusText: "Unauthorized" })) as typeof fetch;
  const client = createClient({ config: { modules: [flightsModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "rewards-flights", query: "JFK CDG", date: "2026-07-01" }),
    { kind: "error", domain: "rewards-flights" }
  );

  if (result.kind !== "error") throw new Error("expected RunError");
  assert.match(result.error.message, /api key|seats\.aero/i);
});

test("seats-aero maps award availability into contract-conforming evidence", async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/search")) return availabilityResponse();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const evidence = await assertSuccessContract(
    seatsAeroSource,
    { query: "JFK CDG", originAirport: "JFK", destinationAirport: "CDG", startDate: "2026-07-01" },
    makeSourceContext()
  );

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "api");
  if (item?.provenance.kind !== "api") throw new Error("expected api provenance");
  assert.equal(item.provenance.api, "seats-aero");
  assert.equal(item.provenance.transport, "seats-aero");
  assert.equal(item.payload.kind, "award-availability");
  assert.ok(item.payload.summary.length > 0);
  assert.equal(item.payload.result.provider, "seats-aero");
  assert.equal(item.payload.result.count, 1);
});
