import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const LETSFG_INSTALL_HINT = "Install the optional flights backend with `npm install letsfg` (or `npm install -g letsfg` for a global srch install).";
export const LETSFG_PYTHON_HINT = "Local flight search also requires `pip install letsfg && playwright install chromium`.";

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

export interface UnlockResult {
  offer_id: string;
  unlock_status: string;
  payment_charged: boolean;
  payment_amount_cents: number;
  payment_currency: string;
  payment_intent_id: string;
  confirmed_price: number | null;
  confirmed_currency: string;
  offer_expires_at: string;
  message: string;
}

export interface Passenger {
  id: string;
  given_name: string;
  family_name: string;
  born_on: string;
  gender?: string;
  title?: string;
  email?: string;
  phone_number?: string;
}

export interface BookingResult {
  booking_id: string;
  status: string;
  booking_type: string;
  offer_id: string;
  flight_price: number;
  service_fee: number;
  service_fee_percentage: number;
  total_charged: number;
  currency: string;
  order_id: string;
  booking_reference: string;
  unlock_payment_id: string;
  fee_payment_id: string;
  created_at: string;
  details: Record<string, unknown>;
}

export interface LetsFGSearchOptions {
  returnDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  cabinClass?: "M" | "W" | "C" | "F";
  maxStopovers?: number;
  currency?: string;
  limit?: number;
  sort?: "price" | "duration";
  maxBrowsers?: number;
}

type LetsFGClient = {
  search(origin: string, destination: string, dateFrom: string, options?: LetsFGSearchOptions): Promise<FlightSearchResult>;
  resolveLocation(query: string): Promise<Array<Record<string, unknown>>>;
  unlock(offerId: string): Promise<UnlockResult>;
  book(offerId: string, passengers: Passenger[], contactEmail: string, contactPhone?: string, idempotencyKey?: string): Promise<BookingResult>;
  setupPayment(token?: string): Promise<Record<string, unknown>>;
  linkGithub(githubUsername: string): Promise<Record<string, unknown>>;
  me(): Promise<Record<string, unknown>>;
};

type LetsFGConstructor = {
  new(config?: { apiKey?: string; baseUrl?: string; timeout?: number }): LetsFGClient;
  register(agentName: string, email: string, baseUrl?: string, ownerName?: string, description?: string): Promise<Record<string, unknown>>;
};

type LetsFGModule = {
  LetsFG: LetsFGConstructor;
  offerSummary?: (offer: FlightOffer) => string;
  cheapestOffer?: (result: FlightSearchResult) => FlightOffer | null;
  systemInfo?: () => Promise<Record<string, unknown>>;
};

export interface FlightsInspectResult {
  backend: "letsfg-sdk";
  packageInstalled: boolean;
  resolvedPath: string | null;
  apiKeyPresent: boolean;
  installHint: string;
  pythonHint: string;
}

function isModuleResolutionError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "MODULE_NOT_FOUND";
}

function optionalInstallError(): Error {
  return new Error(`${LETSFG_INSTALL_HINT} ${LETSFG_PYTHON_HINT}`);
}

function loadLetsFGModule(): LetsFGModule {
  const override = process.env.SRCH_LETSFG_MODULE?.trim();

  try {
    const loaded = (override ? require(override) : require("letsfg")) as Partial<LetsFGModule> & { default?: Partial<LetsFGModule> };
    const mod = typeof loaded.LetsFG === "function" ? loaded : loaded.default;
    if (!mod || typeof mod.LetsFG !== "function") throw new Error("Installed letsfg package does not expose the expected SDK surface.");
    return mod as LetsFGModule;
  } catch (error) {
    if (isModuleResolutionError(error)) throw optionalInstallError();
    throw error;
  }
}

function createClient(mod: LetsFGModule): LetsFGClient {
  return new mod.LetsFG({
    apiKey: process.env.LETSFG_API_KEY,
    baseUrl: process.env.LETSFG_BASE_URL
  });
}

