#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { searchFlights, summarizeOffer, type FlightOffer } from "../src/sdk.js";

interface DailyResult {
  date: string;
  bestOffer: FlightOffer | null;
  totalOffers: number;
  error?: string;
}

function usage(): never {
  console.error("Usage: node --import tsx scripts/compare-month-business-fares.ts <origin> <destination> <YYYY-MM>");
  process.exit(1);
}

function daysInMonth(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must be YYYY-MM");
  const [year, monthNum] = month.split("-").map(Number);
  const count = new Date(year, monthNum, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function toPrice(offer: FlightOffer | null): number {
  return offer?.price && offer.price > 0 ? offer.price : Number.POSITIVE_INFINITY;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return out;
}

async function searchDay(origin: string, destination: string, date: string): Promise<DailyResult> {
  try {
    const data = await searchFlights(origin, destination, date, {
      cabinClass: "C",
      sort: "price"
    });
    const validOffers = data.result.offers.filter((offer) => offer.price > 0);
    return {
      date,
      bestOffer: validOffers[0] ?? null,
      totalOffers: validOffers.length
    };
  } catch (error) {
    return {
      date,
      bestOffer: null,
      totalOffers: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const [, , origin, destination, month] = process.argv;
  if (!origin || !destination || !month) usage();

  const localPython = resolve(process.cwd(), ".venv-fli/bin/python");
  if (!process.env.SRCH_FLI_PYTHON && existsSync(localPython)) {
    process.env.SRCH_FLI_PYTHON = localPython;
  }

  const dates = daysInMonth(month);
  const results = await mapLimit(dates, 3, (date) => searchDay(origin.toUpperCase(), destination.toUpperCase(), date));

  const successful = results.filter((item) => item.bestOffer);
  const failed = results.filter((item) => item.error);
  const sorted = [...successful].sort((left, right) => toPrice(left.bestOffer) - toPrice(right.bestOffer));

  console.log(`Business fare comparison for ${origin.toUpperCase()} -> ${destination.toUpperCase()} in ${month}`);
  console.log(`Dates checked: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (sorted.length === 0) {
    console.log("\nNo valid fares found.");
    if (failed.length > 0) {
      console.log("\nErrors:");
      for (const item of failed.slice(0, 10)) console.log(`- ${item.date}: ${item.error}`);
    }
    process.exit(1);
  }

  console.log("\nCheapest dates:");
  for (const item of sorted.slice(0, 10)) {
    console.log(`- ${item.date}: ${summarizeOffer(item.bestOffer!)}`);
  }

  console.log("\nMost expensive dates:");
  for (const item of sorted.slice(-5)) {
    console.log(`- ${item.date}: ${summarizeOffer(item.bestOffer!)}`);
  }

  if (failed.length > 0) {
    console.log("\nSample errors:");
    for (const item of failed.slice(0, 5)) console.log(`- ${item.date}: ${item.error}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
