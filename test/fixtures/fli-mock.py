from datetime import datetime


def _segment(airline, airline_name, flight_no, origin, destination, departure, arrival, duration_seconds, cabin_class):
    return {
        "airline": airline,
        "airline_name": airline_name,
        "flight_no": flight_no,
        "origin": origin,
        "destination": destination,
        "origin_city": f"{origin} Airport",
        "destination_city": f"{destination} Airport",
        "departure": departure,
        "arrival": arrival,
        "duration_seconds": duration_seconds,
        "cabin_class": cabin_class,
        "aircraft": "787"
    }


def search_flights(payload):
    origin = payload["origin"]
    destination = payload["destination"]
    date_from = payload["dateFrom"]
    options = payload.get("options") or {}
    return_date = options.get("returnDate")
    requested_cabin = {"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(options.get("cabinClass"), "economy")

    outbound = {
        "segments": [
            _segment("AI", "Air India", "AI202", origin, destination, f"{date_from}T09:00:00", f"{date_from}T18:00:00", 9 * 3600, requested_cabin)
        ],
        "total_duration_seconds": 9 * 3600,
        "stopovers": 0,
    }
    inbound = None
    if return_date:
        inbound = {
            "segments": [
                _segment("AI", "Air India", "AI203", destination, origin, f"{return_date}T10:00:00", f"{return_date}T19:30:00", int(9.5 * 3600), requested_cabin)
            ],
            "total_duration_seconds": int(9.5 * 3600),
            "stopovers": 0,
        }

    offers = [
        {
            "id": "fli_best",
            "price": 499.0,
            "currency": "USD",
            "price_formatted": "USD 499.00",
            "outbound": outbound,
            "inbound": inbound,
            "airlines": ["AI"],
            "owner_airline": "AI",
            "bags_price": {},
            "availability_seats": 3,
            "conditions": {},
            "is_locked": False,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "booking_url": ""
        },
        {
            "id": "fli_second",
            "price": 650.0,
            "currency": "USD",
            "price_formatted": "USD 650.00",
            "outbound": {
                "segments": [
                    _segment("UA", "United Airlines", "UA14", origin, destination, f"{date_from}T06:00:00", f"{date_from}T16:30:00", int(10.5 * 3600), requested_cabin)
                ],
                "total_duration_seconds": int(10.5 * 3600),
                "stopovers": 0,
            },
            "inbound": inbound,
            "airlines": ["UA"],
            "owner_airline": "UA",
            "bags_price": {},
            "availability_seats": 2,
            "conditions": {},
            "is_locked": False,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "booking_url": ""
        },
        {
            "id": "fli_bogus_zero",
            "price": 0.0,
            "currency": "USD",
            "price_formatted": "USD 0.00",
            "outbound": outbound,
            "inbound": inbound,
            "airlines": ["SQ"],
            "owner_airline": "SQ",
            "bags_price": {},
            "availability_seats": 9,
            "conditions": {},
            "is_locked": False,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "booking_url": ""
        }
    ]

    if options.get("sort") == "duration":
        offers = sorted(offers, key=lambda offer: offer["outbound"]["total_duration_seconds"])
    else:
        offers = sorted(offers, key=lambda offer: offer["price"])

    limit = options.get("limit")
    if isinstance(limit, int) and limit > 0:
        offers = offers[:limit]

    passenger_count = (options.get("adults") or 1) + (options.get("children") or 0) + (options.get("infants") or 0)

    return {
        "search_id": f"fli:{origin}:{destination}:{date_from}",
        "offer_request_id": f"fli:{origin}:{destination}:{date_from}",
        "passenger_ids": [f"pas_{index + 1}" for index in range(passenger_count)],
        "origin": origin,
        "destination": destination,
        "currency": offers[0]["currency"],
        "offers": offers,
        "total_results": len(offers),
        "search_params": {
            "dateFrom": date_from,
            **options,
            "requestedCabinClass": requested_cabin,
        },
        "pricing_note": "Fli Google Flights search"
    }


def resolve_locations(query):
    return {
        "query": query,
        "locations": [
            {"id": "BER", "type": "airport", "name": "Berlin Brandenburg Airport", "city": "Berlin", "code": "BER", "country": "DE"},
            {"id": "TXL", "type": "airport", "name": "Berlin Tegel Airport", "city": "Berlin", "code": "TXL", "country": "DE"},
        ]
    }
