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
};

type LetsFGConstructor = {
  new(config?: { apiKey?: string; baseUrl?: string; timeout?: number }): LetsFGClient;
};

type LetsFGModule = {
  LetsFG: LetsFGConstructor;
  offerSummary?: (offer: FlightOffer) => string;
  cheapestOffer?: (result: FlightSearchResult) => FlightOffer | null;
};

export interface FlightsHandoff {
  tool: "letsfg";
  summary: string;
  commands: string[];
  capabilities: string[];
}

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
  const bestOffer = mod.cheapestOffer?.(result) ?? result.offers[0] ?? null;
  return {
    provider: "letsfg-sdk",
    result,
    bestOffer,
    offerSummaries: result.offers.slice(0, 10).map((offer) => summarizeOffer(offer, mod.offerSummary)),
    handoff: buildLetsFGHandoff(bestOffer?.id)
  };
}

export async function resolveFlightLocation(query: string) {
  const mod = loadLetsFGModule();
  const client = createClient(mod);
  const locations = await client.resolveLocation(query);
  return { provider: "letsfg-sdk", query, locations, handoff: buildLetsFGHandoff() };
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
  const handoff = buildLetsFGHandoff(bestOffer?.id);
  lines.push("");
  lines.push("Action handoff:");
  lines.push(`- ${handoff.summary}`);
  for (const command of handoff.commands) lines.push(`- ${command}`);
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
  lines.push("");
  lines.push("Next: use these codes with `search flights <origin> <destination> <date>`.");
  return lines.join("\n");
}

export function buildLetsFGHandoff(bestOfferId?: string): FlightsHandoff {
  const commands = [
    "letsfg register --name my-agent --email me@example.com",
    "letsfg link-github <github-username>",
    bestOfferId ? `letsfg unlock ${bestOfferId}` : "letsfg unlock <offer_id>",
    "letsfg setup-payment",
    bestOfferId ? `letsfg book ${bestOfferId} --passenger '{\"id\":\"pas_xxx\",...}' --email you@example.com` : "letsfg book <offer_id> --passenger '{\"id\":\"pas_xxx\",...}' --email you@example.com",
    "letsfg me"
  ];

  return {
    tool: "letsfg",
    summary: "Use srch for research and fare discovery. Switch to the native letsfg CLI for account setup, unlock, payment, booking, and post-search actions.",
    commands,
    capabilities: [
      "register an agent account",
      "link GitHub to unlock LetsFG access",
      "unlock an offer",
      "set up payment",
      "book a flight",
      "inspect agent/account status"
    ]
  };
}
