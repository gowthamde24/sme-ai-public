"""1.2.0: a shipping line whose amount is zero is not printed; everything else is exactly as in 1.1.0.

The three lines are "Shipping net", "GST on shipping (r%)" and "Shipping total", each judged by its own amount.
The engine always produces them (a fee of 0 is a zero amount, not a missing line) and the validator still demands the
single shipping.tax trace, so the only change is what is printed. All data is synthetic.
"""
import copy
import hashlib
import json
import random
import unittest

import quote_text as engine
import quote_text.v1_0_0 as v1_0_0
import quote_text.v1_1_0 as v1_1_0
from test_quote_text import expected_amounts, fixture, paise_tokens, request

SHIPPING_PREFIXES = ("Shipping net: ", "GST on shipping (", "Shipping total: ")


def shipping_request(fee, tax_bps, tax_mode=None):
    source = fixture()["engine_request"]
    source["policy"]["shipping"] = {"flat_fee": fee, "tax_bps": tax_bps}
    if tax_mode:
        source["policy"]["tax_mode"] = tax_mode
    return request(source)


def tax_only_request():
    """A shipping line with no net but a tax (not something the engine makes; the renderer still judges each line by itself)."""
    r = shipping_request(0, 0)
    q, tax = r["quote"], 7
    q["totals"].update(shipping_tax=tax, shipping_gross=tax, tax=q["totals"]["item_tax"] + tax)
    q["totals"]["total"] = q["totals"]["net"] + q["totals"]["shipping"] + q["totals"]["tax"]
    q["payment_terms"]["balance"] = q["totals"]["total"] - q["payment_terms"]["advance_amount"]
    freight = next(t for t in q["trace"] if t["rule_id"].startswith("shipping.tax."))
    freight["inputs"].update(tax=tax, gross=tax)
    return r


def without_zero_shipping(text):
    """The old text with exactly the shipping lines that print a zero amount taken out."""
    return "\n".join(line for line in text.split("\n")
                     if not (line.startswith(SHIPPING_PREFIXES) and line.endswith(": ₹0.00")))


