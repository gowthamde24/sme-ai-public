import copy
import unittest

import quote_text as engine
from test_quote_text import fixture, request, paise_tokens, expected_amounts


class TextBoundsTests(unittest.TestCase):
    def accepted(self, r):
        q = engine.render(r)
        self.assertIn("text", q, q)
        self.assertTrue(all(len(line) <= 60 for line in q["text"].split("\n")))
        return q

    def rejected(self, r, code="OUT_OF_RANGE"):
        q = engine.render(r)
        self.assertEqual(q["status"], "rejected", q)
        self.assertEqual(q["code"], code)

    def test_string_limit_all_display_locations(self):
        for path in (("seller_name",), ("customer_name",), ("quote_ref",),
                     ("payment_terms_text",), ("line_labels", "SYN-TEXT-A"), ("notes", 0)):
            for size in (200, 201):
                r = request()
                target = r["display"]
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = "S" * size
                if size == 200:
                    self.accepted(r)
                else:
                    self.rejected(r)

    def test_note_count_limit(self):
        r = request()
        r["display"]["notes"] = ["Synthetic note"] * 10
        self.assertEqual(self.accepted(r)["text"].count("- Synthetic note"), 10)
        r["display"]["notes"].append("Synthetic")
        self.rejected(r)

    def test_quote_lines_limit_and_large_money(self):
        source = fixture()["engine_request"]
        source.update(price_list=[], order_lines=[])
        source["policy"]["discount_ceiling_bps"] = 10000
        for i in range(30):
            source["price_list"].append({"sku": "SYN-" + str(i), "name": "Synthetic", "unit_price": 100000000,
                                         "minimum_order_quantity": 1, "price_breaks": [], "tax_bps": 10000})
            source["order_lines"].append({"sku": "SYN-" + str(i), "qty": 10000})
        r = request(source)
        q = self.accepted(r)
        self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))
        r["quote"]["lines"].append(copy.deepcopy(r["quote"]["lines"][0]))
        self.rejected(r)
        r = request()
        r["quote"]["lines"] = []
        self.rejected(r, "INVALID_QUOTE")
        r = request()
        r["display"]["line_labels"] = {"SYN-" + str(i): "Synthetic" for i in range(31)}
        self.rejected(r)

    def test_trace_count_and_generated_text_limits(self):
        r = request()
        r["quote"]["trace"][0]["text"] = "S" * 4000
        self.accepted(r)
        r["quote"]["trace"][0]["text"] += "S"
        self.rejected(r)
        # Count preflight isolated: repeated traces are invalid semantic content,
        # but exactly MAX_TRACE does not exceed the structural budget.
        r = request()
        r["quote"]["trace"] = [copy.deepcopy(r["quote"]["trace"][0])] * 300
        engine._bounded(r)
        r["quote"]["trace"].append(copy.deepcopy(r["quote"]["trace"][0]))
        self.rejected(r)

    def test_depth_nodes_and_object_limits(self):
        for depth in (engine.MAX_DEPTH, engine.MAX_DEPTH + 1):
            value = None
            for _ in range(depth - 1):
                value = [value]
            r = {"x": value}
            if depth == engine.MAX_DEPTH:
                engine._bounded(r)
            else:
                self.rejected(r)
        for nodes in (engine.MAX_NODES, engine.MAX_NODES + 1):
            r = {"x": [[None] * 300 for _ in range(166)] + [[None] * (nodes - 169 - 49800)]}
            if nodes == engine.MAX_NODES:
                engine._bounded(r)
            else:
                self.rejected(r)
        engine._bounded({str(i): None for i in range(40)})
        self.rejected({str(i): None for i in range(41)})

    def test_oversize_precedes_validation_and_hash(self):
        requests = []
        for field, size in (("lines", 100000), ("trace", 100000)):
            r = request()
            r["quote"][field] = [object()] * size
            requests.append(r)
        r = request()
        r["display"]["notes"] = [object()] * 100000
        requests.append(r)
        r = request()
        r["quote"]["totals"]["total"] = 10 ** 30
        requests.append(r)
        saved_validate, saved_json = engine._validate, engine.canonical_json
        def forbidden(*args):
            raise AssertionError("Oversize reached validation/hash")
        try:
            engine._validate = engine.canonical_json = forbidden
            for r in requests:
                self.rejected(r)
        finally:
            engine._validate, engine.canonical_json = saved_validate, saved_json

    def test_amount_and_rate_upper_bounds(self):
        self.assertIsInstance(engine.money(engine.MAX_AMOUNT), str)
        self.assertEqual(engine.rate(10000), "100%")
        for function, value in ((engine.money, engine.MAX_AMOUNT + 1), (engine.rate, 10001)):
            with self.assertRaises(engine._Invalid) as caught:
                function(value)
            self.assertEqual(str(caught.exception), "OUT_OF_RANGE")

    def test_applied_breaks_flags_and_trace_amounts(self):
        source = fixture()["engine_request"]
        source["price_list"][0]["price_breaks"] = [{"min_qty": 3, "unit_price": 10000}]
        source["price_list"][0]["minimum_order_quantity"] = 4
        source["price_list"][0]["price_breaks"][0]["min_qty"] = 4
        r = request(source)
        self.assertTrue(r["quote"]["flags"]["needs_owner_approval"])
        self.accepted(r)  # Lane A may approve an exception; engine flag is not approval.
        source["order_lines"][0]["qty"] = 4
        r = request(source)
        self.accepted(r)
        r["quote"]["lines"][0]["price_break_applied"]["unknown"] = 1
        self.rejected(r, "INVALID_FIELDS")
        r = request()
        r["quote"]["flags"]["reasons"] = [{"code": "UNKNOWN"}]
        self.rejected(r, "INVALID_FIELDS")
        r = request()
        r["quote"]["trace"][0]["inputs"]["qty"] = True
        self.rejected(r, "INVALID_TYPE")
        r = request()
        tax = next(t for t in r["quote"]["trace"] if t["rule_id"] == "tax.exclusive")
        tax["inputs"]["net"] += 1
        self.rejected(r, "INVALID_QUOTE")

    def test_blank_strings_dates_and_output_bound(self):
        r = request()
        r["display"]["seller_name"] = " "
        self.rejected(r, "EMPTY_STRING")
        r = request()
        r["quote"]["payment_terms"]["due_date"] = "2026-10-01"
        self.rejected(r, "DATE_MISMATCH")
        r = request()
        r["quote"]["trace"] = [t for t in r["quote"]["trace"] if t["rule_id"] != "quote.validity"]
        self.rejected(r, "DATE_MISMATCH")
        # Computational cap is independent of owner policy; isolate final guard.
        saved = engine.MAX_OUTPUT_LINES
        try:
            engine.MAX_OUTPUT_LINES = 1
            self.rejected(request())
        finally:
            engine.MAX_OUTPUT_LINES = saved
