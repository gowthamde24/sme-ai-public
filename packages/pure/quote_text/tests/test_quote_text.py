import copy
import importlib.util
import json
from pathlib import Path
import random
import re
import unittest

import quote_text as engine

# Test-only real engine import; the renderer itself has no cross-package imports.
_path = Path(__file__).resolve().parents[3] / "quote-engine" / "src" / "quote_engine" / "__init__.py"
_spec = importlib.util.spec_from_file_location("synthetic_quote_engine", _path)
quote_engine = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(quote_engine)


# The pinned hash of the fixture request per renderer version (the version is part of the hashed payload);
# the 1.0.0 value is the one that was pinned before 1.1.0 existed and stays so (test_legacy_1_0_0 re-runs this file).
GOLDEN_HASH = {"1.0.0": "376e2b72ffc0a880941cb254f891811cdeb99ad3d195b2312d39cd0cf7c3b17f",
               "1.1.0": "6cab990d149f3ef9ef56a4087d1382241b1705921caa18573a32f3030ceb58aa"}


def fixture():
    return json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())


def request(source=None):
    f = fixture()
    source = f["engine_request"] if source is None else source
    quote = quote_engine.quote(source)
    assert quote["status"] == "draft", quote
    display = copy.deepcopy(f["display"])
    display.update(issued_on=source["as_of"], valid_until=quote["valid_until"],
                   line_labels={line["sku"]: "Synthetic label " + str(i) for i, line in enumerate(quote["lines"])})
    return {"quote": quote, "approved": True, "expected_engine_hash": quote["canonical_hash"], "display": display}


def paise_tokens(text):
    result = []
    for token in re.findall(r"₹[0-9,]+\.[0-9]{2}", text):
        whole, fraction = token[1:].replace(",", "").split(".")
        result.append(int(whole) * 100 + int(fraction))
    return result


def expected_amounts(r):
    q = r["quote"]
    result = []
    for line in q["lines"]:
        result += [line["unit_price_applied"], line["line_subtotal"]]
        if line["discount"]:
            result.append(line["discount"])
        result += [line["net"], line["tax"], line["gross"]]
    t = q["totals"]
    result.append(t["subtotal"])
    if t["discount"]:
        result.append(t["discount"])
    result += [t[key] for key in ("net", "item_tax", "shipping", "shipping_tax", "shipping_gross", "tax", "total")]
    if "payment_terms" in q:
        result += [q["payment_terms"][key] for key in ("advance_amount", "balance")]
    return result


class FormatTests(unittest.TestCase):
    def test_money_boundaries(self):
        for paise, expected in ((0, "₹0.00"), (1, "₹0.01"), (99, "₹0.99"), (100, "₹1.00"),
                                (99999, "₹999.99"), (9999900, "₹99,999.00"),
                                (10000000, "₹1,00,000.00"), (100000000, "₹10,00,000.00"),
                                (10000000000, "₹10,00,00,000.00")):
            with self.subTest(paise=paise):
                self.assertEqual(engine.money(paise), expected)

    def test_rate_boundaries(self):
        for bps, expected in ((0, "0%"), (1, "0.01%"), (10, "0.1%"), (99, "0.99%"),
                              (100, "1%"), (500, "5%"), (1250, "12.5%"), (10000, "100%")):
            self.assertEqual(engine.rate(bps), expected)

    def test_strict_format_types(self):
        for function in (engine.money, engine.rate):
            for value in (True, "1", None):
                with self.assertRaises(engine._Invalid) as caught:
                    function(value)
                self.assertEqual(str(caught.exception), "INVALID_TYPE")
            with self.assertRaises(engine._Invalid):
                function(-1)


