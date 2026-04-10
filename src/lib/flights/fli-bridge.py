#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


def load_fixture_module():
    path = os.environ.get("SRCH_FLI_FIXTURE", "").strip()
    if not path:
        return None
    fixture_path = Path(path)
    spec = importlib.util.spec_from_file_location("srch_fli_fixture", fixture_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Fli fixture: {fixture_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def map_cabin_class(value: str | None) -> str:
    return {
        "M": "economy",
        "W": "premium_economy",
        "C": "business",
        "F": "first",
    }.get((value or "").upper(), "economy")


def map_cabin_enum(value: str | None):
    from fli.models import SeatType

    return {
        "M": SeatType.ECONOMY,
        "W": SeatType.PREMIUM_ECONOMY,
        "C": SeatType.BUSINESS,
        "F": SeatType.FIRST,
    }.get((value or "").upper(), SeatType.ECONOMY)


def map_stops_enum(value: int | None):
    from fli.models import MaxStops

    if value == 0:
        return MaxStops.NON_STOP
    if value == 1:
        return MaxStops.ONE_STOP_OR_FEWER
    if value is not None and value >= 2:
        return MaxStops.TWO_OR_FEWER_STOPS
    return MaxStops.ANY


def map_sort_enum(value: str | None):
    from fli.models import SortBy

    return {
        "price": SortBy.CHEAPEST,
        "duration": SortBy.DURATION,
    }.get((value or "").lower(), SortBy.CHEAPEST)


def normalize_leg(leg: Any, cabin_class: str) -> dict[str, Any]:
    return {
        "airline": leg.airline.name.lstrip("_"),
        "airline_name": leg.airline.value,
        "flight_no": f"{leg.airline.name.lstrip('_')}{leg.flight_number}",
        "origin": leg.departure_airport.name,
        "destination": leg.arrival_airport.name,
        "origin_city": leg.departure_airport.value,
        "destination_city": leg.arrival_airport.value,
        "departure": leg.departure_datetime.isoformat(),
        "arrival": leg.arrival_datetime.isoformat(),
        "duration_seconds": int(leg.duration) * 60,
        "cabin_class": cabin_class,
        "aircraft": "",
    }


def normalize_route(flight: Any, cabin_class: str) -> dict[str, Any]:
    segments = [normalize_leg(leg, cabin_class) for leg in flight.legs]
    return {
        "segments": segments,
        "total_duration_seconds": int(flight.duration) * 60,
        "stopovers": int(flight.stops),
    }


def collect_airlines(flights: list[Any]) -> list[str]:
    seen: list[str] = []
    for flight in flights:
        for leg in flight.legs:
            code = leg.airline.name.lstrip("_")
            if code not in seen:
                seen.append(code)
    return seen


def normalize_offer(item: Any, offer_index: int, cabin_class: str, currency_fallback: str) -> dict[str, Any]:
    if isinstance(item, tuple):
        segments = list(item)
        outbound = segments[0]
        inbound = segments[1] if len(segments) > 1 else None
        price_segment = outbound if len(segments) == 2 else segments[-1]
        total_duration_seconds = sum(int(segment.duration) * 60 for segment in segments)
        total_stops = sum(int(segment.stops) for segment in segments)
        offer_currency = price_segment.currency or currency_fallback
        route_outbound = normalize_route(outbound, cabin_class)
        route_inbound = normalize_route(inbound, cabin_class) if inbound is not None else None
        owner_airline = outbound.legs[0].airline.name.lstrip("_") if outbound.legs else "?"
        return {
            "id": f"fli_offer_{offer_index}",
            "price": float(price_segment.price),
            "currency": offer_currency,
            "price_formatted": f"{offer_currency} {float(price_segment.price):.2f}",
            "outbound": route_outbound,
            "inbound": route_inbound,
            "airlines": collect_airlines(segments),
            "owner_airline": owner_airline,
            "bags_price": {},
            "availability_seats": None,
            "conditions": {"total_duration_seconds": str(total_duration_seconds), "total_stops": str(total_stops)},
            "is_locked": False,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "booking_url": "",
        }

    offer_currency = item.currency or currency_fallback
    owner_airline = item.legs[0].airline.name.lstrip("_") if item.legs else "?"
    return {
        "id": f"fli_offer_{offer_index}",
        "price": float(item.price),
        "currency": offer_currency,
        "price_formatted": f"{offer_currency} {float(item.price):.2f}",
        "outbound": normalize_route(item, cabin_class),
        "inbound": None,
        "airlines": collect_airlines([item]),
        "owner_airline": owner_airline,
        "bags_price": {},
        "availability_seats": None,
        "conditions": {},
        "is_locked": False,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "booking_url": "",
    }


def run_search(payload: dict[str, Any]) -> dict[str, Any]:
    fixture = load_fixture_module()
    if fixture is not None:
        return fixture.search_flights(payload)

    from fli.models import FlightSearchFilters, FlightSegment, PassengerInfo, TripType
    from fli.core.parsers import resolve_airport
    from fli.search import SearchFlights

    origin = payload["origin"].upper()
    destination = payload["destination"].upper()
    date_from = payload["dateFrom"]
    options = payload.get("options") or {}
    return_date = options.get("returnDate")
    cabin_class = map_cabin_class(options.get("cabinClass"))
    currency = (options.get("currency") or "USD").upper()

    segments = [
        FlightSegment(
            departure_airport=[[resolve_airport(origin), 0]],
            arrival_airport=[[resolve_airport(destination), 0]],
            travel_date=date_from,
        )
    ]
    trip_type = TripType.ONE_WAY
    if return_date:
        trip_type = TripType.ROUND_TRIP
        segments.append(
            FlightSegment(
                departure_airport=[[resolve_airport(destination), 0]],
                arrival_airport=[[resolve_airport(origin), 0]],
                travel_date=return_date,
            )
        )

    filters = FlightSearchFilters(
        trip_type=trip_type,
        passenger_info=PassengerInfo(
            adults=int(options.get("adults") or 1),
            children=int(options.get("children") or 0),
            infants_on_lap=int(options.get("infants") or 0),
        ),
        flight_segments=segments,
        stops=map_stops_enum(options.get("maxStopovers")),
        seat_type=map_cabin_enum(options.get("cabinClass")),
        sort_by=map_sort_enum(options.get("sort")),
        show_all_results=True,
    )

    results = SearchFlights().search(filters)
    if not results:
        offers: list[dict[str, Any]] = []
    else:
        offers = [normalize_offer(item, index + 1, cabin_class, currency) for index, item in enumerate(results)]

    if (options.get("sort") or "").lower() == "duration":
        offers.sort(key=lambda offer: offer["outbound"]["total_duration_seconds"])
    else:
        offers.sort(key=lambda offer: offer["price"])

    limit = options.get("limit")
    if isinstance(limit, int) and limit > 0:
        offers = offers[:limit]

    passenger_count = int(options.get("adults") or 1) + int(options.get("children") or 0) + int(options.get("infants") or 0)

    return {
        "search_id": f"fli:{origin}:{destination}:{date_from}",
        "offer_request_id": f"fli:{origin}:{destination}:{date_from}",
        "passenger_ids": [f"pas_{index + 1}" for index in range(passenger_count)],
        "origin": origin,
        "destination": destination,
        "currency": offers[0]["currency"] if offers else currency,
        "offers": offers,
        "total_results": len(offers),
        "search_params": {
            "dateFrom": date_from,
            **options,
            "requestedCabinClass": cabin_class,
        },
        "pricing_note": "Fli Google Flights search",
    }


def run_resolve(payload: dict[str, Any]) -> dict[str, Any]:
    fixture = load_fixture_module()
    if fixture is not None:
        return fixture.resolve_locations(payload["query"])

    from fli.models import Airport

    query = payload["query"].strip().lower()
    matches = []
    for airport in Airport:
        code = airport.name
        name = airport.value
        haystacks = [code.lower(), name.lower()]
        score = None
        if query == code.lower():
            score = 0
        elif code.lower().startswith(query):
            score = 1
        elif query in name.lower():
            score = 2
        elif query in code.lower():
            score = 3
        if score is None:
            continue
        matches.append((score, code, {
            "id": code,
            "type": "airport",
            "name": name,
            "city": name.replace(" Airport", ""),
            "code": code,
            "country": None,
        }))

    matches.sort(key=lambda item: (item[0], item[1]))
    return {
        "query": payload["query"],
        "locations": [item[2] for item in matches[:20]],
    }


def main() -> int:
    payload = json.load(sys.stdin)
    command = payload.get("command")
    if command == "search":
        json.dump(run_search(payload), sys.stdout)
        return 0
    if command == "resolve":
        json.dump(run_resolve(payload), sys.stdout)
        return 0
    raise ValueError(f"Unknown command: {command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
