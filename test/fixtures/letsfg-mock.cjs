const baseOffer = {
  id: "off_best",
  price: 89,
  currency: "EUR",
  price_formatted: "EUR 89.00",
  outbound: {
    segments: [
      {
        airline: "LO",
        airline_name: "LOT Polish Airlines",
        flight_no: "LO387",
        origin: "GDN",
        destination: "BER",
        origin_city: "Gdansk",
        destination_city: "Berlin",
        departure: "2026-03-03T08:15:00Z",
        arrival: "2026-03-03T09:20:00Z",
        duration_seconds: 3900,
        cabin_class: "M",
        aircraft: "E190"
      }
    ],
    total_duration_seconds: 3900,
    stopovers: 0
  },
  inbound: null,
  airlines: ["LO"],
  owner_airline: "LO",
  bags_price: {},
  availability_seats: 4,
  conditions: { refund: "no" },
  is_locked: false,
  fetched_at: "2026-03-01T12:00:00Z",
  booking_url: "https://example.com/off_best"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function offerSummary(offer) {
  return `${offer.price_formatted} | ${offer.owner_airline} | ${offer.outbound.segments[0].origin} -> ${offer.outbound.segments.at(-1).destination}`;
}

function cheapestOffer(result) {
  return result.offers[0] ?? null;
}

class LetsFG {
  constructor(config = {}) {
    this.config = config;
  }

  async search(origin, destination, dateFrom, options = {}) {
    const cheapest = clone(baseOffer);
    cheapest.outbound.segments[0].origin = origin;
    cheapest.outbound.segments[0].destination = destination;

    const alternate = clone(baseOffer);
    alternate.id = "off_alt";
    alternate.price = 124;
    alternate.price_formatted = "EUR 124.00";
    alternate.owner_airline = "FR";
    alternate.airlines = ["FR"];
    alternate.outbound.stopovers = 1;

    return {
      search_id: "srch_123",
      offer_request_id: "req_123",
      passenger_ids: ["pas_ada", "pas_charles"],
      origin,
      destination,
      currency: options.currency || "EUR",
      offers: [cheapest, alternate],
      total_results: 2,
      search_params: {
        dateFrom,
        ...options
      },
      pricing_note: "README example style fixture"
    };
  }

  async resolveLocation(query) {
    return [
      { name: "Berlin Brandenburg", code: "BER", country: "Germany", query },
      { name: "Berlin Tegel (historic)", code: "TXL", country: "Germany", query }
    ];
  }

  async unlock(offerId) {
    return {
      offer_id: offerId,
      unlock_status: "unlocked",
      payment_charged: false,
      payment_amount_cents: 0,
      payment_currency: "EUR",
      payment_intent_id: "pi_123",
      confirmed_price: 89,
      confirmed_currency: "EUR",
      offer_expires_at: "2026-03-03T13:00:00Z",
      message: "Offer unlocked"
    };
  }

  async book(offerId, passengers, contactEmail, contactPhone, idempotencyKey) {
    return {
      booking_id: "bkg_123",
      status: "confirmed",
      booking_type: "flight",
      offer_id: offerId,
      flight_price: 89,
      service_fee: 0,
      service_fee_percentage: 0,
      total_charged: 89,
      currency: "EUR",
      order_id: "ord_123",
      booking_reference: "PNR123",
      unlock_payment_id: "pay_unlock_123",
      fee_payment_id: "pay_fee_123",
      created_at: "2026-03-03T12:30:00Z",
      details: {
        passengers,
        contactEmail,
        contactPhone: contactPhone || null,
        idempotencyKey: idempotencyKey || null
      }
    };
  }

  async setupPayment(token) {
    return { status: "ready", token: token || null };
  }

  async linkGithub(githubUsername) {
    return { linked: true, github_username: githubUsername };
  }

  async me() {
    return {
      agent_id: "agt_123",
      access_granted: true,
      total_unlocks: 3,
      total_bookings: 1
    };
  }

  static async register(agentName, email, baseUrl, ownerName = "", description = "") {
    return {
      api_key: "trav_test_123",
      agent_name: agentName,
      email,
      base_url: baseUrl || null,
      owner_name: ownerName,
      description
    };
  }
}

async function systemInfo() {
  return {
    tier: "standard",
    recommended_max_browsers: 8,
    current_max_browsers: 4
  };
}

module.exports = {
  LetsFG,
  offerSummary,
  cheapestOffer,
  systemInfo
};
