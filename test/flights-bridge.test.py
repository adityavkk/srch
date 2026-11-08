import importlib.util
import os
import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

path = Path(__file__).resolve().parent.parent / "src/lib/flights/fli-bridge.py"
spec = importlib.util.spec_from_file_location("fli_bridge", path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ValidatedFlightClientTest(unittest.TestCase):
    def client(self, payload):
        response = SimpleNamespace(
            status_code=200, text="response", raise_for_status=Mock()
        )
        underlying = Mock()
        underlying.post.return_value = response
        decoder = Mock(return_value=payload)
        return bridge.ValidatedFlightClient(underlying, decoder), underlying, response

    def test_missing_payload_is_not_no_inventory(self):
        client, underlying, response = self.client(None)
        with self.assertRaisesRegex(RuntimeError, "not zero available flights"):
            client.post(url="https://example.test", data="request")
        underlying.post.assert_called_once_with(
            url="https://example.test", data="request"
        )
        response.raise_for_status.assert_called_once()
        client.parse_payload.assert_called_once_with("response")

    def test_valid_empty_inventory_payload_is_preserved(self):
        client, _, response = self.client([None, None, None, None])
        self.assertIs(client.post(url="https://example.test"), response)

    def test_http_failure_is_preserved(self):
        client, _, response = self.client(None)
        response.raise_for_status.side_effect = RuntimeError("HTTP failure")
        with self.assertRaisesRegex(RuntimeError, "HTTP failure"):
            client.post(url="https://example.test")
        client.parse_payload.assert_not_called()

    def test_parser_failure_is_preserved(self):
        client, _, _ = self.client(None)
        client.parse_payload.side_effect = ValueError("Malformed payload")
        with self.assertRaisesRegex(ValueError, "Malformed payload"):
            client.post(url="https://example.test")


def flight(origin, destination, price):
    return SimpleNamespace(
        price=price, currency="USD", duration=240, stops=0,
        legs=[SimpleNamespace(
            airline=SimpleNamespace(name="AA", value="American Airlines"),
            flight_number="1326", duration=240,
            departure_airport=SimpleNamespace(name=origin, value=origin),
            arrival_airport=SimpleNamespace(name=destination, value=destination),
            departure_datetime=datetime(2026, 11, 25, 11),
            arrival_datetime=datetime(2026, 11, 25, 15),
        )],
    )


class SearchNormalizationTest(unittest.TestCase):
    def run_search(self, results, sparse=False):
        search = Mock(sparse_passenger_mix=sparse)
        search.search.return_value = results
        search.build_flight_booking_url.return_value = "https://www.google.com/travel/flights/booking"
        modules = {
            "fli.models": SimpleNamespace(
                FlightSearchFilters=lambda **kw: SimpleNamespace(**kw),
                FlightSegment=lambda **kw: SimpleNamespace(**kw),
                PassengerInfo=lambda **kw: SimpleNamespace(**kw),
                TripType=SimpleNamespace(ONE_WAY=1, ROUND_TRIP=2),
            ),
            "fli.core.parsers": SimpleNamespace(resolve_airport=lambda airport: airport),
            "fli.search": SimpleNamespace(SearchFlights=Mock(return_value=search, sparse_passenger_mix=True)),
            "fli.search._wire": SimpleNamespace(parse_first_wrb_payload=Mock()),
            "fli.search._tfs": SimpleNamespace(
                build_tfs=lambda filters: "family-token",
                page_url=lambda tfs, **kw: "https://www.google.com/travel/flights?tfs=" + tfs,
            ),
        }
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {"SRCH_FLI_FIXTURE": ""}), \
             patch.object(bridge, "map_cabin_enum", return_value="business"), \
             patch.object(bridge, "map_stops_enum", return_value="nonstop"), \
             patch.object(bridge, "map_sort_enum", return_value="price"):
            result = bridge.run_search({
                "origin": "JFK", "destination": "CUN", "dateFrom": "2026-11-25",
                "options": {"returnDate": "2026-12-02", "adults": 2, "children": 1,
                            "infants": 1, "cabinClass": "C", "currency": "EUR", "topN": 10},
            })
        return result, search

    def test_return_selection_sets_total_not_outbound_minimum(self):
        result, search = self.run_search([(flight("JFK", "CUN", 500), flight("CUN", "JFK", 650))])
        self.assertEqual(result["offers"][0]["price"], 650)
        self.assertEqual(result["offers"][0]["inbound"]["segments"][0]["origin"], "CUN")
        self.assertEqual(search.search.call_args.kwargs, {"currency": "EUR", "top_n": 10})
        link_args = search.build_flight_booking_url.call_args.kwargs
        self.assertEqual(link_args["seat_type"], "business")
        self.assertEqual(vars(link_args["passenger_info"]), {"adults": 2, "children": 1, "infants_on_lap": 1})

    def test_missing_return_price_is_not_replaced_with_outbound_price(self):
        result, _ = self.run_search([(flight("JFK", "CUN", 500), flight("CUN", "JFK", None))])
        self.assertEqual(result["offers"], [])
        self.assertEqual(result["status"], "pricing_unavailable")
        self.assertEqual(result["unpriced_count"], 1)
        self.assertTrue(result["unpriced_itineraries"][0]["booking_url"])

    def test_sparse_family_result_has_diagnostics_and_exact_search_link(self):
        result, _ = self.run_search(None, sparse=True)
        self.assertEqual(result["status"], "pricing_unavailable")
        self.assertEqual(result["search_params"]["adults"], 2)
        self.assertIn("family-token", result["search_url"])
        self.assertIn("Availability is unknown", result["warnings"][0])

    def test_genuine_empty_result_remains_distinct(self):
        result, _ = self.run_search(None)
        self.assertEqual(result["status"], "empty")


if __name__ == "__main__":
    unittest.main()
