import { activityMonitor } from "../core/activity.js";
import { errorMessage, withTimeout } from "../core/http.js";
import { resolveSecret } from "../core/secrets.js";

const DEFAULT_BASE_URL = "https://seats.aero/partnerapi";

export const SEATS_AERO_SOURCES = [
  "aeromexico",
  "aeroplan",
  "alaska",
  "american",
  "azul",
  "connectmiles",
  "delta",
  "emirates",
  "ethiopian",
  "etihad",
  "eurobonus",
  "flyingblue",
  "jetblue",
  "qantas",
  "qatar",
  "saudia",
  "singapore",
  "smiles",
  "turkish",
  "united",
  "velocity",
  "virginatlantic"
] as const;

export type SeatsAeroSource = typeof SEATS_AERO_SOURCES[number];
export type RewardsCabin = "economy" | "premium" | "business" | "first";
export type RewardsOrderBy = "lowest_mileage" | "default";

export interface RewardsFlightSearchOptions {
  originAirport: string;
  destinationAirport: string;
  startDate?: string;
  endDate?: string;
  cabins?: RewardsCabin[];
  sources?: string[];
  carriers?: string[];
  take?: number;
  skip?: number;
  includeTrips?: boolean;
  includeFiltered?: boolean;
  onlyDirectFlights?: boolean;
  orderBy?: RewardsOrderBy;
}

export interface SeatsAeroInspectResult {
  backend: "seats-aero";
  apiKeyPresent: boolean;
  baseUrl: string;
  directApiAccessOnly: boolean;
  liveSearchAvailable: false;
  authHeader: "Partner-Authorization";
}

export interface RewardsFlightSearchResult {
  provider: "seats-aero";
  query: RewardsFlightSearchOptions;
  count: number;
  items: unknown[];
  summaries: string[];
  nextCursor: number | null;
  rateLimitRemaining: string | null;
  native: unknown;
}

export interface RewardsRoutesResult {
  provider: "seats-aero";
  source: string;
  count: number;
  routes: unknown[];
  summaries: string[];
  rateLimitRemaining: string | null;
  native: unknown;
}

export interface RewardsTripsResult {
  provider: "seats-aero";
  availabilityId: string;
  count: number;
  trips: unknown[];
  summaries: string[];
  rateLimitRemaining: string | null;
  native: unknown;
}

async function getApiKey(): Promise<string> {
  const key = await resolveSecret("seatsAeroApiKey");
  if (!key) throw new Error("Seats.aero requires an API key. Configure via: search config set-secret-ref seatsAeroApiKey op ... or set SEATS_AERO_API_KEY.");
  return key;
}