export function inspectLetsFG(): FlightsInspectResult {
  const override = process.env.SRCH_LETSFG_MODULE?.trim();
  try {
    const resolvedPath = override ? require.resolve(override) : require.resolve("letsfg");
    return {
      backend: "letsfg-sdk",
      packageInstalled: true,
      resolvedPath,
      apiKeyPresent: Boolean(process.env.LETSFG_API_KEY),
      installHint: LETSFG_INSTALL_HINT,
      pythonHint: LETSFG_PYTHON_HINT
    };
  } catch {
    return {
      backend: "letsfg-sdk",
      packageInstalled: false,
      resolvedPath: null,
      apiKeyPresent: Boolean(process.env.LETSFG_API_KEY),
      installHint: LETSFG_INSTALL_HINT,
      pythonHint: LETSFG_PYTHON_HINT
    };
  }
}

export async function searchFlights(origin: string, destination: string, dateFrom: string, options: LetsFGSearchOptions = {}) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  const result = await client.search(origin, destination, dateFrom, options);
  return {
    provider: "letsfg-sdk",
    result,
    bestOffer: mod.cheapestOffer?.(result) ?? result.offers[0] ?? null,
    offerSummaries: result.offers.slice(0, 10).map((offer) => summarizeOffer(offer, mod.offerSummary))
  };
}

export async function resolveFlightLocation(query: string) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  const locations = await client.resolveLocation(query);
  return { provider: "letsfg-sdk", query, locations };
}

export async function unlockFlightOffer(offerId: string) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  return { provider: "letsfg-sdk", ...(await client.unlock(offerId)) };
}

export async function bookFlight(offerId: string, passengers: Passenger[], email: string, phone?: string, idempotencyKey?: string) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  return { provider: "letsfg-sdk", ...(await client.book(offerId, passengers, email, phone, idempotencyKey)) };
}

export async function registerFlightsAgent(name: string, email: string, owner?: string, description?: string) {
  const mod = loadLetsFGModule();
  return {
    provider: "letsfg-sdk",
    ...(await mod.LetsFG.register(name, email, process.env.LETSFG_BASE_URL, owner, description))
  };
}

export async function linkFlightsGithub(username: string) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  return { provider: "letsfg-sdk", ...(await client.linkGithub(username)) };
}

export async function setupFlightsPayment(token?: string) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  return { provider: "letsfg-sdk", ...(await client.setupPayment(token)) };
}

export async function getFlightsProfile() {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  return { provider: "letsfg-sdk", ...(await client.me()) };
}

export async function getFlightsSystemInfo() {
  const mod = loadLetsFGModule();
  if (typeof mod.systemInfo !== "function") throw new Error("Installed letsfg package does not expose systemInfo().");
  return { provider: "letsfg-sdk", info: await mod.systemInfo() };
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

function formatRoute(route: FlightRoute): string {
  if (!route.segments.length) return "unknown route";
  const codes = [route.segments[0]!.origin, ...route.segments.map((segment) => segment.destination)];
  return codes.join(" -> ");
}

export function summarizeOffer(offer: FlightOffer, helper?: (offer: FlightOffer) => string): string {
  if (helper) return helper(offer);
  const airline = offer.owner_airline || offer.airlines[0] || "?";
  return `${offer.price_formatted || `${offer.currency} ${offer.price.toFixed(2)}`} | ${airline} | ${formatRoute(offer.outbound)} | ${formatDuration(offer.outbound.total_duration_seconds)} | ${offer.outbound.stopovers} stop(s)`;
}

export function formatFlightSearchText(result: FlightSearchResult, summaries: string[], bestOffer: FlightOffer | null): string {
  const lines = [
    `${result.total_results} offers for ${result.origin} -> ${result.destination}`,
    `Passenger IDs: ${result.passenger_ids.join(", ") || "none"}`
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
    const code = typeof location.code === "string" ? location.code : typeof location.iata === "string" ? location.iata : "?";
    const country = typeof location.country === "string" ? location.country : undefined;
    lines.push(`${index + 1}. ${name} (${code})${country ? ` — ${country}` : ""}`);
  }
  return lines.join("\n");
}
