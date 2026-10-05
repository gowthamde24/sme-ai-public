import copy
import hashlib
import json
from pathlib import Path
import random
import unittest

from quote_engine import ENGINE_VERSION, canonical_json, quote


class QuoteTests(unittest.TestCase):
    def setUp(self):
        self.r = json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())

    def codes(self, result):
        return {reason["code"] for reason in result["flags"]["reasons"]}

    def test_price_edges_and_minimum(self):
        for qty, price in ((1, 10000), (2, 10000), (3, 10000), (4, 10000),
                           (5, 9000), (6, 9000), (9, 9000), (10, 8000), (11, 8000)):
            with self.subTest(qty=qty):
                self.r["order_lines"][0]["qty"] = qty
                q = quote(self.r)
                line = q["lines"][0]
                self.assertEqual(line["unit_price_applied"], price)
                self.assertEqual(line["line_subtotal"], price * qty)
                self.assertEqual("BELOW_MINIMUM_ORDER_QUANTITY" in self.codes(q), qty < 3)
                self.assertEqual(line["price_break_applied"], None if qty < 5 else
                                 {"min_qty": 5 if qty < 10 else 10, "unit_price": price})

    def simple(self, price=1, tax=0):
        self.r["price_list"][0].update(unit_price=price, tax_bps=tax, price_breaks=[], minimum_order_quantity=1)
        self.r["order_lines"][0]["qty"] = 1
        self.r["policy"]["shipping"] = {"flat_fee": 0}

    def test_half_paise_rounding(self):
        self.simple()
        self.r["order_lines"][0]["discount_bps"] = 5000
        for mode, expected in (("half_up", 1), ("half_even", 0), ("down", 0)):
            self.r["policy"]["rounding_mode"] = mode
            self.assertEqual(quote(self.r)["lines"][0]["discount"], expected)
        self.simple(price=3)
        self.r["policy"]["rounding_mode"] = "half_even"
        self.assertEqual(quote(self.r)["lines"][0]["discount"], 2)
        self.r["order_lines"][0].pop("discount_bps")
        self.simple(tax=5000)
        self.r["policy"].pop("rounding_mode")
        self.assertEqual(quote(self.r)["lines"][0]["tax"], 1)
        self.r["policy"]["tax_mode"] = "inclusive"
        self.r["price_list"][0]["tax_bps"] = 10000
        self.assertEqual(quote(self.r)["lines"][0]["net"], 1)
        self.assertEqual(quote(self.r)["lines"][0]["tax"], 0)
        self.simple()
        self.r["policy"]["payment_terms"]["new_advance_bps"] = 5000
        self.assertEqual(quote(self.r)["payment_terms"]["advance_amount"], 1)

    def test_tax_known_values(self):
        self.simple(price=10000, tax=1250)
        exclusive = quote(self.r)
        self.assertEqual(exclusive["lines"][0]["tax"], 1250)
        self.r["price_list"][0]["unit_price"] = 11250
        self.r["policy"]["tax_mode"] = "inclusive"
        inclusive = quote(self.r)
        self.assertEqual(inclusive["lines"][0]["net"], 10000)
        self.assertEqual(inclusive["totals"]["total"], exclusive["totals"]["total"])

    def test_shipping_tax_modes_and_default(self):
        self.simple(price=10000, tax=1250)
        self.r["policy"]["shipping"] = {"flat_fee": 10000}
        default = quote(self.r)
        self.r["policy"]["shipping"]["tax_bps"] = 0
        explicit = quote(self.r)
        self.assertEqual(default["totals"], explicit["totals"])
        self.assertNotEqual(default["canonical_hash"], explicit["canonical_hash"])
        self.r["policy"]["shipping"]["tax_bps"] = 1250
        exclusive = quote(self.r)
        self.assertEqual(exclusive["totals"], {"subtotal": 10000, "discount": 0,
                         "net": 10000, "item_tax": 1250, "shipping_tax": 1250,
                         "tax": 2500, "shipping": 10000, "shipping_gross": 11250, "total": 22500})
        shipping_trace = next(t for t in exclusive["trace"] if t["rule_id"] == "shipping.tax.exclusive")
        self.assertEqual(shipping_trace["inputs"], {"fee": 10000, "tax_bps": 1250,
                         "net": 10000, "tax": 1250, "gross": 11250, "rounding": "half_up"})
        self.r["policy"]["tax_mode"] = "inclusive"
        self.r["price_list"][0]["unit_price"] = 11250
        self.r["policy"]["shipping"]["flat_fee"] = 11250
        inclusive = quote(self.r)
        for key in ("net", "item_tax", "shipping_tax", "tax", "shipping", "shipping_gross", "total"):
            self.assertEqual(inclusive["totals"][key], exclusive["totals"][key])
        self.assertTrue(any(t["rule_id"] == "shipping.tax.inclusive" for t in inclusive["trace"]))
        self.r["policy"]["shipping"]["free_above"] = 9999
        free = quote(self.r)["totals"]
        self.assertEqual((free["shipping"], free["shipping_tax"], free["shipping_gross"]), (0, 0, 0))

    def test_shipping_half_paise_rounding(self):
        self.simple(price=0)
        for mode, expected in (("half_up", 1), ("half_even", 0), ("down", 0)):
            self.r["policy"].update(rounding_mode=mode, tax_mode="exclusive")
            self.r["policy"]["shipping"] = {"flat_fee": 1, "tax_bps": 5000}
            self.assertEqual(quote(self.r)["totals"]["shipping_tax"], expected)
            self.r["policy"]["tax_mode"] = "inclusive"
            self.r["policy"]["shipping"]["tax_bps"] = 10000
            self.assertEqual(quote(self.r)["totals"]["shipping"], expected)
            self.assertEqual(quote(self.r)["totals"]["shipping_tax"], 1 - expected)

    def test_each_flag_and_boundaries(self):
        self.r["order_lines"][0]["discount_bps"] = 1000
        self.assertNotIn("DISCOUNT_ABOVE_CEILING", self.codes(quote(self.r)))
        self.r["order_lines"][0]["discount_bps"] = 1001
        self.assertIn("DISCOUNT_ABOVE_CEILING", self.codes(quote(self.r)))
        self.simple(price=10000)
        self.r["order_lines"][0]["discount_bps"] = 0
        self.r["policy"]["margin_floor_bps"] = 5000
        self.assertNotIn("MARGIN_BELOW_FLOOR", self.codes(quote(self.r)))
        self.r["policy"]["margin_floor_bps"] = 5001
        self.assertIn("MARGIN_BELOW_FLOOR", self.codes(quote(self.r)))
        self.r["customer"] = {"kind": "repeat", "credit_limit": 10000}
        self.assertNotIn("CREDIT_LIMIT_EXCEEDED", self.codes(quote(self.r)))
        self.r["customer"]["credit_limit"] = 9999
        self.assertIn("CREDIT_LIMIT_EXCEEDED", self.codes(quote(self.r)))
        self.r["order_lines"][0]["sku"] = "SYN-UNKNOWN"
        q = quote(self.r)
        self.assertEqual(q["status"], "rejected")
        self.assertEqual(q["codes"], ["UNKNOWN_SKU"])
        self.assertTrue(q["flags"]["needs_owner_approval"])

    def test_payment_dates_shipping(self):
        q = quote(self.r)
        self.assertEqual(q["payment_terms"], {"advance_amount": 8488, "balance": 25462, "due_date": "2026-02-14"})
        self.assertEqual(q["valid_until"], "2026-02-06")
        self.r["customer"] = {"kind": "repeat", "credit_limit": 100000}
        self.assertEqual(quote(self.r)["payment_terms"]["advance_amount"], 0)
        self.assertFalse(quote(self.r)["flags"]["needs_owner_approval"])
        self.r["customer"].pop("credit_limit")
        self.assertIn("CREDIT_LIMIT_EXCEEDED", self.codes(quote(self.r)))
        self.r["policy"]["payment_terms"]["repeat_advance_bps"] = 10000
        self.assertNotIn("CREDIT_LIMIT_EXCEEDED", self.codes(quote(self.r)))
        self.r["policy"]["shipping"]["free_above"] = 30000
        self.assertEqual(quote(self.r)["totals"]["shipping"], 200)
        self.r["policy"]["shipping"]["free_above"] = 29999
        self.assertEqual(quote(self.r)["totals"]["shipping"], 0)

    def test_rejections(self):
        changes = [(["order_lines", 0, "qty"], 0, "OUT_OF_RANGE"),
                   (["policy", "tax_mode"], "bad", "INVALID_CHOICE"),
                   (["as_of"], "2026-02-30", "INVALID_DATE"),
                   (["as_of"], "9999-12-31", "DATE_OVERFLOW"),
                   (["order_lines"], [], "EMPTY_ORDER"),
                   (["price_list", 0, "price_breaks", 0, "unit_price"], 10001, "INVALID_PRICE_BREAKS"),
                   (["price_list", 0, "price_breaks", 1, "min_qty"], 5, "INVALID_PRICE_BREAKS")]
        for path, value, code in changes:
            r = copy.deepcopy(self.r)
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(code=code):
                self.assertEqual(quote(r)["codes"], [code])
        self.r["order_lines"].append(copy.deepcopy(self.r["order_lines"][0]))
        self.assertEqual(quote(self.r)["codes"], ["DUPLICATE_ORDER_SKU"])
        self.r["order_lines"].pop()
        self.r["price_list"].append(copy.deepcopy(self.r["price_list"][0]))
        self.assertEqual(quote(self.r)["codes"], ["DUPLICATE_SKU"])
        self.r["price_list"].pop()
        self.r["policy"]["margin_floor_bps"] = 0
        self.r["price_list"][0].pop("cost")
        self.assertEqual(quote(self.r)["codes"], ["MISSING_COST"])
        self.r["policy"]["extra"] = 1
        self.assertEqual(quote(self.r)["codes"], ["INVALID_FIELDS"])

    def test_programmer_types(self):
        for bad in (True, "3", None):
            r = copy.deepcopy(self.r)
            r["order_lines"][0]["qty"] = bad
            with self.assertRaises(TypeError):
                quote(r)
        for bad in ((), object()):
            with self.assertRaises(TypeError):
                quote(bad)
        with self.assertRaises(TypeError):
            canonical_json(json.loads("1.5"))

    def test_round_trip_determinism_hash_and_no_mutation(self):
        before = copy.deepcopy(self.r)
        q = quote(self.r)
        encoded = canonical_json(q)
        self.assertEqual(q, json.loads(encoded))
        self.assertEqual(encoded, canonical_json(quote(json.loads(canonical_json(self.r)))))
        self.assertEqual(before, self.r)
        reordered = dict(reversed(list(self.r.items())))
        self.assertEqual(q, quote(reordered))
        self.assertEqual(q["canonical_hash"], hashlib.sha256(canonical_json(
            {"engine_version": ENGINE_VERSION, "inputs": self.r}).encode("utf-8")).hexdigest())
        self.assertEqual(q["canonical_hash"], "92eb047bc231e4004c9dd2bbbab0f54340ddc225dc8351e2d56a839954e15aa7")
        # Change every scalar leaf, including descriptive/unused input fields.
        def paths(value, path=()):
            if isinstance(value, dict):
                for key, item in value.items():
                    yield from paths(item, path + (key,))
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    yield from paths(item, path + (index,))
            else:
                yield path, value
        for path, value in paths(self.r):
            altered = copy.deepcopy(self.r)
            target = altered
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value + 1 if type(value) is int else value + "x"
            self.assertNotEqual(quote(altered)["canonical_hash"], q["canonical_hash"])
        self.assertTrue(all(t["rule_id"] and t["text"] and t["inputs"] for t in q["trace"]))

    def test_seeded_properties(self):
        rng = random.Random(9009)
        for _ in range(250):
            # Every case owns fresh requests; no calls to the mutable simple helper.
            r = copy.deepcopy(self.r)
            r["policy"]["tax_mode"] = rng.choice(["exclusive", "inclusive"])
            r["policy"]["rounding_mode"] = rng.choice(["half_up", "half_even", "down"])
            r["price_list"][0]["tax_bps"] = rng.randrange(10001)
            r["order_lines"][0].update(qty=rng.randrange(1, 40), discount_bps=rng.randrange(10001))
            second = copy.deepcopy(r["price_list"][0])
            second["sku"] = "SYN-B"
            r["price_list"].append(second)
            r["order_lines"].append({"sku": "SYN-B", "qty": rng.randrange(1, 40)})
            r["policy"]["shipping"]["tax_bps"] = rng.randrange(10001)
            before = copy.deepcopy(r)
            q = quote(r)
            again = quote(r)
            self.assertEqual(q, again)
            self.assertEqual(q["canonical_hash"], again["canonical_hash"])
            self.assertEqual(r, before)
            totals = q["totals"]
            self.assertEqual(totals["total"], sum(line["net"] + line["tax"] for line in q["lines"]) + totals["shipping"] + totals["shipping_tax"])
            self.assertEqual(totals["total"], sum(line["gross"] for line in q["lines"]) + totals["shipping_gross"])
            self.assertEqual(totals["tax"], sum(line["tax"] for line in q["lines"]) + totals["shipping_tax"])
            self.assertEqual(totals["item_tax"], sum(line["tax"] for line in q["lines"]))
            for key in ("net", "discount"):
                self.assertEqual(totals[key], sum(line[key] for line in q["lines"]))
            self.assertEqual(q["payment_terms"]["advance_amount"] + q["payment_terms"]["balance"], totals["total"])
            self.assertTrue(all(amount >= 0 for amount in totals.values()))
            self.assertTrue(all(line[key] >= 0 for line in q["lines"] for key in ("net", "tax", "discount", "gross")))
            permuted = copy.deepcopy(r)
            permuted["order_lines"].reverse()
            self.assertEqual(quote(permuted)["totals"], totals)
            price = q["lines"][0]["unit_price_applied"]
            r["order_lines"][0]["qty"] += 1
            self.assertLessEqual(quote(r)["lines"][0]["unit_price_applied"], price)
            # A unit exclusive gross becomes the inclusive catalog input.
            unit_request = copy.deepcopy(self.r)
            unit_request["price_list"][0].update(unit_price=rng.randrange(100000),
                tax_bps=rng.randrange(10001), price_breaks=[], minimum_order_quantity=1)
            unit_request["order_lines"][0]["qty"] = 1
            unit_request["policy"].update(tax_mode="exclusive", rounding_mode="half_up")
            unit_request["policy"]["shipping"] = {"flat_fee": 0}
            gross = quote(unit_request)["lines"][0]["gross"]
            unit_request["policy"]["tax_mode"] = "inclusive"
            unit_request["price_list"][0]["unit_price"] = gross
            self.assertEqual(quote(unit_request)["lines"][0]["gross"], gross)


if __name__ == "__main__":
    unittest.main()
