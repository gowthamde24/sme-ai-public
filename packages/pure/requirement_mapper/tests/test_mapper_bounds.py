import unittest

import requirement_mapper as engine
from test_mapper import fixture, product, row


class MapperBoundsTests(unittest.TestCase):
    def accepted(self, request):
        result = engine.map_requirements(request)
        self.assertNotEqual(result.get("status"), "rejected", result)
        return result

    def reject(self, request):
        result = engine.map_requirements(request)
        self.assertEqual(result["codes"], ["OUT_OF_RANGE"])
        self.assertIsNone(result["canonical_hash"])

    def test_line_and_quantity_bounds(self):
        for value in (1, engine.MAX_LINES):
            r = fixture()
            for f in r["fields"]:
                f["line_no"] = value
            self.assertEqual(self.accepted(r)["lines"][0]["line_no"], value)
        for value in (0, engine.MAX_LINES + 1):
            r = fixture()
            r["fields"][0]["line_no"] = value
            self.reject(r)
        for value in (1, engine.MAX_QUANTITY):
            r = fixture()
            r["fields"][1]["value_int"] = value
            self.assertEqual(self.accepted(r)["order_lines_proposal"][0]["qty"], value)
        for value in (0, -1, engine.MAX_QUANTITY + 1, 10 ** 30):
            r = fixture()
            r["fields"][1]["value_int"] = value
            self.reject(r)

    def test_field_size_bound(self):
        r = fixture()
        r["fields"] = [row("payment_terms", "Synthetic", None) for _ in range(engine.MAX_FIELDS)]
        self.assertEqual(len(self.accepted(r)["order"]), engine.MAX_FIELDS)
        r["fields"].append(row("payment_terms", "Synthetic", None))
        self.reject(r)

    def test_catalog_size_bound(self):
        r = fixture()
        r["catalog"] = [product("SYN-" + str(i), "Synthetic Unrelated") for i in range(engine.MAX_PRODUCTS)]
        self.accepted(r)
        r["catalog"].append(product("SYN-EXTRA"))
        self.reject(r)

    def test_attribute_size_bound(self):
        r = fixture()
        r["catalog"][0]["attributes"] = {"synthetic_" + str(i): "Synthetic" for i in range(engine.MAX_ATTRIBUTES)}
        self.accepted(r)
        r["catalog"][0]["attributes"]["extra"] = "Synthetic"
        self.reject(r)

    def test_config_code_and_value_count_bounds(self):
        for key in engine.CONFIG_KEYS:
            r = fixture()
            r["config"][key] = {"a" + str(i): ["Synthetic"] for i in range(engine.MAX_CONFIG_CODES)}
            self.accepted(r)
            r["config"][key]["extra"] = []
            self.reject(r)
            r = fixture()
            first = next(iter(r["config"][key]))
            r["config"][key][first] = ["Synthetic" for _ in range(engine.MAX_CONFIG_VALUES)]
            self.accepted(r)
            r["config"][key][first].append("Synthetic")
            self.reject(r)

    def test_string_bounds_every_location(self):
        paths = (("catalog", 0, "sku"), ("catalog", 0, "category"),
                 ("catalog", 0, "attributes", "fabric"),
                 ("config", "saree_type_to_categories", "pattu_style", 0),
                 ("config", "fabric_to_values", "silk_style", 0),
                 ("config", "colour_to_values", "purple_style", 0),
                 ("fields", 4, "value_text"), ("fields", 4, "basis"))
        for path in paths:
            for size in (engine.MAX_STRING_LENGTH, engine.MAX_STRING_LENGTH + 1):
                r = fixture()
                r["fields"].append(row("payment_terms", "Synthetic", None))
                target = r
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = "S" * size
                if size == engine.MAX_STRING_LENGTH:
                    self.accepted(r)
                else:
                    self.reject(r)
        r = fixture()
        r["catalog"][0]["attributes"]["S" * engine.MAX_STRING_LENGTH] = "Synthetic"
        self.accepted(r)
        r["catalog"][0]["attributes"]["S" * (engine.MAX_STRING_LENGTH + 1)] = "Synthetic"
        self.reject(r)

    def test_code_length_and_integer_cap(self):
        r = fixture()
        r["fields"][0]["value_code"] = "a" * 41
        self.accepted(r)
        r["fields"][0]["value_code"] += "a"
        self.assertEqual(engine.map_requirements(r)["codes"], ["INVALID_CODE"])
        r = fixture()
        r["config"]["saree_type_to_categories"] = {"a" * 41: []}
        self.accepted(r)
        r["config"]["saree_type_to_categories"] = {"a" * 42: []}
        self.assertEqual(engine.map_requirements(r)["codes"], ["INVALID_CODE"])
        for value in (0, engine.MAX_INTEGER):
            r = fixture()
            r["fields"].append(row("budget", value, None))
            self.accepted(r)
        for value in (-1, engine.MAX_INTEGER + 1, 10 ** 30):
            r = fixture()
            r["fields"].append(row("budget", value, None))
            self.reject(r)
        self.assertLessEqual(engine.MAX_QUANTITY, engine.MAX_INTEGER)

    def test_depth_nodes_generic_lists_and_objects(self):
        for depth in (engine.MAX_DEPTH, engine.MAX_DEPTH + 1):
            value = None
            for _ in range(depth - 1):
                value = [value]
            r = {"x": value}
            if depth == engine.MAX_DEPTH:
                engine._bounded(r)
            else:
                self.reject(r)
        for nodes in (engine.MAX_NODES, engine.MAX_NODES + 1):
            r = {"x": [[None] * 5000 for _ in range(79)] + [[None] * (nodes - 82 - 395000)]}
            if nodes == engine.MAX_NODES:
                engine._bounded(r)
            else:
                self.reject(r)
        engine._bounded({"x": [None] * engine.MAX_PRODUCTS})
        self.reject({"x": [None] * (engine.MAX_PRODUCTS + 1)})
        engine._bounded({str(i): None for i in range(engine.MAX_OBJECT_FIELDS)})
        self.reject({str(i): None for i in range(engine.MAX_OBJECT_FIELDS + 1)})
        engine._bounded({"S" * engine.MAX_STRING_LENGTH: None})
        self.reject({"S" * (engine.MAX_STRING_LENGTH + 1): None})

    def test_oversize_precedes_validation_and_hash(self):
        requests = []
        for key in ("fields", "catalog"):
            r = fixture()
            r[key] = [object()] * 100_000
            requests.append(r)
        r = fixture()
        r["catalog"][0]["attributes"] = {str(i): object() for i in range(engine.MAX_ATTRIBUTES + 1)}
        requests.append(r)
        r = fixture()
        r["config"]["fabric_to_values"] = {str(i): object() for i in range(engine.MAX_CONFIG_CODES + 1)}
        requests.append(r)
        r = fixture()
        r["config"]["fabric_to_values"]["silk_style"] = [object()] * (engine.MAX_CONFIG_VALUES + 1)
        requests.append(r)
        r = fixture()
        r["fields"][1]["value_int"] = 10 ** 30
        requests.append(r)
        for r in requests:
            original_validate, original_hash = engine._validate, engine._hash
            def forbidden(*args):
                raise AssertionError("Oversize input reached validation/hash")
            try:
                engine._validate = engine._hash = forbidden
                self.reject(r)
            finally:
                engine._validate, engine._hash = original_validate, original_hash

    def test_date_limits(self):
        for value in ("0001-01-01", "9999-12-31"):
            r = fixture()
            r["fields"].append(row("deadline", value, None))
            self.accepted(r)
        r["fields"][-1]["value_date"] = "10000-01-01"
        self.assertEqual(engine.map_requirements(r)["codes"], ["INVALID_DATE"])
