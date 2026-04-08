import { createRequire } from "node:module";
import { activityMonitor } from "../core/activity.js";
import { resolveSecret } from "../core/secrets.js";

const require = createRequire(import.meta.url);

export interface DuffelFlightSearchOptions {
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
  backend: "duffel-sdk";
  packageInstalled: boolean;
  apiKeyPresent: boolean;
  basePath: string | null;
  installHint: string;
  docsHint: string;
}

const DUFFEL_INSTALL_HINT = "Flights are built in via @duffel/api. Configure DUFFEL_ACCESS_TOKEN or `search config set-secret-ref duffelAccessToken ...` to use them.";
const DUFFEL_DOCS_HINT = "Duffel offers free signup and test mode access. Production pricing is commercial and not clearly public.";

type DuffelClient = {
  offerRequests: {
    create(options: any): Promise<{ data: any }>;
  };
  suggestions: {
    list(params: { query: string }): Promise<{ data: any[] }>;
  };
};

type DuffelModule = {
  Duffel: new (config: { token: string; basePath?: string }) => DuffelClient;
};

function mapCabinClass(value?: "M" | "W" | "C" | "F"): "economy" | "premium_economy" | "business" | "first" | undefined {
  if (value === "M") return "economy";
  if (value === "W") return "premium_economy";
  if (value === "C") return "business";
  if (value === "F") return "first";
  return undefined;
}

export async function inspectDuffel(): Promise<FlightsInspectResult> {
  const override = process.env.SRCH_DUFFEL_MODULE?.trim();
  let packageInstalled = true;
  try {
    if (override) require.resolve(override);
    else require.resolve("@duffel/api");
  } catch {
    packageInstalled = false;
  }
  return {
    backend: "duffel-sdk",
    packageInstalled,
    apiKeyPresent: Boolean(await resolveSecret("duffelAccessToken")),
    basePath: process.env.SRCH_DUFFEL_BASE_PATH?.trim() || null,
    installHint: DUFFEL_INSTALL_HINT,
    docsHint: DUFFEL_DOCS_HINT
  };
}

async function createClient() {
  const token = await resolveSecret("duffelAccessToken");
  if (!token) throw new Error("Duffel requires an access token. Configure via: search config set-secret-ref duffelAccessToken op ... or set DUFFEL_ACCESS_TOKEN.");
  const mod = loadDuffelModule();
  return new mod.Duffel({
    token,
    ...(process.env.SRCH_DUFFEL_BASE_PATH?.trim() ? { basePath: process.env.SRCH_DUFFEL_BASE_PATH.trim() } : {})
  });
}

function loadDuffelModule(): DuffelModule {
  const override = process.env.SRCH_DUFFEL_MODULE?.trim();
  const loaded = (override ? require(override) : require("@duffel/api")) as Partial<DuffelModule> & { default?: Partial<DuffelModule> };
  const mod = typeof loaded.Duffel === "function" ? loaded : loaded.default;
  if (!mod || typeof mod.Duffel !== "function") throw new Error("Installed Duffel package does not expose the expected SDK surface.");
  return mod as DuffelModule;
}

