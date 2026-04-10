import assert from "node:assert/strict";
import test from "node:test";
import "../fixtures/mock-seats-aero-fetch.mjs";
import { createClient, defineConfig } from "../../src/sdk.js";
import { flightsModule } from "../../src/sdk/modules/flights.js";

test("flights domain runs through fli source", async () => {
  process.env.SRCH_FLI_FIXTURE = process.env.SRCH_FLI_FIXTURE || "test/fixtures/fli-mock.py";
  const client = createClient({ config: defineConfig({ modules: [flightsModule] }) });
  const result = await client.run({ domain: "flights", query: "JFK DEL 2026-05-15" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.summary.totalEvidence > 0, true);
  assert.equal(result.evidence[0].source, "fli");
});

test("rewards-flights domain runs through seats-aero source", async () => {
  process.env.SEATS_AERO_API_KEY = "pro_test_123";
  process.env.SRCH_SEATS_AERO_BASE_URL = process.env.SRCH_SEATS_AERO_BASE_URL || "https://mock.seats.aero/partnerapi";
  const client = createClient({ config: defineConfig({ modules: [flightsModule] }) });
  const result = await client.run({ domain: "rewards-flights", query: "JFK CDG", date: "2026-07-01", cabins: ["business"] } as never);

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.summary.totalEvidence, 1);
  assert.equal(result.evidence[0].source, "seats-aero");
});
