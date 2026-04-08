class Duffel {
  constructor(config = {}) {
    this.config = config;
    this.offerRequests = {
      create: async (options) => ({
        data: {
          id: "orq_test_123",
          offers: buildOffers(options)
        }
      })
    };
    this.suggestions = {
      list: async ({ query }) => ({
        data: [
          { id: "arp_ber_de", type: "airport", name: "Berlin Brandenburg", city_name: "Berlin", iata_code: "BER", iata_country_code: "DE" },
          { id: "cit_ber_de", type: "city", name: "Berlin", city_name: "Berlin", iata_code: "BER", iata_country_code: "DE" }
        ].filter((item) => query.length > 0)
      })
    };
  }
}

function buildOffers(options) {
  const cabin = options.cabin_class || "economy";
  const departure = options.slices[0].departure_date;
  return [
    {
      id: "off_business_best",
      total_amount: "642.00",
      total_currency: "USD",
      owner: {
        iata_code: "QR",
        name: "Qatar Airways",
        conditions_of_carriage_url: "https://example.com/qr"
      },
      slices: [{
        duration: "PT16H55M",
        segments: [
          buildSegment("JFK", "DOH", "QR", "706", cabin, `${departure}T01:20:00Z`, `${departure}T21:05:00Z`, "PT12H45M", "Airbus A350-1000"),
          buildSegment("DOH", "DEL", "QR", "570", cabin, `${departure}T23:05:00Z`, `${departure}T08:45:00Z`, "PT4H10M", "Boeing 787-8")
        ]
      }],
      conditions: {
        change_before_departure: { allowed: true }
      }
    },
    {
      id: "off_economy_noise",
      total_amount: "101.00",
      total_currency: "USD",
      owner: {
        iata_code: "EK",
        name: "Emirates",
        conditions_of_carriage_url: "https://example.com/ek"
      },
      slices: [{
        duration: "PT10H00M",
        segments: [
          buildSegment("JFK", "DEL", "EK", "999", "economy", `${departure}T10:00:00Z`, `${departure}T20:00:00Z`, "PT10H00M", "Boeing 777-300ER")
        ]
      }],
      conditions: {
        change_before_departure: { allowed: true }
      }
    }
  ];
}

function buildSegment(origin, destination, airlineCode, flightNumber, cabin, departingAt, arrivingAt, duration, aircraftName) {
  return {
    origin: { iata_code: origin, city_name: origin, name: origin },
    destination: { iata_code: destination, city_name: destination, name: destination },
    marketing_carrier: { iata_code: airlineCode, name: airlineCode === "QR" ? "Qatar Airways" : "Emirates" },
    marketing_carrier_flight_number: flightNumber,
    operating_carrier: { iata_code: airlineCode, name: airlineCode === "QR" ? "Qatar Airways" : "Emirates" },
    passengers: [{ cabin_class: cabin }],
    departing_at: departingAt,
    arriving_at: arrivingAt,
    duration,
    aircraft: { name: aircraftName }
  };
}

module.exports = { Duffel };
