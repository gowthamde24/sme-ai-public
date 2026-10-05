import copy
import json
from pathlib import Path
import unittest

import quote_engine as engine


class BoundsTests(unittest.TestCase):
    def setUp(self):
        self.r = json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())

    def assert_bound(self, path, limit, prepare=None):
        for value, status in ((limit, "draft"), (limit + 1, "rejected")):
            r = copy.deepcopy(self.r)
            if prepare:
                prepare(r, value)
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path, value=value):
                q = engine.quote(r)
                self.assertEqual(q["status"], status)
                if status == "rejected":
                    self.assertEqual(q["codes"], ["OUT_OF_RANGE"])

    def test_quantity_bound(self):
        self.assert_bound(("order_lines", 0, "qty"), engine.MAX_QUANTITY_PER_LINE)
        self.assert_bound(("price_list", 0, "minimum_order_quantity"), engine.MAX_QUANTITY_PER_LINE,
                          lambda r, v: r["price_list"][0].update(price_breaks=[]))
        self.assert_bound(("price_list", 0, "price_breaks", 1, "min_qty"), engine.MAX_QUANTITY_PER_LINE)

    def test_unit_price_bound(self):
        for field in ("unit_price", "cost"):
            self.assert_bound(("price_list", 0, field), engine.MAX_UNIT_PRICE)
        self.assert_bound(("price_list", 0, "price_breaks", 0, "unit_price"), engine.MAX_UNIT_PRICE,
                          lambda r, v: r["price_list"][0].update(unit_price=engine.MAX_UNIT_PRICE))

    def test_tax_bound(self):
        self.assert_bound(("price_list", 0, "tax_bps"), engine.MAX_TAX_BPS)
        self.assert_bound(("policy", "shipping", "tax_bps"), engine.MAX_TAX_BPS)

    def test_discount_and_percentage_bounds(self):
        for path in (("order_lines", 0, "discount_bps"), ("policy", "discount_ceiling_bps"),
                     ("policy", "margin_floor_bps"),
                     ("policy", "payment_terms", "new_advance_bps"),
                     ("policy", "payment_terms", "repeat_advance_bps")):
            self.assert_bound(path, engine.MAX_DISCOUNT_BPS)

    def test_shipping_bounds(self):
        for field in ("flat_fee", "free_above"):
            self.assert_bound(("policy", "shipping", field), engine.MAX_SHIPPING_AMOUNT)

    def test_payment_day_bound(self):
        self.assert_bound(("policy", "payment_terms", "net_days"), engine.MAX_PAYMENT_NET_DAYS)

    def test_validity_day_bound(self):
        self.assert_bound(("policy", "validity_days"), engine.MAX_VALIDITY_DAYS)

    def test_credit_bound(self):
        self.assert_bound(("customer", "credit_limit"), engine.MAX_CREDIT_LIMIT)

    def test_identifier_bounds(self):
        for size in (engine.MAX_IDENTIFIER_LENGTH, engine.MAX_IDENTIFIER_LENGTH + 1):
            for field in ("sku", "name"):
                r = copy.deepcopy(self.r)
                r["price_list"][0][field] = "S" * size
                if field == "sku":
                    r["order_lines"][0]["sku"] = "S" * size
                q = engine.quote(r)
                self.assertEqual(q["status"], "draft" if size == engine.MAX_IDENTIFIER_LENGTH else "rejected")
                if q["status"] == "rejected":
                    self.assertEqual(q["codes"], ["OUT_OF_RANGE"])
        self.r["order_lines"][0]["sku"] = "S" * (engine.MAX_IDENTIFIER_LENGTH + 1)
        self.assertEqual(engine.quote(self.r)["codes"], ["OUT_OF_RANGE"])

    def test_catalog_size_bound(self):
        for size in (engine.MAX_CATALOG_ITEMS, engine.MAX_CATALOG_ITEMS + 1):
            r = copy.deepcopy(self.r)
            r["price_list"] = [dict(copy.deepcopy(r["price_list"][0]), sku="S" + str(i)) for i in range(size)]
            r["order_lines"][0]["sku"] = "S0"
            q = engine.quote(r)
            self.assertEqual(q["status"], "draft" if size == engine.MAX_CATALOG_ITEMS else "rejected")
            if q["status"] == "rejected":
                self.assertEqual(q["codes"], ["OUT_OF_RANGE"])

    def test_order_size_bound(self):
        for size in (engine.MAX_ORDER_LINES, engine.MAX_ORDER_LINES + 1):
            r = copy.deepcopy(self.r)
            r["price_list"] = [dict(copy.deepcopy(r["price_list"][0]), sku="S" + str(i)) for i in range(size)]
            r["order_lines"] = [{"sku": "S" + str(i), "qty": 3} for i in range(size)]
            q = engine.quote(r)
            self.assertEqual(q["status"], "draft" if size == engine.MAX_ORDER_LINES else "rejected")
            if q["status"] == "rejected":
                self.assertEqual(q["codes"], ["OUT_OF_RANGE"])

    def test_break_size_bound(self):
        for size in (engine.MAX_PRICE_BREAKS_PER_ITEM, engine.MAX_PRICE_BREAKS_PER_ITEM + 1):
            r = copy.deepcopy(self.r)
            r["price_list"][0]["price_breaks"] = [{"min_qty": i + 3, "unit_price": 10000 - i} for i in range(size)]
            q = engine.quote(r)
            self.assertEqual(q["status"], "draft" if size == engine.MAX_PRICE_BREAKS_PER_ITEM else "rejected")
            if q["status"] == "rejected":
                self.assertEqual(q["codes"], ["OUT_OF_RANGE"])

    def test_first_break_moq(self):
        for minimum, status in ((2, "rejected"), (3, "draft"), (4, "draft")):
            self.r["price_list"][0]["price_breaks"][0]["min_qty"] = minimum
            q = engine.quote(self.r)
            self.assertEqual(q["status"], status)
            if status == "rejected":
                self.assertEqual(q["codes"], ["INVALID_PRICE_BREAKS"])

    def test_oversize_rejected_before_hash_or_item_work(self):
        # Structural checks, not wall-clock assertions: poison elements must not
        # be visited, and neither hashing nor business calculation may run.
        requests = []
        for field in ("price_list", "order_lines"):
            r = copy.deepcopy(self.r)
            r[field] = [object()] * 100_000
            requests.append(r)
        r = copy.deepcopy(self.r)
        r["price_list"] = [object()]
        r["order_lines"] = [object()] * 100_000
        requests.append(r)
        r = copy.deepcopy(self.r)
        r["price_list"][0]["price_breaks"] = [object()] * 100_000
        requests.append(r)
        for path in (("order_lines", 0, "qty"), ("price_list", 0, "unit_price"),
                     ("policy", "payment_terms", "net_days")):
            r = copy.deepcopy(self.r)
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = 10 ** 30
            requests.append(r)
        for r in requests:
            saved_json, saved_validate = engine.canonical_json, engine._validate
            def forbidden(*args):
                raise AssertionError("oversized request reached hashing or item work")
            try:
                engine.canonical_json = engine._validate = forbidden
                q = engine.quote(r)
            finally:
                engine.canonical_json, engine._validate = saved_json, saved_validate
            self.assertEqual(q["codes"], ["OUT_OF_RANGE"])
            self.assertIsNone(q["canonical_hash"])

    def test_malformed_depth_and_object_size(self):
        r = copy.deepcopy(self.r)
        nested = 0
        for _ in range(engine.MAX_INPUT_DEPTH + 1):
            nested = [nested]
        r["extra"] = nested
        self.assertEqual(engine.quote(r)["codes"], ["OUT_OF_RANGE"])
        r = {"S" + str(i): None for i in range(engine.MAX_OBJECT_FIELDS + 1)}
        self.assertEqual(engine.quote(r)["codes"], ["OUT_OF_RANGE"])
