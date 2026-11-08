import assert from "node:assert/strict";
import test from "node:test";
import { validateFlightSearch } from "../src/lib/flights/validation.js";
import { parseFlightSearchOptions } from "../src/lib/cli/flight-options.js";
import { parseFlagArgs } from "../src/lib/cli/flags.js";
import { schemaForCommand } from "../src/lib/cli/flag-specs.js";

for (const options of [
  { adults: 0 }, { children: -1 }, { infants: 2 }, { adults: 1.5 },
  { maxStopovers: 3 }, { topN: 11 }, { limit: 0 }, { adults: 8, children: 2 },
  { currency: "US" }, { returnDate: "2026-11-01" }, { returnDate: "2026-02-30" }
]) {
  test(`rejects invalid flight options ${JSON.stringify(options)}`, () => {
    assert.throws(() => validateFlightSearch("2026-11-25", options));
  });
}

test("preserves valid family counts and search breadth", () => {
  const { flags } = parseFlagArgs(["--adults", "2", "--children", "1", "--infants", "1", "--cabin", "c", "--top-n", "10"], schemaForCommand("flights"));
  const options = parseFlightSearchOptions(flags);
  validateFlightSearch("2026-11-25", options);
  assert.equal(options.adults, 2);
  assert.equal(options.children, 1);
  assert.equal(options.infants, 1);
  assert.equal(options.topN, 10);
  assert.equal(options.cabinClass, "C");
});

for (const args of [["--children", "x"], ["--cabin", "business"], ["--sort", "bogus"]]) {
  test(`rejects flags instead of silently changing the requested trip: ${args.join(" ")}`, () => {
    const { flags } = parseFlagArgs(args, schemaForCommand("flights"));
    assert.throws(() => parseFlightSearchOptions(flags));
  });
}
