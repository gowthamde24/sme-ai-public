import copy
from datetime import date, timedelta
import unittest

import followup_cadence as engine
from test_cadence import fixture


class LimitTests(unittest.TestCase):
    def assert_bound(self, path, maximum, prepare=None):
        for value, rejected in ((maximum, False), (maximum + 1, True)):
            r = fixture()
            if prepare:
                prepare(r, value)
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            result = engine.decide(r)
            with self.subTest(path=path, value=value):
                self.assertEqual("codes" in result, rejected)
                if rejected:
                    self.assertEqual(result["codes"], ["OUT_OF_RANGE"])

    def test_scalar_limits(self):
        self.assert_bound(("policy", "gap_days", 0), engine.MAX_GAP_DAYS)
        self.assert_bound(("policy", "min_gap_hours"), engine.MAX_MIN_GAP_HOURS)
        self.assert_bound(("policy", "max_touches"), engine.MAX_TOUCHES,
                          lambda r, v: r["policy"].update(gap_days=[0] * min(v - 1, engine.MAX_GAPS)))
        self.assert_bound(("recipient_utc_offset_minutes",), engine.MAX_OFFSET_MINUTES)
        for value, rejected in ((-engine.MAX_OFFSET_MINUTES, False), (-engine.MAX_OFFSET_MINUTES - 1, True)):
            r = fixture()
            r["recipient_utc_offset_minutes"] = value
            self.assertEqual("codes" in engine.decide(r), rejected)
        self.assert_bound(("policy", "allowed_weekdays", 0), 6,
                          lambda r, v: r["policy"].update(allowed_weekdays=[0]))

    def test_list_limits(self):
        for field, maximum in (("history", engine.MAX_HISTORY), ("gap_days", engine.MAX_GAPS),
                               ("holidays", engine.MAX_HOLIDAYS), ("allowed_weekdays", engine.MAX_WEEKDAYS)):
            for size in (maximum, maximum + 1):
                r = fixture()
                if field == "history":
                    r[field] = [copy.deepcopy(r[field][0]) for _ in range(size)]
                elif field == "gap_days":
                    r["policy"].update(gap_days=[0] * size, max_touches=engine.MAX_TOUCHES)
                elif field == "holidays":
                    r["policy"][field] = [(date(2026, 1, 1) + timedelta(days=i)).isoformat() for i in range(size)]
                else:
                    r["policy"][field] = list(range(size))
                result = engine.decide(r)
                with self.subTest(field=field, size=size):
                    self.assertEqual("codes" in result, size > maximum)
                    if size > maximum:
                        self.assertEqual(result["codes"], ["OUT_OF_RANGE"])

    def test_string_limits(self):
        for field in ("channel", "outcome"):
            for size in (engine.MAX_STRING_LENGTH, engine.MAX_STRING_LENGTH + 1):
                r = fixture()
                r["history"][0][field] = "S" * size
                result = engine.decide(r)
                self.assertEqual("codes" in result, size > engine.MAX_STRING_LENGTH)
                if "codes" in result:
                    self.assertEqual(result["codes"], ["OUT_OF_RANGE"])

    def test_quiet_time_limits(self):
        for field in ("start", "end"):
            r = fixture()
            r["policy"]["quiet_hours"][field] = "23:59"
            self.assertNotIn("codes", engine.decide(r))
            r["policy"]["quiet_hours"][field] = "24:00"
            self.assertEqual(engine.decide(r)["codes"], ["OUT_OF_RANGE"])

    def test_preflight_depth_nodes_fields_integer_and_keys(self):
        # Direct structural checks isolate preflight acceptance from schema
        # rejection; a valid request never needs these malformed shapes.
        for depth in (engine.MAX_DEPTH, engine.MAX_DEPTH + 1):
            value = None
            for _ in range(depth - 1):
                value = [value]
            r = {"extra": value}
            if depth == engine.MAX_DEPTH:
                engine._bounded(r)
            else:
                self.assertEqual(engine.decide(r)["codes"], ["OUT_OF_RANGE"])
        for count in (engine.MAX_NODES, engine.MAX_NODES + 1):
            # root dict + outer list + ten inner lists + count-12 leaves.
            leaves = count - 12
            r = {"extra": [[None] * 1000 for _ in range(9)] + [[None] * (leaves - 9000)]}
            if count == engine.MAX_NODES:
                engine._bounded(r)
            else:
                self.assertEqual(engine.decide(r)["codes"], ["OUT_OF_RANGE"])
        for count in (engine.MAX_OBJECT_FIELDS, engine.MAX_OBJECT_FIELDS + 1):
            r = {"S" + str(i): None for i in range(count)}
            if count == engine.MAX_OBJECT_FIELDS:
                engine._bounded(r)
            else:
                self.assertEqual(engine.decide(r)["codes"], ["OUT_OF_RANGE"])
        for value in (engine.MAX_INTEGER, -engine.MAX_INTEGER):
            engine._bounded({"extra": value})
        for value in (engine.MAX_INTEGER + 1, -engine.MAX_INTEGER - 1):
            self.assertEqual(engine.decide({"extra": value})["codes"], ["OUT_OF_RANGE"])
        engine._bounded({"S" * engine.MAX_STRING_LENGTH: None})
        self.assertEqual(engine.decide({"S" * (engine.MAX_STRING_LENGTH + 1): None})["codes"], ["OUT_OF_RANGE"])
        for name, value in vars(engine).items():
            if name.startswith("MAX_") and name != "MAX_NODES":
                self.assertLessEqual(value, engine.MAX_INTEGER)

    def test_oversize_precedes_hash_parsing_and_item_work(self):
        requests = []
        for field in ("history", "gap_days", "holidays", "allowed_weekdays"):
            r = fixture()
            if field == "history":
                r[field] = [object()] * 100_000
            else:
                r["policy"][field] = [object()] * 100_000
                r["history"] = [object()]  # policy size must precede touch work
            requests.append(r)
        r = fixture()
        r["policy"]["min_gap_hours"] = 10 ** 30
        requests.append(r)
        for r in requests:
            saved_json, saved_validate = engine.canonical_json, engine._validate
            def forbidden(*args):
                raise AssertionError("Oversize reached hashing or validation")
            try:
                engine.canonical_json = engine._validate = forbidden
                q = engine.decide(r)
            finally:
                engine.canonical_json, engine._validate = saved_json, saved_validate
            self.assertEqual(q["codes"], ["OUT_OF_RANGE"])
            self.assertIsNone(q["canonical_hash"])