class RenderTests(unittest.TestCase):
    def accepted(self, r):
        q = engine.render(r)
        self.assertEqual(set(q), {"text", "line_count", "canonical_hash"}, q)
        self.assertEqual(q["line_count"], len(q["text"].split("\n")))
        self.assertTrue(all(len(line) <= 60 for line in q["text"].split("\n")))
        return q

    def rejected(self, r, code):
        q = engine.render(r)
        self.assertEqual(q["status"], "rejected", q)
        self.assertEqual(q["code"], code)
        self.assertNotIn("text", q)
        self.assertNotIn("canonical_hash", q)
        return q

    def test_sections_and_exact_engine_amounts(self):
        r = request()
        q = self.accepted(r)
        self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))
        for label in ("Approved quote", "Seller: Synthetic Seller", "Customer: Synthetic Customer", "Reference: SYN-Q-001",
                      "Issued: 2026-10-07", "Valid until: 2026-10-14", "Synthetic label 0",
                      "3 x ₹123.45 = ₹370.35", "Discount (5%)", "GST (12.5%)", "Merchandise subtotal:",
                      "Merchandise net:", "Discounts:", "GST on merchandise:", "GST on shipping (5%):", "Shipping net:",
                      "Shipping total:", "GST total:", "Grand total:", "Advance:", "Balance:", "Balance due: 2026-10-22",
                      "Payment terms: Synthetic terms agreed by the owner.", "Notes:", "- Synthetic demonstration only."):
            self.assertIn(label, q["text"])
        self.assertNotIn("mailto:", q["text"])
        self.assertNotIn("http", q["text"])
        self.assertNotIn("SYN-TEXT-A", q["text"])
        self.assertEqual(q["text"].count("Valid until: 2026-10-14"), 2)

    def test_no_discount_or_notes_without_input(self):
        source = fixture()["engine_request"]
        source["order_lines"][0]["discount_bps"] = 0
        r = request(source)
        r["display"]["notes"] = []
        q = self.accepted(r)
        self.assertNotIn("Discount", q["text"])
        self.assertNotIn("Notes:", q["text"])
        self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))

    def test_one_paise_discount_is_shown(self):
        source = fixture()["engine_request"]
        source["price_list"][0].update(unit_price=1, tax_bps=0)
        source["order_lines"][0].update(qty=1, discount_bps=10000)
        source["policy"]["discount_ceiling_bps"] = 10000
        source["policy"]["shipping"] = {"flat_fee": 0, "tax_bps": 0}
        r = request(source)
        q = self.accepted(r)
        self.assertIn("Discount (100%): ₹0.01", q["text"])
        self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))

    def test_payment_amounts_optional_and_zero(self):
        r = request()
        del r["quote"]["payment_terms"]
        q = self.accepted(r)
        self.assertNotIn("Advance:", q["text"])
        self.assertNotIn("Balance:", q["text"])
        self.assertNotIn("Balance due:", q["text"])
        source = fixture()["engine_request"]
        source["policy"]["payment_terms"]["new_advance_bps"] = 0
        r = request(source)
        self.assertIn("Advance: ₹0.00", self.accepted(r)["text"])

    def test_inclusive_exclusive_and_mixed_rates(self):
        for mode in ("inclusive", "exclusive"):
            source = fixture()["engine_request"]
            source["policy"]["tax_mode"] = mode
            item = copy.deepcopy(source["price_list"][0])
            item.update(sku="SYN-TEXT-B", tax_bps=500)
            source["price_list"].append(item)
            source["order_lines"].append({"sku": "SYN-TEXT-B", "qty": 2})
            r = request(source)
            q = self.accepted(r)
            self.assertIn("Prices include GST" if mode == "inclusive" else "Prices exclude GST", q["text"])
            self.assertIn("GST (12.5%)", q["text"])
            self.assertIn("GST (5%)", q["text"])
            self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))

    def test_approval_and_engine_status_refused(self):
        r = request()
        r["approved"] = False
        self.assertEqual(self.rejected(r, "NOT_APPROVED")["message"], "Quote is not approved.")
        for status in ("approved", "rejected", "superseded", "sent"):
            r = request()
            r["quote"]["status"] = status
            self.rejected(r, "NOT_APPROVED")
        r = request()
        r["quote"] = {"status": "rejected", "codes": ["UNKNOWN_SKU"]}
        self.rejected(r, "NOT_APPROVED")

    def test_hash_mismatch_fixed_error(self):
        for key in ("expected_engine_hash", "canonical_hash"):
            for value in ("0" * 64, "wrong", "A" * 64):
                r = request()
                target = r if key == "expected_engine_hash" else r["quote"]
                target[key] = value
                self.assertEqual(self.rejected(r, "HASH_MISMATCH")["message"], "Quote hash does not match approval.")

    def test_matching_malformed_hashes_refused(self):
        for value in ("wrong", "A" * 64, "a" * 63, "a" * 65):
            r = request()
            r["quote"]["canonical_hash"] = r["expected_engine_hash"] = value
            self.assertEqual(self.rejected(r, "HASH_MISMATCH")["message"], "Quote hash does not match approval.")

    def test_whatsapp_markup_neutralization_all_display_locations(self):
        r = request()
        value = "*Synthetic* _name_ ~style~ `tag`"
        for key in ("seller_name", "customer_name", "quote_ref", "payment_terms_text"):
            r["display"][key] = value
        r["display"]["line_labels"]["SYN-TEXT-A"] = value
        r["display"]["notes"] = [value]
        text = self.accepted(r)["text"]
        for char in "*_~`":
            self.assertNotIn(char, text)
        self.assertEqual(text.count("Synthetic name style tag"), 6)
        r["display"]["seller_name"] = "*_~`"
        self.rejected(r, "EMPTY_STRING")

    def test_hostile_controls_bidi_and_line_separators(self):
        for char in ("\n", "\r", "\t", "\x00", "\x1b", "\x7f", "\u202e", "\u202a", "\u2066", "\u2069", "\u200e", "\u200f", "\u2028", "\u2029", "\ud800"):
            for target in ("seller_name", "line_label", "note", "engine_name"):
                r = request()
                if target == "line_label":
                    r["display"]["line_labels"]["SYN-TEXT-A"] = "Synthetic" + char
                elif target == "note":
                    r["display"]["notes"] = ["Synthetic" + char]
                elif target == "engine_name":
                    r["quote"]["lines"][0]["name"] = "Synthetic" + char
                else:
                    r["display"][target] = "Synthetic" + char
                self.rejected(r, "UNSAFE_STRING")

    def test_long_words_wrap_and_money_tokens_remain_whole(self):
        r = request()
        for key in ("seller_name", "customer_name", "quote_ref", "payment_terms_text"):
            r["display"][key] = "S" * 200
        r["display"]["line_labels"]["SYN-TEXT-A"] = "L" * 200
        r["display"]["notes"] = ["N" * 200] * 10
        q = self.accepted(r)
        self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))
        self.assertEqual(q["text"].split("Notes:\n", 1)[1].count("N"), 2000)
        self.assertTrue(all(len(line) <= 60 for line in q["text"].split("\n")))

    def test_dates_and_required_labels(self):
        for key in ("issued_on", "valid_until"):
            r = request()
            r["display"][key] = "2026-02-30"
            self.rejected(r, "INVALID_DATE")
        for key, value in (("issued_on", "2026-10-08"), ("valid_until", "2026-10-15"), ("valid_until", "2026-10-01")):
            r = request()
            r["display"][key] = value
            self.rejected(r, "DATE_MISMATCH")
        r = request()
        r["display"]["line_labels"] = {}
        self.rejected(r, "INVALID_FIELDS")
        r = request()
        r["display"]["line_labels"]["unknown"] = "Synthetic"
        self.rejected(r, "INVALID_FIELDS")

    def test_unknown_keys_every_object(self):
        for path in ((), ("quote",), ("display",), ("quote", "lines", 0), ("quote", "totals"),
                     ("quote", "payment_terms"), ("quote", "flags"), ("quote", "trace", 0), ("quote", "trace", 0, "inputs")):
            r = request()
            target = r
            for key in path:
                target = target[key]
            target["unknown"] = 1
            self.rejected(r, "INVALID_FIELDS")

    def test_wrong_types_and_no_float(self):
        self.rejected([], "INVALID_TYPE")
        for path, value in ((("approved",), 1), (("quote", "lines", 0, "quantity"), True),
                            (("quote", "lines", 0, "unit_price_applied"), json.loads("1.5")),
                            (("quote", "totals", "total"), "100"), (("display", "notes"), {}),
                            (("display", "seller_name"), False), (("quote", "engine_version"), True)):
            r = request()
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.rejected(r, "INVALID_TYPE")

    def test_bad_money_and_totals_invariants(self):
        for path, value, code in ((("lines", 0, "net"), -1, "OUT_OF_RANGE"),
                                  (("lines", 0, "quantity"), 0, "OUT_OF_RANGE"),
                                  (("lines", 0, "line_subtotal"), 10, "INVALID_QUOTE"),
                                  (("lines", 0, "gross"), 10, "INVALID_QUOTE"),
                                  (("lines", 0, "discount"), 999999, "INVALID_QUOTE"),
                                  (("totals", "subtotal"), 1, "INVALID_QUOTE"),
                                  (("totals", "discount"), 1, "INVALID_QUOTE"),
                                  (("totals", "net"), 1, "INVALID_QUOTE"),
                                  (("totals", "item_tax"), 1, "INVALID_QUOTE"),
                                  (("totals", "shipping_gross"), 1, "INVALID_QUOTE"),
                                  (("totals", "total"), 1, "INVALID_QUOTE"),
                                  (("totals", "tax"), 1, "INVALID_QUOTE"),
                                  (("payment_terms", "balance"), 1, "INVALID_QUOTE")):
            r = request()
            target = r["quote"]
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.rejected(r, code)

    def test_quantity_times_price_invariant(self):
        r = request()
        r["quote"]["lines"][0]["quantity"] += 1
        self.rejected(r, "INVALID_QUOTE")

    def test_trace_and_flag_validation(self):
        r = request()
        r["quote"]["engine_version"] = "1.2.0"
        self.rejected(r, "UNSUPPORTED_ENGINE")
        r = request()
        r["quote"]["trace"].append(copy.deepcopy(r["quote"]["trace"][0]))
        self.rejected(r, "INVALID_QUOTE")
        r = request()
        r["quote"]["flags"]["needs_owner_approval"] = True
        self.rejected(r, "INVALID_QUOTE")
        r = request()
        tax = next(t for t in r["quote"]["trace"] if t["rule_id"] == "tax.exclusive")
        tax["inputs"]["tax_bps"] = 10001
        self.rejected(r, "OUT_OF_RANGE")
        r = request()
        r["quote"]["trace"] = [t for t in r["quote"]["trace"] if not t["rule_id"].startswith("tax.")]
        self.rejected(r, "INVALID_QUOTE")

    def test_determinism_hash_roundtrip_and_immutability(self):
        r = request()
        original = copy.deepcopy(r)
        q = self.accepted(r)
        self.assertEqual(q, engine.render(r))
        self.assertEqual(q, engine.render(json.loads(engine.canonical_json(r))))
        self.assertEqual(q, json.loads(engine.canonical_json(q)))
        self.assertEqual(r, original)
        self.assertEqual(q["canonical_hash"], GOLDEN_HASH[engine.RENDERER_VERSION])
        r["display"]["quote_ref"] = "SYN-Q-002"
        self.assertNotEqual(q["canonical_hash"], self.accepted(r)["canonical_hash"])

    def test_250_seeded_roundtrip_amounts(self):
        rng = random.Random(1010)
        for case in range(250):
            source = fixture()["engine_request"]
            source.update(price_list=[], order_lines=[])
            source["policy"]["discount_ceiling_bps"] = 10000
            source["policy"]["tax_mode"] = rng.choice(("exclusive", "inclusive"))
            source["policy"]["rounding_mode"] = rng.choice(("half_up", "half_even", "down"))
            source["policy"]["shipping"] = {"flat_fee": rng.randint(0, 100000000), "tax_bps": rng.randint(0, 10000)}
            source["policy"]["payment_terms"]["new_advance_bps"] = rng.randint(0, 10000)
            for i in range(rng.randint(1, 30)):
                sku = "SYN-" + str(i)
                source["price_list"].append({"sku": sku, "name": "Synthetic", "unit_price": rng.randint(0, 100000000),
                                             "minimum_order_quantity": 1, "price_breaks": [], "tax_bps": rng.randint(0, 10000)})
                source["order_lines"].append({"sku": sku, "qty": rng.randint(1, 10000), "discount_bps": rng.randint(0, 10000)})
            r = request(source)
            original = copy.deepcopy(r)
            with self.subTest(case=case):
                q = self.accepted(r)
                self.assertEqual(paise_tokens(q["text"]), expected_amounts(r))
                self.assertEqual(q, engine.render(r))
                self.assertEqual(r, original)