export async function searchFlights(origin: string, destination: string, dateFrom: string, options: DuffelFlightSearchOptions = {}) {
  const activityId = activityMonitor.logStart({ type: "api", query: `duffel:${origin}-${destination}` });
  try {
    const duffel = await createClient();
    const passengers = buildPassengers(options);
    const slices = [
      { origin: origin.toUpperCase(), destination: destination.toUpperCase(), departure_date: dateFrom },
      ...(options.returnDate ? [{ origin: destination.toUpperCase(), destination: origin.toUpperCase(), departure_date: options.returnDate }] : [])
    ];
    const response = await duffel.offerRequests.create({
      slices: slices as any,
      passengers: passengers as any,
      cabin_class: mapCabinClass(options.cabinClass),
      max_connections: normalizeMaxConnections(options.maxStopovers),
      return_offers: true
    });
    const offers = Array.isArray(response.data.offers) ? response.data.offers : [];
    const normalizedOffers = offers.map(normalizeOffer);
    const filteredOffers = normalizedOffers.filter((offer: FlightOffer) => matchesRequestedCabin(offer, options.cabinClass));
    const sortedOffers = sortOffers(filteredOffers.length > 0 ? filteredOffers : normalizedOffers, options.sort).slice(0, options.limit ?? 20);
    const result: FlightSearchResult = {
      search_id: response.data.id,
      offer_request_id: response.data.id,
      passenger_ids: passengers.map((_, index) => `pas_${index + 1}`),
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      currency: sortedOffers[0]?.currency ?? options.currency?.toUpperCase() ?? "USD",
      offers: sortedOffers,
      total_results: sortedOffers.length,
      search_params: {
        dateFrom,
        ...options,
        requestedCabinClass: mapCabinClass(options.cabinClass) ?? null
      },
      pricing_note: filteredOffers.length === 0 && normalizedOffers.length > 0 && options.cabinClass ? `No offers matched the requested cabin ${mapCabinClass(options.cabinClass)} exactly.` : "Duffel live fare search"
    };
    activityMonitor.logComplete(activityId, 200);
    return {
      provider: "duffel-sdk",
      result,
      bestOffer: result.offers[0] ?? null,
      offerSummaries: result.offers.slice(0, 10).map((offer) => summarizeOffer(offer))
    };
  } catch (error) {
    activityMonitor.logError(activityId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function resolveFlightLocation(query: string) {
  const activityId = activityMonitor.logStart({ type: "api", query: `duffel-place:${query}` });
  try {
    const duffel = await createClient();
    const response = await duffel.suggestions.list({ query });
    const locations = response.data.map((place: any) => ({
      id: place.id,
      type: place.type,
      name: place.name,
      city: typeof place.city_name === "string" ? place.city_name : place.name,
      code: typeof place.iata_code === "string" ? place.iata_code : undefined,
      country: typeof place.iata_country_code === "string" ? place.iata_country_code : undefined
    }));
    activityMonitor.logComplete(activityId, 200);
    return { provider: "duffel-sdk", query, locations };
  } catch (error) {
    activityMonitor.logError(activityId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function buildPassengers(options: DuffelFlightSearchOptions) {
  const adults = options.adults ?? 1;
  const children = options.children ?? 0;
  const infants = options.infants ?? 0;
  return [
    ...Array.from({ length: adults }, () => ({ type: "adult" as const })),
    ...Array.from({ length: children }, () => ({ type: "child" as const })),
    ...Array.from({ length: infants }, () => ({ type: "infant_without_seat" as const }))
  ];
}

function normalizeMaxConnections(value?: number): 0 | 1 | 2 | undefined {
  if (value === 0 || value === 1 || value === 2) return value;
  return undefined;
}

function normalizeOffer(offer: any): FlightOffer {
  const outboundSlice = offer.slices?.[0];
  const inboundSlice = offer.slices?.[1];
  const totalAmount = Number.parseFloat(offer.total_amount ?? offer.totalAmount ?? "0");
  const currency = offer.total_currency ?? offer.totalCurrency ?? "USD";
  return {
    id: offer.id,
    price: totalAmount,
    currency,
    price_formatted: `${currency} ${totalAmount.toFixed(2)}`,
    outbound: normalizeRoute(outboundSlice),
    inbound: inboundSlice ? normalizeRoute(inboundSlice) : null,
    airlines: collectAirlines(offer),
    owner_airline: offer.owner?.iata_code ?? offer.owner?.name ?? "Duffel",
    bags_price: {},
    availability_seats: null,
    conditions: normalizeConditions(offer.conditions),
    is_locked: false,
    fetched_at: new Date().toISOString(),
    booking_url: offer.owner?.conditions_of_carriage_url ?? ""
  };
}

function normalizeRoute(slice: any): FlightRoute {
  const segments = Array.isArray(slice?.segments) ? slice.segments.map(normalizeSegment) : [];
  return {
    segments,
    total_duration_seconds: parseDuffelDuration(slice?.duration),
    stopovers: Math.max(segments.length - 1, 0)
  };
}

function normalizeSegment(segment: any): FlightSegment {
  const passengerCabin = segment.passengers?.[0]?.cabin_class ?? segment.passengers?.[0]?.cabin?.name ?? "unknown";
  return {
    airline: segment.marketing_carrier?.iata_code ?? segment.operating_carrier?.iata_code ?? "?",
    airline_name: segment.marketing_carrier?.name ?? segment.operating_carrier?.name ?? "Unknown",
    flight_no: `${segment.marketing_carrier?.iata_code ?? ""}${segment.marketing_carrier_flight_number ?? ""}`,
    origin: segment.origin?.iata_code ?? "???",
    destination: segment.destination?.iata_code ?? "???",
    origin_city: segment.origin?.city_name ?? segment.origin?.name ?? "",
    destination_city: segment.destination?.city_name ?? segment.destination?.name ?? "",
    departure: segment.departing_at ?? "",
    arrival: segment.arriving_at ?? "",
    duration_seconds: parseDuffelDuration(segment.duration),
    cabin_class: passengerCabin,
    aircraft: segment.aircraft?.name ?? ""
  };
}

function parseDuffelDuration(value?: string): number {
  if (!value || !value.startsWith("P")) return 0;
  const match = value.match(/P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?/);
  if (!match) return 0;
  const days = Number.parseInt(match[1] ?? "0", 10);
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return (((days * 24) + hours) * 60 + minutes) * 60;
}

function collectAirlines(offer: any): string[] {
  const slices = Array.isArray(offer.slices) ? offer.slices : [];
  const codes = new Set<string>();
  for (const slice of slices) {
    for (const segment of slice?.segments ?? []) {
      const code = segment.marketing_carrier?.iata_code ?? segment.operating_carrier?.iata_code;
      if (code) codes.add(code);
    }
  }
  return [...codes];
}

function normalizeConditions(conditions: Record<string, any> | undefined): Record<string, string> {
  if (!conditions) return {};
  return Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key, JSON.stringify(value)]));
}

function matchesRequestedCabin(offer: FlightOffer, cabin?: "M" | "W" | "C" | "F") {
  const requested = mapCabinClass(cabin);
  if (!requested) return true;
  const segments = [...offer.outbound.segments, ...(offer.inbound?.segments ?? [])];
  return segments.every((segment) => normalizeCabin(segment.cabin_class) === requested);
}

function normalizeCabin(value: string) {
  const lower = value.toLowerCase();
  if (lower === "m") return "economy";
  if (lower === "w") return "premium_economy";
  if (lower === "c") return "business";
  if (lower === "f") return "first";
  return lower;
}

function sortOffers(offers: FlightOffer[], sort?: "price" | "duration") {
  return [...offers].sort((left, right) => {
    if (sort === "duration") return left.outbound.total_duration_seconds - right.outbound.total_duration_seconds;
    return left.price - right.price;
  });
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

export function summarizeOffer(offer: FlightOffer): string {
  const airline = offer.owner_airline || offer.airlines[0] || "?";
  const cabin = offer.outbound.segments[0]?.cabin_class ? normalizeCabin(offer.outbound.segments[0].cabin_class) : "unknown";
  return `${offer.price_formatted} | ${airline} | ${formatRoute(offer.outbound)} | ${cabin} | ${formatDuration(offer.outbound.total_duration_seconds)} | ${offer.outbound.stopovers} stop(s)`;
}

export function formatFlightSearchText(result: FlightSearchResult, summaries: string[], bestOffer: FlightOffer | null): string {
  const lines = [
    `${result.total_results} offers for ${result.origin} -> ${result.destination}`,
    `Provider: Duffel`,
    `Passenger count: ${result.passenger_ids.length}`
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
