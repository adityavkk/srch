import { getStringFlag, type FlagValue } from "./flags.js";
import type { FliFlightSearchOptions } from "../flights/fli.js";

export function parseFlightSearchOptions(flags: Map<string, FlagValue>): FliFlightSearchOptions {
  const cabin = getStringFlag(flags, "cabin")?.toUpperCase();
  const sort = getStringFlag(flags, "sort");
  if (cabin !== undefined && !["M", "W", "C", "F"].includes(cabin)) throw new Error("Invalid cabin; use M, W, C or F.");
  if (sort !== undefined && !["price", "duration"].includes(sort)) throw new Error("Invalid sort; use price or duration.");
  function number(key: string): number | undefined {
    const value = getStringFlag(flags, key);
    if (value === undefined) return undefined;
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`--${key} must be a number.`);
    return Number(value);
  }
  return {
    returnDate: getStringFlag(flags, "return") ?? getStringFlag(flags, "return-date"),
    adults: number("adults"),
    children: number("children"),
    infants: number("infants"),
    cabinClass: cabin as FliFlightSearchOptions["cabinClass"],
    maxStopovers: number("max-stopovers"),
    currency: getStringFlag(flags, "currency")?.toUpperCase(),
    limit: number("limit"),
    topN: number("top-n"),
    sort: sort as FliFlightSearchOptions["sort"]
  };
}