function getBaseUrl(): string {
  return process.env.SRCH_SEATS_AERO_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

export async function isSeatsAeroAvailable(): Promise<boolean> {
  return !!(await resolveSecret("seatsAeroApiKey"));
}

export async function inspectSeatsAero(): Promise<SeatsAeroInspectResult> {
  return {
    backend: "seats-aero",
    apiKeyPresent: await isSeatsAeroAvailable(),
    baseUrl: getBaseUrl(),
    directApiAccessOnly: true,
    liveSearchAvailable: false,
    authHeader: "Partner-Authorization"
  };
}

export async function searchRewardFlights(query: RewardsFlightSearchOptions): Promise<RewardsFlightSearchResult> {
  const activityId = activityMonitor.logStart({ type: "api", query: `seats-aero:${query.originAirport}-${query.destinationAirport}` });
  try {
    const url = new URL(`${getBaseUrl()}/search`);
    url.searchParams.set("origin_airport", query.originAirport);
    url.searchParams.set("destination_airport", query.destinationAirport);
    if (query.startDate) url.searchParams.set("start_date", query.startDate);
    if (query.endDate) url.searchParams.set("end_date", query.endDate);
    if (query.cabins?.length) url.searchParams.set("cabins", query.cabins.join(","));
    if (query.sources?.length) url.searchParams.set("sources", query.sources.join(","));
    if (query.carriers?.length) url.searchParams.set("carriers", query.carriers.join(","));
    if (typeof query.take === "number") url.searchParams.set("take", String(query.take));
    if (typeof query.skip === "number") url.searchParams.set("skip", String(query.skip));
    if (query.includeTrips) url.searchParams.set("include_trips", "true");
    if (query.includeFiltered) url.searchParams.set("include_filtered", "true");
    if (query.onlyDirectFlights) url.searchParams.set("only_direct_flights", "true");
    if (query.orderBy === "lowest_mileage") url.searchParams.set("order_by", "lowest_mileage");

    const response = await callSeatsAero(url);
    const data = await response.json() as Record<string, unknown> | unknown[];
    const items = extractCollection(data);
    activityMonitor.logComplete(activityId, response.status);
    return {
      provider: "seats-aero",
      query,
      count: items.length,
      items,
      summaries: items.slice(0, 20).map((item) => summarizeAvailability(item, query.cabins)),
      nextCursor: parseCursor(data),
      rateLimitRemaining: response.headers.get("X-RateLimit-Remaining"),
      native: data
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

export async function getRewardFlightRoutes(source: string): Promise<RewardsRoutesResult> {
  const activityId = activityMonitor.logStart({ type: "api", query: `seats-aero-routes:${source}` });
  try {
    const url = new URL(`${getBaseUrl()}/routes`);
    url.searchParams.set("source", source);
    const response = await callSeatsAero(url);
    const data = await response.json() as Record<string, unknown> | unknown[];
    const routes = extractCollection(data);
    activityMonitor.logComplete(activityId, response.status);
    return {
      provider: "seats-aero",
      source,
      count: routes.length,
      routes,
      summaries: routes.slice(0, 30).map((route) => summarizeRoute(route)),
      rateLimitRemaining: response.headers.get("X-RateLimit-Remaining"),
      native: data
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

export async function getRewardFlightTrips(availabilityId: string, includeFiltered = false): Promise<RewardsTripsResult> {
  const activityId = activityMonitor.logStart({ type: "api", query: `seats-aero-trips:${availabilityId}` });
  try {
    const url = new URL(`${getBaseUrl()}/trips/${availabilityId}`);
    if (includeFiltered) url.searchParams.set("include_filtered", "true");
    const response = await callSeatsAero(url);
    const data = await response.json() as Record<string, unknown> | unknown[];
    const trips = extractCollection(data);
    activityMonitor.logComplete(activityId, response.status);
    return {
      provider: "seats-aero",
      availabilityId,
      count: trips.length,
      trips,
      summaries: trips.slice(0, 30).map((trip) => summarizeTrip(trip)),
      rateLimitRemaining: response.headers.get("X-RateLimit-Remaining"),
      native: data
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

async function callSeatsAero(url: URL): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "Partner-Authorization": await getApiKey()
    },
    signal: withTimeout(undefined, 60_000)
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 400);
    if (response.status === 401) {
      throw new Error("Seats.aero requires an API key. Configure via: search config set-secret-ref seatsAeroApiKey op ... or set SEATS_AERO_API_KEY.");
    }
    throw new Error(`Seats.aero API error ${response.status}: ${body}`);
  }
  return response;
}

function extractCollection(data: Record<string, unknown> | unknown[]): unknown[] {
  if (Array.isArray(data)) return data;
  const candidates = [data.data, data.items, data.results, data.routes, data.trips, data.availability];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function parseCursor(data: Record<string, unknown> | unknown[]): number | null {
  if (Array.isArray(data)) return null;
  const cursor = data.cursor;
  return typeof cursor === "number" ? cursor : null;
}

function summarizeAvailability(item: unknown, requestedCabins?: RewardsCabin[]): string {
  const record = asRecord(item);
  const id = readString(record, ["id", "ID"]) || "unknown";
  const source = readString(record, ["source", "Source"]) || "unknown-source";
  const date = readString(record, ["date", "Date", "departure_date", "DepartureDate"]) || "unknown-date";
  const origin = pickAirport(record, "origin");
  const destination = pickAirport(record, "destination");
  const cabins = requestedCabins?.length ? requestedCabins : (["economy", "premium", "business", "first"] as RewardsCabin[]);
  const cabinText = cabins.map((cabin) => summarizeCabin(record, cabin)).filter(Boolean).join(" | ") || "no cabin pricing parsed";
  return `${date} | ${origin} -> ${destination} | ${source} | ${cabinText} | id=${id}`;
}

function summarizeRoute(item: unknown): string {
  const record = asRecord(item);
  const origin = pickAirport(record, "origin");
  const destination = pickAirport(record, "destination");
  const carrier = readString(record, ["carrier", "Carrier", "airline", "Airline"]);
  return `${origin} -> ${destination}${carrier ? ` | ${carrier}` : ""}`;
}

function summarizeTrip(item: unknown): string {
  const record = asRecord(item);
  const flightNumber = readString(record, ["flight_number", "flightNumber", "FlightNumber"]) || "flight";
  const origin = pickAirport(record, "origin");
  const destination = pickAirport(record, "destination");
  const depart = readString(record, ["departure", "Departure", "departure_time", "DepartureTime"]) || "unknown-departure";
  const arrive = readString(record, ["arrival", "Arrival", "arrival_time", "ArrivalTime"]) || "unknown-arrival";
  const aircraft = readString(record, ["aircraft", "Aircraft"]);
  return `${flightNumber} | ${origin} -> ${destination} | ${depart} -> ${arrive}${aircraft ? ` | ${aircraft}` : ""}`;
}

function summarizeCabin(record: Record<string, unknown>, cabin: RewardsCabin): string | null {
  const prefix = cabin === "economy" ? "Y" : cabin === "premium" ? "W" : cabin === "business" ? "J" : "F";
  const available = readBoolean(record, [`${prefix}Available`, `${cabin}Available`, `${cabin}_available`]);
  const miles = readNumber(record, [`${prefix}MileageCost`, `${cabin}MileageCost`, `${cabin}_mileage_cost`, `${cabin}Points`, `${cabin}_points`]);
  const taxes = readNumber(record, [`${prefix}TotalTaxes`, `${cabin}TotalTaxes`, `${cabin}_total_taxes`, `${cabin}Taxes`, `${cabin}_taxes`]);
  const seats = readNumber(record, [`${prefix}RemainingSeats`, `${cabin}RemainingSeats`, `${cabin}_remaining_seats`, `${cabin}Seats`, `${cabin}_seats`]);
  if (!available && miles === null && taxes === null && seats === null) return null;
  const parts: string[] = [cabin];
  if (available !== null) parts.push(available ? "avail" : "waitlist/none");
  if (miles !== null) parts.push(`${miles.toLocaleString()} pts`);
  if (taxes !== null) parts.push(`fees ${taxes}`);
  if (seats !== null) parts.push(`${seats} seat(s)`);
  return parts.join(" ");
}

function pickAirport(record: Record<string, unknown>, direction: "origin" | "destination"): string {
  const capitalized = direction[0].toUpperCase() + direction.slice(1);
  const direct = readString(record, [`${direction}_airport`, `${direction}Airport`, `${capitalized}Airport`]);
  if (direct) return direct;
  const route = asRecord(record.route ?? record.Route);
  return readString(route, [`${direction}_airport`, `${direction}Airport`, `${capitalized}Airport`]) || "???";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
  }
  return null;
}

export function formatRewardsFlightSearchText(result: RewardsFlightSearchResult): string {
  const lines = [
    `${result.count} award results for ${result.query.originAirport} -> ${result.query.destinationAirport}`,
    `Provider: Seats.aero`,
    result.rateLimitRemaining ? `Remaining quota: ${result.rateLimitRemaining}` : null
  ].filter(Boolean) as string[];
  if (result.summaries.length > 0) {
    lines.push("");
    for (const [index, summary] of result.summaries.entries()) lines.push(`${index + 1}. ${summary}`);
  }
  if (result.nextCursor !== null) lines.push(`\nNext cursor: ${result.nextCursor}`);
  lines.push("\nNotes: cached award data can lag live airline inventory; verify before transferring points.");
  return lines.join("\n");
}

export function formatRewardsRoutesText(result: RewardsRoutesResult): string {
  const lines = [`${result.count} routes for ${result.source}`, result.rateLimitRemaining ? `Remaining quota: ${result.rateLimitRemaining}` : null].filter(Boolean) as string[];
  if (result.summaries.length > 0) {
    lines.push("");
    for (const [index, summary] of result.summaries.entries()) lines.push(`${index + 1}. ${summary}`);
  }
  return lines.join("\n");
}

export function formatRewardsTripsText(result: RewardsTripsResult): string {
  const lines = [`${result.count} trip segments for ${result.availabilityId}`, result.rateLimitRemaining ? `Remaining quota: ${result.rateLimitRemaining}` : null].filter(Boolean) as string[];
  if (result.summaries.length > 0) {
    lines.push("");
    for (const [index, summary] of result.summaries.entries()) lines.push(`${index + 1}. ${summary}`);
  }
  return lines.join("\n");
}
