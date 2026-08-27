"""Offline tests: decision-record verification against a real captured
response, and JS-exact number rendering (ground truth generated with Node)."""

import copy
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from worthune import Worthune, _js_number_repr, canonical_json, verify_record  # noqa: E402

FIXTURE = json.loads(
    (pathlib.Path(__file__).parent / "fixture-relocation.json").read_text()
)

# Expected strings generated with `node -e 'console.log(String(v))'`.
JS_NUMBER_CASES = [
    (0.07, "0.07"),
    (4600.0, "4600"),
    (32409.87, "32409.87"),
    (0.00005, "0.00005"),
    (5e-7, "5e-7"),
    (1e21, "1e+21"),
    (1.5e21, "1.5e+21"),
    (123.456, "123.456"),
    (100.0, "100"),
    (-0.0, "0"),
    (1e-6, "0.000001"),
    (9007199254740991.0, "9007199254740991"),
    (2.5e-8, "2.5e-8"),
    (-42.75, "-42.75"),
    (0.1, "0.1"),
    (3e20, "300000000000000000000"),
]


class TestDecisionRecord(unittest.TestCase):
    def test_fixture_verifies(self):
        self.assertTrue(FIXTURE["ok"])
        self.assertTrue(verify_record(FIXTURE))

    def test_tampering_detected(self):
        tampered = copy.deepcopy(FIXTURE)
        tampered["outputs"]["breakEvenMonths"] = 1
        self.assertFalse(verify_record(tampered))

    def test_key_order_independent(self):
        reordered = copy.deepcopy(FIXTURE)
        reordered["inputs"] = dict(reversed(list(reordered["inputs"].items())))
        self.assertTrue(verify_record(reordered))


class TestJsNumberRepr(unittest.TestCase):
    def test_matches_ecmascript(self):
        for value, expected in JS_NUMBER_CASES:
            self.assertEqual(_js_number_repr(value), expected, msg=repr(value))

    def test_ints_pass_through_canonical_json(self):
        self.assertEqual(canonical_json({"a": 4600, "b": True, "c": None}), '{"a":4600,"b":true,"c":null}')

    def test_canonical_sorts_recursively(self):
        self.assertEqual(
            canonical_json({"b": 1, "a": {"d": [2, {"z": 3, "y": 4}], "c": 5}}),
            '{"a":{"c":5,"d":[2,{"y":4,"z":3}]},"b":1}',
        )


class TestPatchHousehold(unittest.TestCase):
    def test_patch_wire_shape(self):
        # Offline: stub the transport and assert the wire shape —
        # set_fields maps to the "set" key, PATCH method, versioned path.
        calls = []
        client = Worthune(api_key="wk_test")

        def fake_request(path, payload=None, method=None):
            calls.append((path, payload, method))
            return b'{"ok": true, "changed": ["set.state"]}'

        client._request = fake_request  # type: ignore[method-assign]
        out = client.patch_household(
            7, 4, set_fields={"state": "TX"}, remove={"liabilities": ["auto"]}
        )
        self.assertEqual(out["ok"], True)
        path, payload, method = calls[0]
        self.assertEqual(path, "/api/v1/households/7")
        self.assertEqual(method, "PATCH")
        self.assertEqual(
            payload,
            {"expectedVersion": 4, "set": {"state": "TX"}, "remove": {"liabilities": ["auto"]}},
        )


class TestDecideHousehold(unittest.TestCase):
    def test_decide_wire_shape(self):
        calls = []
        client = Worthune(api_key="wk_test")

        def fake_request(path, payload=None, method=None):
            calls.append((path, payload, method))
            return b'{"ok": true, "strategy": "ss-claiming"}'

        client._request = fake_request  # type: ignore[method-assign]
        out = client.decide_household(
            9,
            "ss-claiming",
            {"startYear": 2027, "years": 30},
            params={"candidateAges": {"p": [62, 67, 70]}},
        )
        self.assertEqual(out["ok"], True)
        path, payload, _method = calls[0]
        self.assertEqual(path, "/api/v1/households/9/decisions")
        self.assertEqual(
            payload,
            {
                "strategy": "ss-claiming",
                "horizon": {"startYear": 2027, "years": 30},
                "params": {"candidateAges": {"p": [62, 67, 70]}},
            },
        )


if __name__ == "__main__":
    unittest.main()
