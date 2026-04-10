const baseUrl = process.env.SRCH_SEATS_AERO_BASE_URL || "https://mock.seats.aero/partnerapi";
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (!url.startsWith(baseUrl)) return realFetch(input, init);

  const headers = new Headers(init?.headers || (typeof input === "object" && "headers" in input ? input.headers : undefined));
  if (headers.get("Partner-Authorization") !== "pro_test_123") {
    return new Response("missing auth", { status: 401, headers: { "content-type": "text/plain" } });
  }

  const parsed = new URL(url);
  const responseHeaders = {
    "content-type": "application/json",
    "X-RateLimit-Remaining": "997"
  };

  if (parsed.pathname.endsWith("/search")) {
    return new Response(JSON.stringify({
      cursor: 42,
      data: [
        {
          ID: "avail_1",
          Date: "2026-07-01",
          Source: "flyingblue",
          Route: { OriginAirport: "JFK", DestinationAirport: "CDG" },
          JAvailable: true,
          JMileageCost: 50000,
          JTotalTaxes: 220,
          JRemainingSeats: 2,
          Trips: [{ FlightNumber: "AF011", OriginAirport: "JFK", DestinationAirport: "CDG" }]
        },
        {
          ID: "avail_2",
          Date: "2026-07-02",
          Source: "qatar",
          Route: { OriginAirport: "JFK", DestinationAirport: "CDG" },
          JAvailable: true,
          JMileageCost: 70000,
          JTotalTaxes: 180,
          JRemainingSeats: 0
        }
      ]
    }), { status: 200, headers: responseHeaders });
  }

  if (parsed.pathname.endsWith("/routes")) {
    return new Response(JSON.stringify({ data: [{ OriginAirport: "JFK", DestinationAirport: "CDG", Carrier: "AF" }] }), { status: 200, headers: responseHeaders });
  }

  if (parsed.pathname.endsWith("/trips/avail_1")) {
    return new Response(JSON.stringify({
      data: [
        {
          FlightNumber: "AF011",
          OriginAirport: "JFK",
          DestinationAirport: "CDG",
          DepartureTime: "2026-07-01T19:30:00Z",
          ArrivalTime: "2026-07-02T08:40:00Z",
          Aircraft: "777-300ER"
        }
      ]
    }), { status: 200, headers: responseHeaders });
  }

  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: responseHeaders });
};
