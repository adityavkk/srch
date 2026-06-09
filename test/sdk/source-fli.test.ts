import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { flightsModule } from "../../src/sdk/modules/flights.js";
import { fliSource } from "../../src/sdk/sources/fli.js";
import {
  assertCapabilities,
  assertSuccessContract,
  assertTypedFailure,
  makeSourceContext
} from "./source-contract.js";

// fli shells out to a Python bridge (`fli-bridge.py`). Setting SRCH_FLI_FIXTURE
// makes the bridge import a local fixture module instead of the real `fli`
// package, so the run stays a local subprocess with no network. One fixture
// returns a valid offer (success), another raises (typed-error path).
let fixtureDir = "";
let okFixture = "";
let failFixture = "";
const originalFixture = process.env.SRCH_FLI_FIXTURE;

const OK_FIXTURE_SRC = `
import datetime
def _route():
    seg = {
        "airline": "BA", "airline_name": "British Airways", "flight_no": "BA178",
        "origin": "JFK", "destination": "LHR", "origin_city": "New York",
        "destination_city": "London",
        "departure": "2026-09-01T18:00:00", "arrival": "2026-09-02T06:00:00",
        "duration_seconds": 25200, "cabin_class": "economy", "aircraft": "B777",
    }
    return {"segments": [seg], "total_duration_seconds": 25200, "stopovers": 0}
def search_flights(payload):
    origin = payload["origin"].upper()
    destination = payload["destination"].upper()
    offer = {
        "id": "fli_offer_1", "price": 612.0, "currency": "USD",
        "price_formatted": "USD 612.00", "outbound": _route(), "inbound": None,
        "airlines": ["BA"], "owner_airline": "BA", "bags_price": {},
        "availability_seats": None, "conditions": {}, "is_locked": False,
        "fetched_at": datetime.datetime.utcnow().isoformat() + "Z", "booking_url": "",
    }
    return {
        "search_id": "fixture", "offer_request_id": "fixture", "passenger_ids": ["pas_1"],
        "origin": origin, "destination": destination, "currency": "USD",
        "offers": [offer], "total_results": 1, "search_params": {}, "pricing_note": "fixture",
    }
def resolve_locations(query):
    return {"query": query, "locations": []}
`;

const FAIL_FIXTURE_SRC = `
def search_flights(payload):
    raise RuntimeError("fli fixture: upstream search failed")
def resolve_locations(query):
    raise RuntimeError("fli fixture: resolve failed")
`;

before(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "srch-fli-fixture-"));
  okFixture = join(fixtureDir, "ok_fixture.py");
  failFixture = join(fixtureDir, "fail_fixture.py");
  writeFileSync(okFixture, OK_FIXTURE_SRC);
  writeFileSync(failFixture, FAIL_FIXTURE_SRC);
});

after(() => {
  if (originalFixture === undefined) delete process.env.SRCH_FLI_FIXTURE;
  else process.env.SRCH_FLI_FIXTURE = originalFixture;
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

test("fli declares the capabilities and transport it uses", () => {
  assertCapabilities(fliSource, {
    name: "fli",
    domain: "flights",
    capabilities: ["search"],
    transports: ["fli-sdk"]
  });
});

// A bridge that raises propagates out of `searchFlights`; the flights strategy
// must catch it and return a typed RunError rather than letting it escape.
test("fli failure surfaces a typed RunError without throwing out of the source", async () => {
  process.env.SRCH_FLI_FIXTURE = failFixture;
  const client = createClient({ config: { modules: [flightsModule] } });

  const result = await assertTypedFailure(
    () => client.run({ domain: "flights", query: "JFK LHR 2026-09-01" }),
    { kind: "error", domain: "flights" }
  );

  if (result.kind !== "error") throw new Error("expected RunError");
  assert.ok(result.error.message.length > 0);
});

test("fli maps flight offers into contract-conforming evidence", async () => {
  process.env.SRCH_FLI_FIXTURE = okFixture;

  const evidence = await assertSuccessContract(
    fliSource,
    { query: "JFK LHR 2026-09-01", origin: "JFK", destination: "LHR", dateFrom: "2026-09-01" },
    makeSourceContext()
  );

  assert.equal(evidence.length, 1);
  const [item] = evidence;
  assert.equal(item?.provenance.kind, "api");
  if (item?.provenance.kind !== "api") throw new Error("expected api provenance");
  assert.equal(item.provenance.api, "fli");
  assert.equal(item.provenance.transport, "fli-sdk");
  assert.equal(item.payload.kind, "flight-offer");
  assert.equal(item.payload.offer.price, 612);
  assert.equal(item.payload.offer.outbound.segments[0]?.origin, "JFK");
  assert.equal(item.payload.search.origin, "JFK");
  assert.equal(item.payload.search.destination, "LHR");
  assert.ok(item.payload.summary.length > 0);
});
