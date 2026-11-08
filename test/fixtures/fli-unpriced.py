def search_flights(payload):
    options = payload.get("options") or {}
    count = options.get("adults", 1) + options.get("children", 0) + options.get("infants", 0)
    return {
        "search_id": "unpriced-fixture",
        "offer_request_id": "unpriced-fixture",
        "passenger_ids": [f"pas_{i}" for i in range(count)],
        "origin": payload["origin"],
        "destination": payload["destination"],
        "currency": "USD",
        "offers": [],
        "total_results": 0,
        "status": "pricing_unavailable",
        "warnings": ["No prices for this passenger mix; seat availability is unknown."],
        "search_url": "https://www.google.com/travel/flights?fixture=family",
        "search_params": options,
        "pricing_note": "Exact requested party; no adult-only substitution.",
    }
