import type { FliFlightSearchOptions } from "./fli.js";

export function validateFlightSearch(dateFrom: string, options: FliFlightSearchOptions): void {
  for (const [name, value, min, max] of [
    ["adults", options.adults, 1, 9],
    ["children", options.children, 0, 8],
    ["infants", options.infants, 0, 9],
    ["maxStopovers", options.maxStopovers, 0, 2],
    ["topN", options.topN, 1, 10],
    ["limit", options.limit, 1, 1000]
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
      throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
  }
  if ((options.infants ?? 0) > (options.adults ?? 1)) throw new Error("Each lap infant needs an adult.");
  if ((options.adults ?? 1) + (options.children ?? 0) + (options.infants ?? 0) > 9) {
    throw new Error("Google Flights supports at most nine passengers per search.");
  }
  if (options.cabinClass && !["M", "W", "C", "F"].includes(options.cabinClass)) throw new Error("Invalid cabin; use M, W, C or F.");
  if (options.sort && !["price", "duration"].includes(options.sort)) throw new Error("Invalid sort; use price or duration.");
  if (options.currency && !/^[A-Z]{3}$/.test(options.currency)) throw new Error("Currency must be a three-letter uppercase code.");
  for (const date of [dateFrom, options.returnDate]) {
    if (date === undefined) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error("Flight dates must be valid YYYY-MM-DD dates.");
    }
  }
  if (options.returnDate && options.returnDate < dateFrom) throw new Error("Return date must not precede departure.");
}
