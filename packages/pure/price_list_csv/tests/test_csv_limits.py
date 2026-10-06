import unittest

import price_list_csv as engine
from test_price_csv import fixture, table


def bounded_text(size, value="a"):
    # Each cell <=200 characters, each record <=40 columns, records <=5001.
    cell = value * 200
    record = ",".join([cell] * 40) + "\n"
    full, remainder = divmod(size, len(record.encode("utf-8")))
    tail = record.encode("utf-8")[:remainder].decode("utf-8")
    return record * full + tail


class CSVLimitsTests(unittest.TestCase):
    def limit(self, text):
        q = engine.parse(text)
        self.assertFalse(q["ok"])
        self.assertEqual(q["errors"], [{"row": 0, "column": None, "code": "FILE_LIMIT"}])
        self.assertEqual(q["items"], [])
        self.assertEqual(q["row_count"], 0)
        self.assertIsNone(q["canonical_hash"])

    def test_rows_at_limit_and_one_above(self):
        rows = [["SYN-" + str(i), "Synthetic", "1", "1", "0"] for i in range(5000)]
        q = engine.parse(table(rows))
        self.assertTrue(q["ok"])
        self.assertEqual(q["row_count"], 5000)
        self.assertEqual(len(q["items"]), 5000)
        rows.append(["SYN-extra", "Synthetic", "1", "1", "0"])
        for trailing in (True, False):
            text = table(rows)
            self.limit(text if trailing else text.rstrip("\n"))

    def test_cell_limit_exact_quoted_and_unquoted(self):
        for value in ("0" * 197 + ".01", '"' * 200, "x\n" * 100, "₹" * 200):
            text = table([["SYN-A", "Synthetic", value, "1", "0"]])
            engine._preflight(text)
            self.limit(table([["SYN-A", "Synthetic", value + "x", "1", "0"]]))
        text = table([["SYN-A", "Synthetic", "0" * 197 + ".01", "1", "0"]])
        self.assertTrue(engine.parse(text)["ok"])

    def test_columns_limit_header_and_data(self):
        engine._preflight(",".join(["a"] * 40))
        self.limit(",".join(["a"] * 41))
        self.limit(table([["x"] * 41]))

    def test_utf8_byte_limit_and_bom_counts(self):
        for size in (engine.MAX_BYTES, engine.MAX_BYTES + 1):
            text = bounded_text(size)
            self.assertEqual(len(text.encode("utf-8")), size)
            if size == engine.MAX_BYTES:
                engine._preflight(text)
            else:
                self.limit(text)
        text = bounded_text(engine.MAX_BYTES - 3)
        engine._preflight("\ufeff" + text)
        self.limit("\ufeff" + bounded_text(engine.MAX_BYTES - 2))
        # Characters alone fit the bound, but UTF-8 bytes exceed it.
        text = bounded_text(engine.MAX_BYTES // 2 + 10000).replace("a", "é")
        self.assertLess(len(text), engine.MAX_BYTES)
        self.assertGreater(len(text.encode("utf-8")), engine.MAX_BYTES)
        self.limit(text)

    def test_oversize_never_reaches_csv_or_hash(self):
        texts = ("x" * (engine.MAX_BYTES + 1), "x" * 100000,
                 table([["SYN-A", "x" * 201, "bad", "1", "0"]]),
                 table([["x"] * 41]))
        saved_reader, saved_json = engine.csv.reader, engine.canonical_json
        def forbidden(*args, **kwargs):
            raise AssertionError("Oversize reached csv.reader/hash")
        try:
            engine.csv.reader = engine.canonical_json = forbidden
            for text in texts:
                self.limit(text)
        finally:
            engine.csv.reader, engine.canonical_json = saved_reader, saved_json

    def test_limits_override_prior_row_errors(self):
        self.limit(fixture()["csv"] + "@SYN,,bad,0,no\n" + "x" * 201)

    def test_hash_includes_all_valid_item_fields(self):
        baseline = fixture()["csv"]
        original = engine.parse(baseline)["canonical_hash"]
        for old, new in (("SYN-B", "SYN-C"), ("Synthetic weave B", "Synthetic weave C"),
                         ("1200", "1201"), (",2,500,2,", ",1,500,2,"),
                         (",500,", ",501,"), (",10,1000", ",11,1000"),
                         (",10,1000", ",10,999")):
            q = engine.parse(baseline.replace(old, new))
            self.assertTrue(q["ok"], q)
            self.assertNotEqual(original, q["canonical_hash"])

    def test_mirrored_quote_engine_limits(self):
        # Existing pure packages have no cross-package imports: documented v1.1.0
        # contract is asserted explicitly, rather than importing quote_engine.
        self.assertEqual(engine.MAX_UNIT_PRICE, 100000000)
        self.assertEqual(engine.MAX_QUANTITY_PER_LINE, 10000)
        self.assertEqual(engine.MAX_TAX_BPS, 10000)
        self.assertEqual(engine.MAX_IDENTIFIER_LENGTH, 128)
        self.assertEqual(engine.MAX_BREAKS, 5)
