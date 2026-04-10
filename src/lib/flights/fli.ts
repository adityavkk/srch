import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { activityMonitor } from "../core/activity.js";

const execFileAsync = promisify(execFile);
const BRIDGE_PATH = fileURLToPath(new URL("./fli-bridge.py", import.meta.url));
const DEFAULT_PYTHON = process.env.SRCH_FLI_PYTHON?.trim() || "python3";

export interface FliFlightSearchOptions {
  returnDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  cabinClass?: "M" | "W" | "C" | "F";
  maxStopovers?: number;
  currency?: string;
  limit?: number;
  sort?: "price" | "duration";
}

export interface FlightSegment {
  airline: string;
  airline_name: string;
  flight_no: string;
  origin: string;
  destination: string;
  origin_city: string;
  destination_city: string;
  departure: string;
  arrival: string;
  duration_seconds: number;
  cabin_class: string;
  aircraft: string;
}

export interface FlightRoute {
  segments: FlightSegment[];
  total_duration_seconds: number;
  stopovers: number;
}

export interface FlightOffer {
  id: string;
  price: number;
  currency: string;
  price_formatted: string;
  outbound: FlightRoute;
  inbound: FlightRoute | null;
  airlines: string[];
  owner_airline: string;
  bags_price: Record<string, number>;
  availability_seats: number | null;
  conditions: Record<string, string>;
  is_locked: boolean;
  fetched_at: string;
  booking_url: string;
}

export interface FlightSearchResult {
  search_id: string;
  offer_request_id: string;
  passenger_ids: string[];
  origin: string;
  destination: string;
  currency: string;
  offers: FlightOffer[];
  total_results: number;
  search_params: Record<string, unknown>;
  pricing_note: string;
}

export interface FlightsInspectResult {
  backend: "fli-sdk";
  packageInstalled: boolean;
  pythonCommand: string;
  installHint: string;
  docsHint: string;
}

const FLI_INSTALL_HINT = "Install the optional flights backend with `search install flights` or manually via `python3 -m pip install flights`.";
const FLI_DOCS_HINT = "Fli provides Google Flights search through its Python SDK: https://github.com/punitarani/fli";

function isMissingFliRuntime(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("no module named 'fli'")
    || normalized.includes('no module named "fli"')
    || normalized.includes("cannot find module")
    || normalized.includes("not found")
    || normalized.includes("enoent")
    || normalized.includes("unable to load fli fixture");
}

function optionalInstallError(detail?: string): Error {
  return new Error([FLI_INSTALL_HINT, detail].filter(Boolean).join(" "));
}

async function canImportFli(): Promise<boolean> {
  if (process.env.SRCH_FLI_FIXTURE?.trim()) return true;
  try {
    await execFileAsync(DEFAULT_PYTHON, ["-c", "import fli"], { timeout: 15_000, env: process.env });
    return true;
  } catch {
    return false;
  }
}