def independent_hash(inputs, version):
    payload = json.dumps({"renderer_version": version, "inputs": inputs}, sort_keys=True,
                         separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def shipping_lines(text):
    return [line for line in text.split("\n") if line.startswith(SHIPPING_PREFIXES)]


class HideZeroTests(unittest.TestCase):
    def accepted(self, r, module=engine):
        q = module.render(r)
        self.assertEqual(set(q), {"text", "line_count", "canonical_hash"}, q)
        self.assertEqual(q["line_count"], len(q["text"].split("\n")))
        return q

    def test_all_three_zero_prints_no_shipping_line(self):
        for mode in ("exclusive", "inclusive"):
            for fee, bps in ((0, 0), (0, 500), (0, 10000)):
                with self.subTest(mode=mode, fee=fee, bps=bps):
                    r = shipping_request(fee, bps, mode)
                    self.assertEqual(r["quote"]["totals"]["shipping_gross"], 0)
                    new, old = self.accepted(r), self.accepted(r, v1_1_0)
                    self.assertNotIn("hipping", new["text"])
                    self.assertEqual(len(shipping_lines(old["text"])), 3)
                    self.assertEqual(new["text"], without_zero_shipping(old["text"]))
                    self.assertEqual(new["line_count"], old["line_count"] - 3)

    def test_all_zero_text_by_value(self):
        # the lines around the removed block, reviewed by eye: GST on merchandise is followed by GST total
        new = self.accepted(shipping_request(0, 0))
        lines = new["text"].split("\n")
        i = lines.index("Merchandise subtotal: ₹370.35")
        self.assertEqual(lines[i:i + 6], ["Merchandise subtotal: ₹370.35", "Discounts: ₹18.52", "Merchandise net: ₹351.83",
                                         "GST on merchandise: ₹43.98", "GST total: ₹43.98", "Grand total: ₹395.81"])

    def test_a_fee_without_tax_prints_net_and_total_but_not_the_zero_tax_line(self):
        for mode in ("exclusive", "inclusive"):
            with self.subTest(mode=mode):
                r = shipping_request(10100, 0, mode)
                t = r["quote"]["totals"]
                self.assertEqual((t["shipping"], t["shipping_tax"], t["shipping_gross"]), (10100, 0, 10100))
                new = self.accepted(r)
                self.assertEqual(shipping_lines(new["text"]), ["Shipping net: ₹101.00", "Shipping total: ₹101.00"])
                self.assertNotIn("GST on shipping", new["text"])
                self.assertEqual(new["text"], without_zero_shipping(self.accepted(r, v1_1_0)["text"]))

    def test_a_tax_without_net_prints_the_tax_and_total_lines_only(self):
        r = tax_only_request()
        new, old = self.accepted(r), self.accepted(r, v1_1_0)
        self.assertEqual(shipping_lines(new["text"]), ["GST on shipping (0%): ₹0.07", "Shipping total: ₹0.07"])
        self.assertEqual(new["text"], without_zero_shipping(old["text"]))
        self.assertEqual(new["line_count"], old["line_count"] - 1)

    def test_all_three_non_zero_is_identical_to_1_1_0_and_1_0_0(self):
        r = request()
        t = r["quote"]["totals"]
        self.assertTrue(t["shipping"] and t["shipping_tax"] and t["shipping_gross"])
        new = self.accepted(r)
        self.assertEqual(len(shipping_lines(new["text"])), 3)
        for older in (v1_1_0, v1_0_0):
            old = self.accepted(r, older)
            self.assertEqual((new["text"], new["line_count"]), (old["text"], old["line_count"]))
            self.assertNotEqual(new["canonical_hash"], old["canonical_hash"])

    def test_the_hash_carries_the_new_version(self):
        for r in (request(), shipping_request(0, 0)):
            q = self.accepted(r)
            self.assertEqual(q["canonical_hash"], independent_hash(r, "1.2.0"))
            self.assertEqual(self.accepted(r, v1_1_0)["canonical_hash"], independent_hash(r, "1.1.0"))

    def test_only_the_zero_lines_differ_from_1_1_0_over_seeded_quotes(self):
        rng = random.Random(1208)
        seen = {"hidden_all": 0, "hidden_some": 0, "hidden_none": 0}
        for case in range(300):
            fee = rng.choice((0, 0, rng.randint(1, 100000000), rng.randint(1, 50)))
            bps = rng.choice((0, 0, rng.randint(1, 10000), 500))
            source = fixture()["engine_request"]
            source["policy"]["shipping"] = {"flat_fee": fee, "tax_bps": bps}
            source["policy"]["tax_mode"] = rng.choice(("exclusive", "inclusive"))
            source["policy"]["rounding_mode"] = rng.choice(("half_up", "half_even", "down"))
            source["policy"]["payment_terms"]["new_advance_bps"] = rng.randint(0, 10000)
            r = request(source)
            original = copy.deepcopy(r)
            with self.subTest(case=case, fee=fee, bps=bps):
                new, old = self.accepted(r), self.accepted(r, v1_1_0)
                self.assertEqual(new["text"], without_zero_shipping(old["text"]))
                removed = len(shipping_lines(old["text"])) - len(shipping_lines(new["text"]))
                self.assertEqual(old["line_count"] - new["line_count"], removed)
                self.assertTrue(all(not line.endswith(": ₹0.00") for line in shipping_lines(new["text"])))
                self.assertEqual(paise_tokens(new["text"]), expected_amounts(r))
                self.assertEqual(r, original)
                seen["hidden_all" if removed == 3 else "hidden_some" if removed else "hidden_none"] += 1
        self.assertTrue(all(seen.values()), seen)

    def test_nothing_else_about_the_request_is_judged_differently(self):
        # the shipping trace is still required, and every refusal is the same code in 1.1.0 and 1.2.0
        def mutate_trace(r):
            r["quote"]["trace"] = [t for t in r["quote"]["trace"] if not t["rule_id"].startswith("shipping.tax.")]

        def mutate_total(r):
            r["quote"]["totals"]["shipping_gross"] += 1

        def mutate_hash(r):
            r["expected_engine_hash"] = "0" * 64

        def mutate_unsafe(r):
            r["display"]["customer_name"] = "Syn\u200bthetic"

        for base in (request(), shipping_request(0, 0)):
            for mutate in (mutate_trace, mutate_total, mutate_hash, mutate_unsafe):
                r = copy.deepcopy(base)
                mutate(r)
                with self.subTest(mutate=mutate.__name__):
                    new, old = engine.render(r), v1_1_0.render(r)
                    self.assertEqual(new["status"], "rejected")
                    self.assertEqual(new, old)


if __name__ == "__main__":
    unittest.main()
