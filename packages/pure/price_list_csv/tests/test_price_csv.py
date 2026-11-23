import copy
import csv
from io import StringIO
import json
from pathlib import Path
import random
import unittest

import price_list_csv as engine


def fixture():
    return json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())


def table(rows=None, header=None, newline="\n"):
    header = list(engine.REQUIRED) if header is None else header
    rows = [["SYN-A", "Synthetic weave", "1200", "2", "500"]] if rows is None else rows
    out = StringIO(newline="")
    writer = csv.writer(out, lineterminator=newline)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue()


class PriceCSVTests(unittest.TestCase):
    def accepted(self, text):
        q = engine.parse(text)
        self.assertTrue(q["ok"], q)
        self.assertEqual(q["errors"], [])
        self.assertEqual(len(q["canonical_hash"]), 64)
        return q

    def rejected(self, text, code, row=None, column=None):
        q = engine.parse(text)
        self.assertFalse(q["ok"])
        self.assertEqual(q["items"], [])
        self.assertIsNone(q["canonical_hash"])
        self.assertIn(code, [e["code"] for e in q["errors"]])
        if row is not None:
            self.assertIn({"row": row, "column": column, "code": code}, q["errors"])
        return q

    def test_synthetic_engine_shape(self):
        f = fixture()
        q = self.accepted(f["csv"])
        self.assertEqual(q["items"], f["expected_items"])
        self.assertEqual(q["row_count"], 2)

    def test_exact_money_formats_and_boundaries(self):
        for text, paise in (("1200", 120000), ("1,200", 120000), ("1200.5", 120050),
                            ("1,200.50", 120050), ("₹1,200.50", 120050), ("Rs 1200.5", 120050),
                            ("INR 1200", 120000), ("rs. 1200", 120000), ("0.01", 1),
                            ("999999.99", 99999999), ("1000000.00", 100000000),
                            ("1,000,000", 100000000), (" 0001.20 ", 120)):
            with self.subTest(text=text):
                q = self.accepted(table([["SYN-A", "Synthetic", text, "1", "0"]]))
                self.assertEqual(q["items"][0]["unit_price"], paise)
        for text in ("999999999.99", "1000000.01", "0", "0.00"):
            self.rejected(table([["SYN-A", "Synthetic", text, "1", "0"]]), "MONEY_OUT_OF_RANGE", 1, "unit_price")

    def test_invalid_money_syntax(self):
        for text in ("", "-1", "+1", "1e3", "NaN", "inf", "1.001", "1.200", "1.2.3", "١٢", "１２", "12,00", "1,20,000", ".50", "1.", "Rs", "INR ₹1", "1 200", "₹-1"):
            with self.subTest(text=text):
                self.rejected(table([["SYN-A", "Synthetic", text, "1", "0"]]), "INVALID_MONEY", 1, "unit_price")

    def test_headers_bom_case_and_column_permutation(self):
        baseline = self.accepted(table())
        other = self.accepted("\ufeff" + table([["500", "2", "1200", "Synthetic weave", "SYN-A"]],
                                                [" TAX_BPS ", "MOQ", "UNIT_PRICE", "Name", "sKu"], "\r\n"))
        self.assertEqual(baseline, other)

    def test_header_errors_no_echo(self):
        for text in ("", "\ufeff", "\n"):
            self.rejected(text, "HEADER_REQUIRED", 0)
        self.rejected(table([], list(engine.REQUIRED) + ["sku"]), "DUPLICATE_COLUMN", 0)
        self.rejected(table([], list(engine.REQUIRED) + [" SKU "]), "DUPLICATE_COLUMN", 0)
        q = self.rejected(table([], list(engine.REQUIRED) + ["DoNotEcho=synthetic"]), "UNKNOWN_COLUMN", 0)
        self.assertNotIn("DoNotEcho", engine.canonical_json(q))
        for column in engine.REQUIRED:
            q = self.rejected(table([], [c for c in engine.REQUIRED if c != column]), "MISSING_COLUMN", 0, column)
            self.assertEqual(q["row_count"], 0)
        for i in range(1, 6):
            for first, missing in (("min_qty_", "price_"), ("price_", "min_qty_")):
                self.rejected(table([], list(engine.REQUIRED) + [first + str(i)]), "UNPAIRED_BREAK_COLUMN", 0, missing + str(i))
        self.rejected(table([], list(engine.REQUIRED) + ["min_qty_6", "price_6"]), "UNKNOWN_COLUMN")

    def test_csv_quotes_newlines_and_doubled_quotes(self):
        for newline in ("\n", "\r\n"):
            name = 'Synthetic, "woven"' + newline + "style"
            q = self.accepted(table([["SYN-A", name, "1,200.50", "1", "0"]], newline=newline))
            self.assertEqual(q["items"][0]["name"], name)
            self.assertEqual(q["items"][0]["unit_price"], 120050)
            self.assertEqual(q["row_count"], 1)
        for text in ('"unterminated', 'sku,name,unit_price,moq,tax_bps\nSYN-A,"unterminated',
                     'sku,name,unit_price,moq,tax_bps\nSYN-A,"Synthetic"bad,1,1,0'):
            self.rejected(text, "CSV_FORMAT")

    def test_row_width_and_logical_numbering(self):
        text = table([["SYN-A", "Synthetic\nstyle", "1", "1", "0"], ["SYN-B"],
                      ["SYN-C", "Synthetic", "1", "1", "0", "extra"]])
        q = self.rejected(text, "ROW_WIDTH", 2)
        self.assertEqual(q["errors"], [{"row": 2, "column": None, "code": "ROW_WIDTH"},
                                      {"row": 3, "column": None, "code": "ROW_WIDTH"}])
        self.assertEqual(q["row_count"], 3)

    def test_sku_injection_and_character_rules(self):
        for sku in ("=SUM(A1)", "+SKU", "-SKU", "@SKU", " SKU", "SKU ", "SYN/A", "SYN:A", "SYN\nA", "", "ＳＫＵ", "SYNé"):
            with self.subTest(sku=sku):
                q = self.rejected(table([[sku, "Synthetic", "1", "1", "0"]]), "INVALID_SKU", 1, "sku")
                self.assertEqual(q["errors"], [{"row": 1, "column": "sku", "code": "INVALID_SKU"}])
        for sku in ("SYN.A_b-9", "_SYN", ".SYN", "S" * 40):
            self.accepted(table([[sku, "Synthetic", "1", "1", "0"]]))
        self.rejected(table([["S" * 41, "Synthetic", "1", "1", "0"]]), "INVALID_SKU")

    def test_sku_case_insensitive_duplicates(self):
        q = self.rejected(table([["SYN-A", "Synthetic", "1", "1", "0"],
                                 ["syn-a", "Synthetic", "1", "1", "0"]]), "DUPLICATE_SKU", 2, "sku")
        self.assertEqual(q["row_count"], 2)

    def test_name_bounds_and_no_tax_default(self):
        self.accepted(table([["SYN-A", "N" * 128, "1", "1", "0"]]))
        for name in ("", " \t ", "N" * 129):
            self.rejected(table([["SYN-A", name, "1", "1", "0"]]), "INVALID_NAME", 1, "name")
        self.rejected(table([["SYN-A", "Synthetic", "1", "1", ""]]), "INVALID_INTEGER", 1, "tax_bps")

    def test_integer_syntax_and_bounds(self):
        for column, position, minimum, maximum in (("moq", 3, 1, 10000), ("tax_bps", 4, 0, 10000)):
            for value in (minimum, maximum):
                r = ["SYN-A", "Synthetic", "1", "1", "0"]
                r[position] = str(value)
                self.accepted(table([r]))
            for value in (str(minimum - 1) if minimum else "10001", "10001", "9" * 200):
                r = ["SYN-A", "Synthetic", "1", "1", "0"]
                r[position] = value
                code = "INVALID_INTEGER" if value.startswith("-") else "INTEGER_OUT_OF_RANGE"
                self.rejected(table([r]), code, 1, column)
            for value in ("", "1.0", "1e2", "١", "１", "+1", "-1", "1,000", "true"):
                r = ["SYN-A", "Synthetic", "1", "1", "0"]
                r[position] = value
                self.rejected(table([r]), "INVALID_INTEGER", 1, column)

    def test_price_break_edges_and_rules(self):
        header = list(engine.REQUIRED) + list(engine.BREAK_COLUMNS)
        q = self.accepted(table([["SYN-A", "Synthetic", "5", "2", "0", "2", "5", "3", "4", "4", "4", "5", "3", "10000", "0.01"]], header))
        self.assertEqual(q["items"][0]["price_breaks"], [{"min_qty": 2, "unit_price": 500}, {"min_qty": 3, "unit_price": 400},
                                                     {"min_qty": 4, "unit_price": 400}, {"min_qty": 5, "unit_price": 300},
                                                     {"min_qty": 10000, "unit_price": 1}])
        h = list(engine.REQUIRED) + list(engine.BREAK_COLUMNS[:4])
        for tail, column in ((["1", "4", "", ""], "min_qty_1"), (["2", "6", "", ""], "price_1"),
                             (["2", "4", "2", "3"], "min_qty_2"), (["3", "4", "2", "3"], "min_qty_2"),
                             (["2", "3", "3", "4"], "price_2")):
            self.rejected(table([["SYN-A", "Synthetic", "5", "2", "0"] + tail], h), "INVALID_PRICE_BREAKS", 1, column)

    def test_break_missing_pairs_gaps_and_invalid_values(self):
        h = list(engine.REQUIRED) + list(engine.BREAK_COLUMNS[:4])
        for tail, code, column in ((["2", "", "", ""], "INCOMPLETE_BREAK", "price_1"),
                                   (["", "4", "", ""], "INCOMPLETE_BREAK", "min_qty_1"),
                                   (["", "", "3", "4"], "BREAK_GAP", "min_qty_2"),
                                   (["x", "4", "", ""], "INVALID_INTEGER", "min_qty_1"),
                                   (["10001", "4", "", ""], "INTEGER_OUT_OF_RANGE", "min_qty_1"),
                                   (["2", "1.001", "", ""], "INVALID_MONEY", "price_1"),
                                   (["2", "1000000.01", "", ""], "MONEY_OUT_OF_RANGE", "price_1")):
            self.rejected(table([["SYN-A", "Synthetic", "5", "2", "0"] + tail], h), code, 1, column)
        h = list(engine.REQUIRED) + ["min_qty_2", "price_2"]
        self.rejected(table([["SYN-A", "Synthetic", "5", "2", "0", "3", "4"]], h), "BREAK_GAP")

    def test_all_or_nothing_and_multiple_errors(self):
        q = self.rejected(table([["SYN-A", "Synthetic", "1", "1", "0"],
                                 ["@SECRET_SYN", "", "-1", "0", "bad"]]), "INVALID_SKU", 2, "sku")
        self.assertEqual(q["row_count"], 2)
        self.assertEqual([e["code"] for e in q["errors"]], ["INVALID_SKU", "INVALID_NAME", "INVALID_MONEY", "INTEGER_OUT_OF_RANGE", "INVALID_INTEGER"])
        self.assertNotIn("SECRET_SYN", engine.canonical_json(q))

    def test_hash_determinism_sorting_and_roundtrip(self):
        q = self.accepted(fixture()["csv"])
        self.assertEqual(q, engine.parse(fixture()["csv"]))
        self.assertEqual(q, json.loads(engine.canonical_json(q)))
        self.assertEqual(q["canonical_hash"], "ab588200208063c787ac22fc51b10a3b7a6cc6ec4d0448ad5028b1a2bb88b8d6")
        text = fixture()["csv"].splitlines()
        self.assertEqual(q, engine.parse("\n".join([text[0]] + list(reversed(text[1:]))) + "\n"))
        self.assertEqual(q, engine.parse("\ufeff" + fixture()["csv"].replace("\n", "\r\n")))
        self.assertNotEqual(q["canonical_hash"], self.accepted(fixture()["csv"].replace("1200", "1201"))["canonical_hash"])

    def test_wrong_types_and_invalid_utf8(self):
        for value in (None, True, 1, [], {}, b"sku"):
            with self.assertRaisesRegex(TypeError, "^Expected str$"):
                engine.parse(value)
        self.rejected("\ud800", "INVALID_UTF8", 0)
        with self.assertRaises(TypeError):
            engine.canonical_json(json.loads("1.5"))

    def test_header_only_empty_list(self):
        q = self.accepted(table([]))
        self.assertEqual(q["items"], [])
        self.assertEqual(q["row_count"], 0)

    def test_250_seeded_documented_engine_contract(self):
        rng = random.Random(1009)
        expected_keys = {"sku", "name", "unit_price", "minimum_order_quantity", "price_breaks", "tax_bps"}
        for case in range(250):
            rows, expected = [], []
            count = rng.randint(1, 15)
            for i in range(count):
                qty = rng.randint(1, 9995)
                price = rng.randint(1, 100000000)
                item = {"sku": "SYN-" + str(i).zfill(3), "name": 'Synthetic, "woven" ' + str(i),
                        "unit_price": price, "minimum_order_quantity": qty, "tax_bps": rng.randint(0, 10000), "price_breaks": []}
                money = lambda amount: str(amount // 100) + "." + str(amount % 100).zfill(2)
                row = [item["sku"], item["name"], money(price), str(qty), str(item["tax_bps"])]
                for j in range(5):
                    if rng.randrange(2) and len(item["price_breaks"]) == j:
                        price = rng.randint(1, price)
                        item["price_breaks"].append({"min_qty": qty + j, "unit_price": price})
                        row += [str(qty + j), money(price)]
                    else:
                        row += ["", ""]
                rows.append(row)
                expected.append(item)
            with self.subTest(case=case):
                untouched = copy.deepcopy(rows)
                q = self.accepted(table(rows, list(engine.REQUIRED) + list(engine.BREAK_COLUMNS)))
                self.assertEqual(q["items"], expected)
                self.assertEqual(rows, untouched)
                self.assertEqual(q, engine.parse(table(rows, list(engine.REQUIRED) + list(engine.BREAK_COLUMNS))))
                rng.shuffle(rows)
                self.assertEqual(q, engine.parse(table(rows, list(engine.REQUIRED) + list(engine.BREAK_COLUMNS))))
                for item in q["items"]:
                    self.assertEqual(set(item), expected_keys)
                    self.assertTrue(all(type(item[k]) is int for k in ("unit_price", "minimum_order_quantity", "tax_bps")))
                    self.assertTrue(0 < item["unit_price"] <= 100000000)
                    self.assertTrue(1 <= item["minimum_order_quantity"] <= 10000)
                    self.assertTrue(0 <= item["tax_bps"] <= 10000)
                    prior_qty, prior_price = 0, item["unit_price"]
                    for br in item["price_breaks"]:
                        self.assertEqual(set(br), {"min_qty", "unit_price"})
                        self.assertTrue(item["minimum_order_quantity"] <= br["min_qty"] <= 10000)
                        self.assertGreater(br["min_qty"], prior_qty)
                        self.assertTrue(0 < br["unit_price"] <= prior_price)
                        prior_qty, prior_price = br["min_qty"], br["unit_price"]