async function runBridge<T>(payload: Record<string, unknown>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const child = spawn(DEFAULT_PYTHON, [BRIDGE_PATH], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const fail = (message: string) => {
      if (isMissingFliRuntime(message)) reject(optionalInstallError(message));
      else reject(new Error(message));
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => fail(error instanceof Error ? error.message : String(error)));
    child.on("close", (code) => {
      if (code !== 0) return fail(stderr.trim() || stdout.trim() || `Fli bridge exited with code ${code ?? 1}`);
      const text = stdout.trim();
      if (!text) return fail(stderr.trim() || "Fli bridge returned empty output");
      try {
        resolve(JSON.parse(text) as T);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

export async function inspectFli(): Promise<FlightsInspectResult> {
  return {
    backend: "fli-sdk",
    packageInstalled: await canImportFli(),
    pythonCommand: DEFAULT_PYTHON,
    installHint: FLI_INSTALL_HINT,
    docsHint: FLI_DOCS_HINT
  };
}

export async function searchFlights(origin: string, destination: string, dateFrom: string, options: FliFlightSearchOptions = {}) {
  const activityId = activityMonitor.logStart({ type: "api", query: `fli:${origin}-${destination}` });
  try {
    const result = await runBridge<FlightSearchResult>({
      command: "search",
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      dateFrom,
      options
    });
    const validOffers = result.offers.filter(isValidOffer);
    const droppedInvalidOffers = result.offers.length - validOffers.length;
    const requestedPassengers = Math.max((options.adults ?? 1) + (options.children ?? 0) + (options.infants ?? 0), 1);
    const normalizedResult: FlightSearchResult = {
      ...result,
      offers: validOffers,
      total_results: validOffers.length,
      passenger_ids: Array.from({ length: requestedPassengers }, (_, index) => result.passenger_ids[index] ?? `pas_${index + 1}`),
      search_params: {
        ...result.search_params,
        requestedPassengers
      },
      pricing_note: droppedInvalidOffers > 0
        ? `${result.pricing_note}${result.pricing_note ? "; " : ""}Dropped ${droppedInvalidOffers} invalid offer(s).`
        : result.pricing_note
    };
    activityMonitor.logComplete(activityId, 200);
    return {
      provider: "fli-sdk",
      result: normalizedResult,
      bestOffer: normalizedResult.offers[0] ?? null,
      offerSummaries: normalizedResult.offers.slice(0, 10).map((offer) => summarizeOffer(offer))
    };
  } catch (error) {
    activityMonitor.logError(activityId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function resolveFlightLocation(query: string) {
  const activityId = activityMonitor.logStart({ type: "api", query: `fli-resolve:${query}` });
  try {
    const result = await runBridge<{ query: string; locations: Array<Record<string, unknown>> }>({
      command: "resolve",
      query
    });
    activityMonitor.logComplete(activityId, 200);
    return { provider: "fli-sdk", ...result };
  } catch (error) {
    activityMonitor.logError(activityId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function normalizeCabin(value: string) {
  const lower = value.toLowerCase();
  if (lower === "m") return "economy";
  if (lower === "w") return "premium_economy";
  if (lower === "c") return "business";
  if (lower === "f") return "first";
  return lower;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

function isValidOffer(offer: FlightOffer): boolean {
  return Number.isFinite(offer.price) && offer.price > 0 && offer.outbound.segments.length > 0;
}

function formatRoute(route: FlightRoute): string {
  if (!route.segments.length) return "unknown route";
  const codes = [route.segments[0]!.origin, ...route.segments.map((segment) => segment.destination)];
  return codes.join(" -> ");
}

export function summarizeOffer(offer: FlightOffer): string {
  const airline = offer.owner_airline || offer.airlines[0] || "?";
  const cabin = offer.outbound.segments[0]?.cabin_class ? normalizeCabin(offer.outbound.segments[0].cabin_class) : "unknown";
  return `${offer.price_formatted} | ${airline} | ${formatRoute(offer.outbound)} | ${cabin} | ${formatDuration(offer.outbound.total_duration_seconds)} | ${offer.outbound.stopovers} stop(s)`;
}

export function formatFlightSearchText(result: FlightSearchResult, summaries: string[], bestOffer: FlightOffer | null): string {
  const requestedPassengers = typeof result.search_params.requestedPassengers === "number" ? result.search_params.requestedPassengers : result.passenger_ids.length;
  const lines = [
    `${result.total_results} offers for ${result.origin} -> ${result.destination}`,
    `Provider: Fli`,
    `Requested passengers: ${requestedPassengers}`,
    `Pricing returned for: ${result.passenger_ids.length} passenger(s)`
  ];
  if (result.pricing_note) lines.push(`Pricing: ${result.pricing_note}`);
  if (bestOffer) lines.push(`Best: ${summarizeOffer(bestOffer)}`);
  if (summaries.length > 0) {
    lines.push("");
    for (const [index, summary] of summaries.entries()) lines.push(`${index + 1}. ${summary}`);
  }
  return lines.join("\n");
}

export function formatFlightLocationsText(query: string, locations: Array<Record<string, unknown>>): string {
  if (locations.length === 0) return `No locations found for ${query}.`;
  const lines = [`${locations.length} locations for ${query}`];
  for (const [index, location] of locations.entries()) {
    const name = typeof location.name === "string" ? location.name : typeof location.city === "string" ? location.city : "Unknown";
    const code = typeof location.code === "string" ? location.code : "?";
    const country = typeof location.country === "string" ? location.country : undefined;
    lines.push(`${index + 1}. ${name} (${code})${country ? ` — ${country}` : ""}`);
  }
  return lines.join("\n");
}
