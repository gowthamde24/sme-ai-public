import copy
import json
from pathlib import Path
import random
import unittest

import requirement_mapper as engine


def fixture():
    return json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())


def row(key, value=None, number=1, basis=None):
    result = dict.fromkeys(engine.ROW_KEYS)
    result.update(line_no=number, field_key=key, basis=basis)
    slot = ("value_int" if key in ("quantity", "budget") else
            "value_date" if key == "deadline" else
            "value_text" if key in ("delivery_city", "payment_terms") else "value_code")
    result[slot] = value
    return result


def product(sku="SYN-X", category="Synthetic Pattu Style", active=True, unit="piece", **attributes):
    return {"sku": sku, "category": category, "active": active, "sale_unit": unit,
            "attributes": attributes}


def decisions(result):
    return {key: value for key, value in result.items() if key != "canonical_hash"}


class MapperTests(unittest.TestCase):
    def line(self, request):
        output = engine.map_requirements(request)
        self.assertNotEqual(output.get("status"), "rejected", output)
        return output["lines"][0]

    def reject(self, request, code):
        result = engine.map_requirements(request)
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["codes"], [code])
        self.assertEqual(result["message"], engine.MESSAGES[code])
        self.assertTrue(result["human_confirmation_required"])
        self.assertIsNone(result["canonical_hash"])
        return result

    def test_matched_and_proposal(self):
        q = engine.map_requirements(fixture())
        self.assertEqual(q["mapper_version"], "1.0.0")
        self.assertTrue(q["human_confirmation_required"])
        self.assertEqual(q["lines"], [{"line_no": 1, "status": "matched", "reason": None,
                                      "candidates": ["SYN-DP-A"], "truncated": False,
                                      "quantity": 12, "unit": "piece"}])
        self.assertEqual(q["order_lines_proposal"], [{"sku": "SYN-DP-A", "qty": 12, "discount_bps": 0}])
        self.assertEqual(q["flags"], [])
        self.assertEqual(q["order"], [])

    def test_missing_required_slots(self):
        for key, reason in (("saree_type", "missing_saree_type"), ("quantity", "missing_quantity")):
            for missing_row in (True, False):
                r = fixture()
                if missing_row:
                    r["fields"] = [f for f in r["fields"] if f["field_key"] != key]
                else:
                    f = next(f for f in r["fields"] if f["field_key"] == key)
                    f["value_code" if key == "saree_type" else "value_int"] = None
                q = self.line(r)
                self.assertEqual((q["status"], q["reason"]), ("needs_input", reason))
                self.assertEqual(engine.map_requirements(r)["order_lines_proposal"], [])
        r = fixture()
        r["fields"][1]["basis"] = None
        self.assertEqual(self.line(r)["reason"], "missing_unit")

    def test_duplicate_slots_precede_other_and_missing(self):
        for key in engine.LINE_KEYS:
            r = fixture()
            f = copy.deepcopy(next(f for f in r["fields"] if f["field_key"] == key))
            if key == "quantity":
                f["value_int"] = 15
            else:
                f["value_code"] = "other"
            r["fields"].append(f)
            q = self.line(r)
            self.assertEqual((q["status"], q["reason"]), ("needs_input", "duplicate_slot"))
            reverse = copy.deepcopy(r)
            reverse["fields"].reverse()
            self.assertEqual(engine.map_requirements(r), engine.map_requirements(reverse))
            if key == "quantity":
                self.assertIsNone(q["quantity"])
                self.assertIsNone(q["unit"])
        r["fields"] = [f for f in r["fields"] if f["field_key"] != "quantity"]
        self.assertEqual(self.line(r)["reason"], "duplicate_slot")

    def test_other_in_each_code_requires_human(self):
        for key in ("saree_type", "fabric", "colour"):
            r = fixture()
            next(f for f in r["fields"] if f["field_key"] == key)["value_code"] = "other"
            r["config"]["saree_type_to_categories"]["other"] = ["Synthetic Pattu Style"]
            q = self.line(r)
            self.assertEqual((q["status"], q["reason"]), ("needs_human", "other_value"))
            self.assertEqual(engine.map_requirements(r)["order_lines_proposal"], [])

    def test_incomplete_precedes_other(self):
        r = fixture()
        r["fields"][0]["value_code"] = "other"
        r["fields"][1]["value_int"] = None
        self.assertEqual(self.line(r)["reason"], "missing_quantity")

    def test_saree_type_not_mapped(self):
        r = fixture()
        r["config"]["saree_type_to_categories"] = {}
        q = self.line(r)
        self.assertEqual((q["status"], q["reason"]), ("unmatched", "saree_type_not_mapped"))
        self.assertEqual(q["candidates"], [])

    def test_category_failure_has_no_unrelated_alternatives(self):
        r = fixture()
        r["config"]["saree_type_to_categories"]["pattu_style"] = ["Synthetic Empty Category"]
        q = self.line(r)
        self.assertEqual((q["status"], q["reason"]), ("unmatched", "category"))
        self.assertEqual(q["alternatives"], [])
        before = engine.map_requirements(r)
        r["catalog"].append(product(category="Synthetic Unrelated"))
        self.assertEqual(decisions(before), decisions(engine.map_requirements(r)))
        r["catalog"] = []
        self.assertEqual(self.line(r)["reason"], "category")

    def test_fabric_failure_and_previous_candidates(self):
        r = fixture()
        r["config"]["fabric_to_values"] = {}
        q = self.line(r)
        self.assertEqual((q["status"], q["reason"]), ("unmatched", "fabric"))
        self.assertEqual(q["alternatives"], ["SYN-DP-A", "SYN-DP-B", "SYN-DP-C"])
        r["config"]["fabric_to_values"] = {"silk_style": ["Synthetic Nonexistent"]}
        self.assertEqual(self.line(r)["reason"], "fabric")

    def test_colour_failure_after_fabric(self):
        r = fixture()
        r["config"]["colour_to_values"] = {}
        q = self.line(r)
        self.assertEqual((q["status"], q["reason"]), ("unmatched", "colour"))
        self.assertEqual(q["alternatives"], ["SYN-DP-A", "SYN-DP-B"])
        r["config"]["colour_to_values"] = {"purple_style": ["Synthetic Nonexistent"]}
        self.assertEqual(self.line(r)["reason"], "colour")

    def test_optional_criteria_absent_or_null(self):
        for null in (True, False):
            r = fixture()
            if null:
                for f in r["fields"][2:]:
                    f["value_code"] = None
            else:
                r["fields"] = r["fields"][:2]
            q = self.line(r)
            self.assertEqual(q["status"], "ambiguous")
            self.assertEqual(q["candidates"], ["SYN-DP-A", "SYN-DP-B", "SYN-DP-C"])
            self.assertEqual(engine.map_requirements(r)["order_lines_proposal"], [])

    def test_missing_attributes_strictly_excluded(self):
        for key in ("fabric", "colour"):
            r = fixture()
            r["catalog"] = [r["catalog"][0]]
            del r["catalog"][0]["attributes"][key]
            q = self.line(r)
            self.assertEqual((q["status"], q["reason"]), ("unmatched", key))
            self.assertEqual(q["alternatives"], ["SYN-DP-A"])

    def test_normalization_and_config_alternates(self):
        r = fixture()
        p = r["catalog"][0]
        p.update(category="  SYNTHETIC\tPATTU  STYLE  ")
        p["attributes"] = {" FABRIC ": "\tSYNTHETIC   SILK ", " COLOUR ": "  INVENTED\nPURPLE "}
        r["config"]["saree_type_to_categories"]["pattu_style"].insert(0, "Not A Category")
        r["config"]["fabric_to_values"]["silk_style"].insert(0, "Not A Fabric")
        r["config"]["colour_to_values"]["purple_style"].insert(0, "Not A Colour")
        self.assertEqual(self.line(r)["status"], "matched")
        p["attributes"][" FABRIC "] = "Straße Synthetic"
        r["config"]["fabric_to_values"]["silk_style"] = ["STRASSE SYNTHETIC"]
        self.assertEqual(self.line(r)["status"], "matched")

    def test_unit_mismatch_and_unknown_product_unit(self):
        r = fixture()
        r["catalog"][0]["sale_unit"] = "set"
        q = self.line(r)
        self.assertEqual((q["status"], q["reason"]), ("needs_human", "unit_mismatch"))
        self.assertEqual(q["candidates"], ["SYN-DP-A"])
        self.assertEqual(engine.map_requirements(r)["order_lines_proposal"], [])
        r["fields"][1]["basis"] = "set"
        self.assertEqual(self.line(r)["status"], "matched")
        r["fields"][1]["basis"] = "piece"
        r["catalog"][0]["sale_unit"] = None
        self.assertEqual(self.line(r)["status"], "matched")
        r["fields"] = r["fields"][:2]
        self.assertEqual(self.line(r)["status"], "ambiguous")

    def test_candidate_cap_and_truncation_boundary(self):
        for size in (1, 2, 20, 21):
            r = fixture()
            r["catalog"] = []
            for i in reversed(range(size)):
                p = copy.deepcopy(fixture()["catalog"][0])
                p["sku"] = "SYN-" + str(i).zfill(3)
                r["catalog"].append(p)
            q = self.line(r)
            self.assertEqual(q["status"], "matched" if size == 1 else "ambiguous")
            self.assertEqual(q["candidates"], ["SYN-" + str(i).zfill(3) for i in range(min(size, 20))])
            self.assertEqual(q["truncated"], size > 20)
            r["config"]["fabric_to_values"] = {}
            q = self.line(r)
            self.assertEqual(q["alternatives"], ["SYN-" + str(i).zfill(3) for i in range(min(size, 20))])
            self.assertEqual(q["truncated"], size > 20)

    def test_line_order_and_duplicate_sku_without_merge(self):
        r = fixture()
        r["fields"] += [{**f, "line_no": number, "value_int": number if f["field_key"] == "quantity" else f["value_int"]}
                        for number in (5, 3, 2, 4) for f in copy.deepcopy(r["fields"])]
        q = engine.map_requirements(r)
        self.assertEqual([line["line_no"] for line in q["lines"]], [1, 2, 3, 4, 5])
        self.assertEqual([line["qty"] for line in q["order_lines_proposal"]], [12, 2, 3, 4, 5])
        self.assertEqual(q["flags"], ["duplicate_sku"])
        self.assertEqual(len(q["order_lines_proposal"]), 5)

    def test_order_rows_untouched_and_not_matching_inputs(self):
        r = fixture()
        order = [row("budget", 12345, None, "invented_basis"), row("deadline", "2026-10-20", None),
                 row("delivery_city", "Synthetic city; arbitrary text", None),
                 row("payment_terms", "Synthetic terms other purple_style", None)]
        before = engine.map_requirements(r)
        r["fields"] += order + [copy.deepcopy(order[0])]
        q = engine.map_requirements(r)
        self.assertEqual(q["lines"], before["lines"])
        self.assertEqual(q["order_lines_proposal"], before["order_lines_proposal"])
        self.assertEqual(q["order"], sorted(order + [order[0]], key=engine.canonical_json))
        q["order"][0]["value_int"] = 1
        self.assertEqual(r["fields"][-1], order[0])

    def test_empty_input_and_order_only(self):
        r = fixture()
        r.update(fields=[], catalog=[])
        q = engine.map_requirements(r)
        self.assertEqual(q["lines"], [])
        self.assertEqual(q["order_lines_proposal"], [])
        self.assertTrue(q["human_confirmation_required"])
        r["fields"] = [row("payment_terms", "Synthetic only", None)]
        self.assertEqual(engine.map_requirements(r)["lines"], [])

    def test_duplicate_sku_and_normalized_attribute_checks(self):
        r = fixture()
        r["catalog"].append(copy.deepcopy(r["catalog"][0]))
        self.reject(r, "DUPLICATE_SKU")
        r["catalog"][-1]["sku"] = " syn-dp-a "
        self.reject(r, "DUPLICATE_SKU")
        r = fixture()
        r["catalog"][0]["attributes"][" Fabric "] = "Synthetic Silk"
        self.reject(r, "DUPLICATE_ATTRIBUTE")

    def test_invalid_codes_units_and_scopes(self):
        for code in ("", "A", "1a", "a-b", "a b", "é", "a\n", "a" * 42):
            r = fixture()
            r["fields"][0]["value_code"] = code
            self.reject(r, "INVALID_CODE")
            r = fixture()
            r["config"]["saree_type_to_categories"] = {code: []}
            self.reject(r, "INVALID_CODE")
        for scope, key in ((None, "saree_type"), (1, "budget"), (1, "unknown"), (None, "unknown")):
            r = fixture()
            r["fields"].append(row(key, None, scope))
            self.reject(r, "INVALID_FIELD_KEY")
        for target in ("requirement", "catalog"):
            r = fixture()
            if target == "requirement":
                r["fields"][1]["basis"] = "box"
            else:
                r["catalog"][0]["sale_unit"] = "box"
            self.reject(r, "INVALID_UNIT")

    def test_unknown_keys_and_slot_shapes(self):
        for target in ("root", "row", "product", "config"):
            r = fixture()
            obj = {"root": r, "row": r["fields"][0], "product": r["catalog"][0], "config": r["config"]}[target]
            obj["unknown"] = {} if target == "config" else None
            self.reject(r, "INVALID_FIELDS")
        for key in engine.ROW_KEYS:
            r = fixture()
            del r["fields"][0][key]
            self.reject(r, "INVALID_FIELDS")
        r = fixture()
        r["fields"][0]["value_text"] = "Do not echo synthetic text"
        self.reject(r, "INVALID_VALUE_SLOT")
        r = fixture()
        r["fields"][0]["basis"] = "piece"
        self.reject(r, "INVALID_VALUE_SLOT")

    def test_date_and_empty_comparison_values(self):
        for value in ("2026-02-30", "20261020", "2026-10-20T00:00:00Z"):
            r = fixture()
            r["fields"].append(row("deadline", value, None))
            self.reject(r, "INVALID_DATE")
        for path in (("catalog", 0, "sku"), ("catalog", 0, "category"),
                     ("catalog", 0, "attributes", "fabric"),
                     ("config", "fabric_to_values", "silk_style", 0)):
            r = fixture()
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = " \t "
            self.reject(r, "EMPTY_STRING")

    def test_fixed_type_rejections(self):
        cases = (("fields", {}), ("catalog", {}), ("config", []))
        self.reject([], "INVALID_TYPE")
        for key, value in cases:
            r = fixture()
            r[key] = value
            self.reject(r, "INVALID_TYPE")
        for path, value in ((("fields", 0, "line_no"), True), (("fields", 1, "value_int"), False),
                            (("fields", 0, "field_key"), 1), (("fields", 0, "value_code"), 3),
                            (("fields", 0, "value_text"), False), (("fields", 1, "basis"), 1),
                            (("catalog", 0, "active"), 1), (("catalog", 0, "sku"), 1),
                            (("catalog", 0, "sale_unit"), True), (("catalog", 0, "attributes"), []),
                            (("config", "fabric_to_values", "silk_style"), "Synthetic Silk"),
                            (("fields", 1, "value_int"), json.loads("1.5"))):
            r = fixture()
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            output = self.reject(r, "INVALID_TYPE")
            self.assertNotIn("Synthetic Silk", output["message"])
        r = fixture()
        r["catalog"][0]["attributes"] = {1: "Synthetic"}
        self.reject(r, "INVALID_TYPE")

    def test_hash_roundtrip_and_every_leaf(self):
        r = fixture()
        before = copy.deepcopy(r)
        q = engine.map_requirements(r)
        self.assertEqual(q, engine.map_requirements(r))
        self.assertEqual(q, engine.map_requirements(json.loads(engine.canonical_json(r))))
        self.assertEqual(q, json.loads(engine.canonical_json(q)))
        self.assertEqual(r, before)
        self.assertEqual(q["canonical_hash"], "48abf392964caaca5a24bd0c51a41ebf510a2138282b95a851003f6e7fe1a452")
        r2 = copy.deepcopy(r)
        r2["fields"].reverse()
        r2["catalog"].reverse()
        self.assertEqual(q, engine.map_requirements(r2))
        r2 = copy.deepcopy(r)
        r2["catalog"][0]["attributes"]["unused"] = "Synthetic unused"
        self.assertNotEqual(q["canonical_hash"], engine.map_requirements(r2)["canonical_hash"])
        for path, value in ((("fields", 1, "value_int"), 13), (("fields", 1, "basis"), "set"),
                            (("catalog", 0, "active"), False), (("catalog", 0, "sku"), "SYN-NEW"),
                            (("catalog", 0, "attributes", "colour"), "Invented Gold"),
                            (("config", "colour_to_values", "purple_style", 0), "Invented Gold")):
            r2 = copy.deepcopy(r)
            target = r2
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.assertNotEqual(q["canonical_hash"], engine.map_requirements(r2)["canonical_hash"])

    def test_250_seeded_properties(self):
        rng = random.Random(1012)
        for case in range(250):
            r = fixture()
            r["fields"] = []
            for number in range(1, rng.randint(1, 5) + 1):
                r["fields"].append(row("saree_type", rng.choice(("pattu_style", "other", "unmapped")), number))
                if rng.randrange(5):
                    r["fields"].append(row("quantity", rng.randint(1, 10000), number, rng.choice(("piece", "set"))))
                for key, code in (("fabric", "silk_style"), ("colour", "purple_style")):
                    if rng.randrange(2):
                        r["fields"].append(row(key, rng.choice((code, "other", "unmapped", None)), number))
            r["catalog"] = []
            for i in range(rng.randint(0, 30)):
                attributes = {}
                if rng.randrange(3):
                    attributes["fabric"] = rng.choice(("Synthetic Silk", "Synthetic Blend"))
                if rng.randrange(3):
                    attributes["colour"] = rng.choice(("Invented Purple", "Invented Gold"))
                r["catalog"].append(product("SYN-" + str(i).zfill(3), rng.choice(("Synthetic Pattu Style", "Synthetic Unrelated")),
                                            bool(rng.randrange(2)), rng.choice(("piece", "set", None)), **attributes))
            with self.subTest(case=case):
                before = copy.deepcopy(r)
                q = engine.map_requirements(r)
                self.assertEqual(q, engine.map_requirements(r))
                self.assertEqual(r, before)
                shuffled = copy.deepcopy(r)
                rng.shuffle(shuffled["fields"])
                rng.shuffle(shuffled["catalog"])
                self.assertEqual(q, engine.map_requirements(shuffled))
                active = {p["sku"] for p in r["catalog"] if p["active"]}
                for line in q["lines"]:
                    skus = line.get("candidates", line.get("alternatives", []))
                    self.assertTrue(set(skus) <= active)
                    self.assertEqual(skus, sorted(skus))
                    if line["status"] == "matched":
                        self.assertEqual(len(skus), 1)
                irrelevant = copy.deepcopy(r)
                irrelevant["catalog"].append(product("SYN-IRRELEVANT", "Synthetic Never Configured"))
                self.assertEqual(decisions(q), decisions(engine.map_requirements(irrelevant)))
                inactive = copy.deepcopy(r)
                inactive["catalog"].append(product("SYN-INACTIVE", active=False, fabric="Synthetic Silk", colour="Invented Purple"))
                self.assertEqual(decisions(q), decisions(engine.map_requirements(inactive)))
                self.assertTrue(q["human_confirmation_required"])
