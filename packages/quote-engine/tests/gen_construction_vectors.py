"""Writes tests/fixtures/construction_vectors.json: the golden vectors of the construction calculator (job CN).

The REQUESTS below are written by hand (the worked examples are checked by hand in test_construction.py). The EXPECTED results are produced by the Python reference and stored, so that
  * the Python reference (pytest), the TypeScript twin (vitest) and the database function (pgTAP) all have to reproduce the same stored numbers, and
  * any change of behaviour shows up as a diff of this file in review.
Run: python3 packages/quote-engine/tests/gen_construction_vectors.py   (it refuses to run on a request that stops being valid unless the vector is marked `reject`)."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))
from quote_engine.construction import calculate  # noqa: E402

PAVER = {
    "sku": "PV80-GREY", "name": "Paver block 80 mm grey", "mode": "area", "sold_per": "sq_ft", "unit_price_paise": 6500, "gst_bps": 1800, "hsn": "68101990",
    "area_unit": "sq_ft", "area_x100": 100000, "pieces_per_area_x1000": 4500, "pieces_per_pallet": 500,
}
POLICY = {
    "default_wastage_bps": 500, "round_to_pallet": False, "bill_wastage": True,
    "transport": {"kind": "per_trip", "capacity_basis": "pieces", "truck_capacity": 2500, "rate_per_trip_paise": 350000, "gst_bps": 1800},
    "advance_bps": 5000, "credit_days": 0, "validity_days": 7, "rounding_mode": "half_up",
}
# 125 paise at 10 % GST = 12.5 paise: exactly half, the case where the three rounding modes differ (half up 13, half even 12, down 12); at 175 paise 17.5: half even goes UP to 18
HALF = {"sku": "HALF", "name": "One bag", "mode": "direct", "sold_per": "bag", "unit_price_paise": 125, "gst_bps": 1000, "quantity": 1}
BASE = {"as_of": "2026-10-14", "lines": [PAVER], "policy": POLICY, "customer": {"outstanding_paise": 0}}


def make(**changes):
    r = copy.deepcopy(BASE)
    for key, value in changes.items():
        r[key] = value
    return r


def with_policy(**changes):
    p = copy.deepcopy(POLICY)
    p.update(changes)
    return make(policy=p)


def line(**changes):
    x = copy.deepcopy(PAVER)
    x.update(changes)
    return x


CASES: list[tuple[str, dict, bool]] = [
    ("worked_example_1000_sqft_80mm_paver_2_trips", make(), False),
    ("sold_per_piece_rounded_up_to_pallets", make(lines=[line(sold_per="piece", unit_price_paise=1650)], policy={**POLICY, "round_to_pallet": True}), False),
    ("area_price_bills_only_the_customers_area", with_policy(bill_wastage=False), False),
    ("no_wastage_at_all", with_policy(default_wastage_bps=0), False),
    ("line_wastage_overrides_the_default", make(lines=[line(wastage_bps=1000)]), False),
    ("per_line_pallet_choice", make(lines=[line(round_to_pallet=True, sold_per="piece", unit_price_paise=1650)]), False),
    ("km_slab_second_slab_two_trips", make(distance_km=18, policy={**POLICY, "transport": {"kind": "per_km_slab", "truck_capacity": 2500, "capacity_basis": "pieces", "gst_bps": 1800,
        "slabs": [{"up_to_km": 10, "charge_paise": 250000}, {"up_to_km": 25, "charge_paise": 400000}, {"up_to_km": 50, "charge_paise": 650000}]}}), False),
    ("freight_free_above_the_material_amount", make(policy={**POLICY, "transport": {**POLICY["transport"], "free_above_paise": 6000000}}), False),
    ("freight_not_free_at_exactly_the_amount", make(policy={**POLICY, "transport": {**POLICY["transport"], "free_above_paise": 6825000}}), False),
    ("freight_none_but_trips_known", make(policy={**POLICY, "transport": {"kind": "none", "capacity_basis": "pieces", "truck_capacity": 2000}}), False),
    ("capacity_in_area", make(policy={**POLICY, "transport": {"kind": "per_trip", "capacity_basis": "area", "truck_capacity": 600, "rate_per_trip_paise": 300000, "gst_bps": 1800}}), False),
    ("handling_per_trip_and_laying", make(laying=True, policy={**POLICY, "handling": {"per": "trip", "amount_paise": 80000, "gst_bps": 1800}, "laying": {"rate_paise_per_area": 2200, "gst_bps": 1800}}), False),
    ("handling_per_order", make(policy={**POLICY, "handling": {"per": "order", "amount_paise": 120000, "gst_bps": 1800}}), False),
    ("square_metres_credit_terms_and_credit_flag", make(
        lines=[line(sku="PV60-RED", name="Paver block 60 mm red", sold_per="sq_m", area_unit="sq_m", area_x100=25050, pieces_per_area_x1000=44000, pieces_per_pallet=600, unit_price_paise=71000, gst_bps=1800, min_order_qty=500)],
        policy={**POLICY, "advance_bps": 3000, "credit_days": 30, "transport": {**POLICY["transport"], "truck_capacity": 8000}},
        customer={"outstanding_paise": 4000000, "credit_limit_paise": 5000000}), False),
    ("below_minimum_order_flag", make(lines=[line(area_x100=10000, min_order_qty=500)]), False),
    ("direct_bags_of_cement_not_counted_in_trips", make(lines=[line(), {"sku": "CEM-53", "name": "Cement 53 grade 50 kg bag", "mode": "direct", "sold_per": "bag", "unit_price_paise": 38000, "gst_bps": 2800, "hsn": "2523", "quantity": 120}]), False),
    ("direct_pieces_count_in_trips", make(lines=[line(), {"sku": "KERB-1", "name": "Kerb stone", "mode": "direct", "sold_per": "piece", "unit_price_paise": 9500, "gst_bps": 1800, "quantity": 300, "wastage_bps": 200}]), False),
    ("rounding_half_up_at_exactly_half", make(lines=[HALF], policy={**POLICY, "transport": {"kind": "none"}, "rounding_mode": "half_up"}), False),
    ("rounding_half_even_at_exactly_half", make(lines=[HALF], policy={**POLICY, "transport": {"kind": "none"}, "rounding_mode": "half_even"}), False),
    ("rounding_down_at_exactly_half", make(lines=[HALF], policy={**POLICY, "transport": {"kind": "none"}, "rounding_mode": "down"}), False),
    ("rounding_half_even_rounds_to_the_odd_neighbour", make(lines=[{**HALF, "unit_price_paise": 175}], policy={**POLICY, "transport": {"kind": "none"}, "rounding_mode": "half_even"}), False),
    ("zero_advance_all_on_credit", with_policy(advance_bps=0, credit_days=45), False),
    ("odd_numbers_that_round", make(lines=[line(area_x100=123457, pieces_per_area_x1000=3777, unit_price_paise=6789, gst_bps=1250, pieces_per_pallet=137)], policy={**POLICY, "default_wastage_bps": 733, "round_to_pallet": True}), False),
    # 99,999,999 x 9,000 x 10,500 = 9.45e15, above 2^53 (9.007e15): a float would already be wrong here; the answer is exact in Python ints and in the twin's BigInt
    ("intermediate_product_above_2_pow_53", make(lines=[line(area_x100=99999999, pieces_per_area_x1000=9000, sold_per="piece", unit_price_paise=10, pieces_per_pallet=1000)], policy={**POLICY, "transport": {"kind": "none"}}), False),
    ("distance_beyond_the_last_slab", make(distance_km=80, policy={**POLICY, "transport": {"kind": "per_km_slab", "truck_capacity": 2500, "capacity_basis": "pieces", "gst_bps": 1800, "slabs": [{"up_to_km": 10, "charge_paise": 250000}]}}), True),
    ("distance_missing_for_slabs", make(policy={**POLICY, "transport": {"kind": "per_km_slab", "truck_capacity": 2500, "capacity_basis": "pieces", "gst_bps": 1800, "slabs": [{"up_to_km": 10, "charge_paise": 250000}]}}), True),
    ("laying_without_a_rate", make(laying=True), True),
    ("missing_gst_rate_is_never_assumed", make(lines=[{k: v for k, v in PAVER.items() if k != "gst_bps"}]), True),
    ("freight_without_a_gst_rate", make(policy={**POLICY, "transport": {k: v for k, v in POLICY["transport"].items() if k != "gst_bps"}}), True),
    ("mixed_area_units", make(lines=[line(), line(sku="X", area_unit="sq_m", sold_per="sq_m")]), True),
    ("sold_per_does_not_fit_the_area", make(lines=[line(sold_per="sq_m")]), True),
    ("direct_line_sold_per_area", make(lines=[{"sku": "S", "name": "Sand", "mode": "direct", "sold_per": "sq_ft", "unit_price_paise": 100, "gst_bps": 500, "quantity": 5}]), True),
    ("empty_order", make(lines=[]), True),
    ("duplicate_sku", make(lines=[line(), line()]), True),
    ("hsn_must_be_digits", make(lines=[line(hsn="68X1")]), True),
    ("area_over_the_limit", make(lines=[line(area_x100=100000001)]), True),
    ("total_over_the_orders_limit", make(lines=[line(area_x100=90000000, unit_price_paise=90000)]), True),
    ("too_many_pieces", make(lines=[line(area_x100=100000000, pieces_per_area_x1000=200000)]), True),
    ("date_out_of_range", make(as_of="2019-12-31"), True),
    ("date_not_iso", make(as_of="14/10/2026"), True),
    ("per_trip_without_capacity", make(policy={**POLICY, "transport": {"kind": "per_trip", "rate_per_trip_paise": 1, "gst_bps": 1800}}), True),
    ("slabs_not_increasing", make(distance_km=5, policy={**POLICY, "transport": {"kind": "per_km_slab", "gst_bps": 1800, "slabs": [{"up_to_km": 10, "charge_paise": 1}, {"up_to_km": 10, "charge_paise": 2}]}}), True),
    ("unknown_field_refused", make(extra=1), True),
    ("wastage_above_the_limit", with_policy(default_wastage_bps=5001), True),
]


def main() -> None:
    out = []
    for name, request, reject in CASES:
        result = calculate(request)
        if reject != (result["status"] == "rejected"):
            raise SystemExit(f"{name}: expected {'a rejection' if reject else 'a draft'}, got {result['status']} {result.get('codes')}")
        out.append({"name": name, "request": request, "expected": result})
    path = HERE / "fixtures" / "construction_vectors.json"
    path.write_text(json.dumps({"engine_version": "1.0.0", "vectors": out}, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(out)} vectors -> {path}")


if __name__ == "__main__":
    main()
