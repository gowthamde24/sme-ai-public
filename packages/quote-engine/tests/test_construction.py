"""Job CN: the construction calculator (quote_engine.construction). Worked examples are checked by hand; the golden vectors are replayed exactly; invariants are tried on thousands of random requests."""

import ast
import copy
import hashlib
import json
from pathlib import Path
import random
import unittest

from quote_engine import construction
from quote_engine.construction import CONSTRUCTION_ENGINE_VERSION, calculate, canonical_json

HERE = Path(__file__).parent
VECTORS = json.loads((HERE / "fixtures" / "construction_vectors.json").read_text(encoding="utf-8"))["vectors"]


def vector(name):
    return copy.deepcopy(next(v for v in VECTORS if v["name"] == name))


class WorkedExamples(unittest.TestCase):
    def test_1000_sq_ft_80_mm_paver_4_5_per_sq_ft_5_percent_wastage_two_trips(self):
        out = calculate(vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"])
        self.assertEqual(out["status"], "draft")
        line = out["lines"][0]
        # 1,000 sq ft x 4.5 pieces x 1.05 = 4,725 pieces; 4,725 / 500 per pallet = 9.45 -> 10 pallets
        self.assertEqual((line["pieces_without_wastage"], line["pieces"], line["pallets"]), (4500, 4725, 10))
        # 4,725 pieces cover 1,050 sq ft; sold per sq ft at Rs 65 -> Rs 68,250.00; GST 18 % -> Rs 12,285.00
        self.assertEqual((line["delivered_area_x100"], line["material"], line["tax"]), (105000, 6825000, 1228500))
        # a truck carries 2,500 pieces: 4,725 / 2,500 -> 2 trips at Rs 3,500 = Rs 7,000 + 18 % GST Rs 1,260
        self.assertEqual((out["trips"], out["totals"]["transport"], out["totals"]["transport_tax"]), (2, 700000, 126000))
        self.assertEqual(out["totals"]["subtotal"], 6825000 + 700000)
        self.assertEqual(out["totals"]["tax"], 1228500 + 126000)
        self.assertEqual(out["totals"]["total"], 8879500)  # Rs 88,795.00
        self.assertEqual((out["payment_terms"]["advance_amount"], out["payment_terms"]["balance"]), (4439750, 4439750))  # 50 % advance
        self.assertEqual((out["payment_terms"]["balance_on"], out["payment_terms"]["due_date"]), ("delivery", None))
        self.assertEqual(out["valid_until"], "2026-10-21")  # 7 days
        # the estimate a customer sees: with no wastage 1,000 sq ft is 4,500 pieces and still 2 trips
        self.assertEqual(out["range"], {"total_low": 8496000, "total_high": 8879500})

    def test_pallet_round_up_changes_the_pieces_and_the_price(self):
        out = calculate(vector("sold_per_piece_rounded_up_to_pallets")["request"])
        self.assertEqual(out["lines"][0]["pieces"], 5000)  # 10 whole pallets of 500
        self.assertEqual(out["lines"][0]["material"], 5000 * 1650)
        self.assertEqual(out["totals"]["total"], 10561000)

    def test_wastage_is_rounded_up_once_at_the_end(self):
        # 3 sq ft x 4.5 = 13.5 pieces; x 1.05 = 14.175 -> 15 (not 14 + a separate rounding of the wastage)
        r = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        r["lines"][0].update(area_x100=300, pieces_per_pallet=1)
        self.assertEqual(calculate(r)["lines"][0]["pieces"], 15)

    def test_credit_terms_and_the_credit_flag(self):
        out = calculate(vector("square_metres_credit_terms_and_credit_flag")["request"])
        self.assertEqual(out["payment_terms"]["balance_on"], "credit_days")
        self.assertEqual(out["payment_terms"]["due_date"], "2026-11-13")  # 30 days after 14 Oct
        codes = {x["code"] for x in out["flags"]["reasons"]}
        self.assertEqual(codes, {"BELOW_MINIMUM_ORDER_QUANTITY", "CREDIT_LIMIT_EXCEEDED"})

    def test_half_way_rounding_modes(self):
        tax = {n: calculate(vector(n)["request"])["totals"]["item_tax"] for n in
               ("rounding_half_up_at_exactly_half", "rounding_half_even_at_exactly_half", "rounding_down_at_exactly_half", "rounding_half_even_rounds_to_the_odd_neighbour")}
        self.assertEqual(list(tax.values()), [13, 12, 12, 18])  # 12.5 -> 13 / 12 / 12 ; 17.5 -> 18 (half even)


class GoldenVectors(unittest.TestCase):
    def test_every_vector_is_reproduced_exactly(self):
        self.assertGreaterEqual(len(VECTORS), 40)
        for v in VECTORS:
            with self.subTest(v["name"]):
                self.assertEqual(calculate(copy.deepcopy(v["request"])), v["expected"])

    def test_the_vector_file_names_this_engine_version(self):
        self.assertEqual(json.loads((HERE / "fixtures" / "construction_vectors.json").read_text())["engine_version"], CONSTRUCTION_ENGINE_VERSION)

    def test_the_hash_is_the_documented_one(self):
        r = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        want = hashlib.sha256(json.dumps({"engine_version": CONSTRUCTION_ENGINE_VERSION, "inputs": r}, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
        self.assertEqual(calculate(r)["canonical_hash"], want)
        shuffled = dict(reversed(list(r.items())))
        self.assertEqual(calculate(shuffled)["canonical_hash"], want)  # key order never changes the hash


class Refusals(unittest.TestCase):
    def test_a_float_or_a_boolean_is_a_type_error_never_a_number(self):
        r = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        r["lines"][0]["unit_price_paise"] = 65.5
        with self.assertRaises(TypeError):
            calculate(r)
        r = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        r["lines"][0]["area_x100"] = True
        with self.assertRaises(TypeError):
            calculate(r)

    def test_a_missing_rate_is_refused_not_assumed(self):
        for name, code in (("missing_gst_rate_is_never_assumed", "MISSING_GST_RATE"), ("freight_without_a_gst_rate", "MISSING_GST_RATE"), ("laying_without_a_rate", "LAYING_RATE_MISSING")):
            with self.subTest(name):
                self.assertEqual(calculate(vector(name)["request"])["codes"], [code])

    def test_the_request_is_not_modified(self):
        r = vector("handling_per_trip_and_laying")["request"]
        before = copy.deepcopy(r)
        calculate(r)
        self.assertEqual(r, before)

    def test_a_rejection_still_carries_the_provenance(self):
        out = calculate(vector("laying_without_a_rate")["request"])
        self.assertEqual((out["status"], out["engine_version"]), ("rejected", CONSTRUCTION_ENGINE_VERSION))
        self.assertTrue(out["flags"]["needs_owner_approval"])
        self.assertRegex(out["canonical_hash"], "^[0-9a-f]{64}$")

    def test_an_oversized_request_is_refused_before_it_is_hashed(self):
        r = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        r["lines"] = [dict(r["lines"][0], sku=f"S{i}") for i in range(21)]
        out = calculate(r)
        self.assertEqual((out["codes"], out["canonical_hash"]), (["OUT_OF_RANGE"], None))


def random_request(rng):
    unit = rng.choice(["sq_ft", "sq_m"])
    lines = []
    for i in range(rng.randint(1, 3)):
        if rng.random() < 0.7:
            line = {"sku": f"A{i}", "name": "Paver", "mode": "area", "sold_per": rng.choice(["piece", unit]), "unit_price_paise": rng.randint(0, 30_000), "gst_bps": rng.choice([0, 500, 1200, 1800, 2800]),
                    "area_unit": unit, "area_x100": rng.randint(1, 300_000), "pieces_per_area_x1000": rng.randint(1, 12_000)}
            if rng.random() < 0.6:
                line["pieces_per_pallet"] = rng.randint(1, 900)
        else:
            line = {"sku": f"D{i}", "name": "Bag", "mode": "direct", "sold_per": rng.choice(["piece", "bag", "tonne", "cft", "truckload", "box"]), "unit_price_paise": rng.randint(0, 30_000),
                    "gst_bps": rng.choice([0, 500, 1800, 2800]), "quantity": rng.randint(1, 5000)}
        lines.append(line)
    kind = rng.choice(["none", "per_trip", "per_km_slab"])
    transport = {"kind": "none"}
    if kind != "none":
        transport = {"kind": kind, "gst_bps": 1800, "capacity_basis": "pieces", "truck_capacity": rng.randint(100, 9000)}
        if kind == "per_trip":
            transport["rate_per_trip_paise"] = rng.randint(0, 900_000)
        else:
            transport["slabs"] = [{"up_to_km": 10, "charge_paise": rng.randint(0, 500_000)}, {"up_to_km": 40, "charge_paise": rng.randint(0, 900_000)}]
        if rng.random() < 0.3:
            transport["free_above_paise"] = rng.randint(1, 9_000_000)
    policy = {"default_wastage_bps": rng.randint(0, 2000), "round_to_pallet": rng.random() < 0.4, "bill_wastage": rng.random() < 0.7, "transport": transport,
              "advance_bps": rng.randint(0, 10000), "credit_days": rng.choice([0, 0, 15, 30, 90]), "validity_days": rng.randint(0, 30), "rounding_mode": rng.choice(["half_up", "half_even", "down"])}
    if rng.random() < 0.4:
        policy["handling"] = {"per": rng.choice(["order", "trip"]), "amount_paise": rng.randint(0, 200_000), "gst_bps": 1800}
    r = {"as_of": "2026-10-14", "lines": lines, "policy": policy, "customer": {"outstanding_paise": rng.randint(0, 5_000_000)}}
    if rng.random() < 0.5:
        r["customer"]["credit_limit_paise"] = rng.randint(0, 20_000_000)
    if kind == "per_km_slab":
        r["distance_km"] = rng.randint(0, 45)
    return r


class Invariants(unittest.TestCase):
    def test_random_requests_never_raise_and_always_add_up(self):
        rng = random.Random(1910)
        drafts = 0
        for _ in range(4000):
            r = random_request(rng)
            out = calculate(r)
            self.assertIn(out["status"], ("draft", "rejected"))
            if out["status"] != "draft":
                self.assertTrue(out["codes"])
                continue
            drafts += 1
            t = out["totals"]
            self.assertEqual(t["material"], sum(x["material"] for x in out["lines"]))
            self.assertEqual(t["subtotal"], t["material"] + t["transport"] + t["handling"] + t["laying"])
            self.assertEqual(t["tax"], t["item_tax"] + t["transport_tax"] + t["handling_tax"] + t["laying_tax"])
            self.assertEqual(t["total"], t["subtotal"] + t["tax"])
            self.assertEqual(out["payment_terms"]["advance_amount"] + out["payment_terms"]["balance"], t["total"])
            self.assertGreaterEqual(out["trips"], 1)
            self.assertLessEqual(out["range"]["total_low"], out["range"]["total_high"])
            self.assertEqual(out["range"]["total_high"], t["total"])
            for x in out["lines"]:
                self.assertEqual(x["gross"], x["material"] + x["tax"])
                if x["mode"] == "area":
                    self.assertGreaterEqual(x["pieces"], x["pieces_without_wastage"])
                    if x["pallets"] is not None and r["policy"]["round_to_pallet"]:
                        self.assertGreaterEqual(x["pieces"], 1)
        self.assertGreater(drafts, 1500)

    def test_more_wastage_never_means_fewer_pieces(self):
        base = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        last = 0
        for wastage in range(0, 3001, 125):
            r = copy.deepcopy(base)
            r["policy"]["default_wastage_bps"] = wastage
            pieces = calculate(r)["lines"][0]["pieces"]
            self.assertGreaterEqual(pieces, last)
            last = pieces

    def test_more_area_never_means_fewer_trips(self):
        base = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        last = 0
        for area in range(100, 400_001, 7919):
            r = copy.deepcopy(base)
            r["lines"][0]["area_x100"] = area
            trips = calculate(r)["trips"]
            self.assertGreaterEqual(trips, last)
            last = trips

    def test_the_wastage_rounding_matches_exact_fractions(self):
        from fractions import Fraction
        import math

        rng = random.Random(7)
        base = vector("worked_example_1000_sqft_80mm_paver_2_trips")["request"]
        for _ in range(500):
            r = copy.deepcopy(base)
            area, ppa, w = rng.randint(1, 2_000_000), rng.randint(1, 100_000), rng.randint(0, 2500)
            r["lines"][0].update(area_x100=area, pieces_per_area_x1000=ppa)
            r["lines"][0].pop("pieces_per_pallet")
            r["policy"]["default_wastage_bps"] = w
            want = math.ceil(Fraction(area, 100) * Fraction(ppa, 1000) * (1 + Fraction(w, 10000)))
            self.assertEqual(calculate(r)["lines"][0]["pieces"], want)


class Purity(unittest.TestCase):
    def test_the_module_imports_only_the_standard_library_and_has_no_float_division_clock_or_environment(self):
        source = Path(construction.__file__).read_text()
        tree = ast.parse(source)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add((node.module or "").split(".")[0])
        self.assertLessEqual(imported, {"__future__", "hashlib", "json", "datetime", "typing"})
        self.assertFalse([n for n in ast.walk(tree) if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div)], "true division makes floats")
        self.assertFalse([n for n in ast.walk(tree) if isinstance(n, ast.Constant) and type(n.value) is float], "no float literal")
        for forbidden in ("date.today", "datetime.now", "time.time", "random", "os.environ", "open(", "float("):
            self.assertNotIn(forbidden, source, forbidden)

    def test_canonical_json_matches_the_saree_engine(self):
        from quote_engine import canonical_json as saree

        value = {"b": [1, "é", None, True], "a": {"z": 0, "y": "x "}}
        self.assertEqual(canonical_json(value), saree(value))


if __name__ == "__main__":
    unittest.main()
