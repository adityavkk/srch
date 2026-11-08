import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

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


if __name__ == "__main__":
    unittest.main()
