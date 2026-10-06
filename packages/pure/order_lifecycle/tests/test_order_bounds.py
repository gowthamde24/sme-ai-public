import copy
import unittest

import order_lifecycle as engine
from test_lifecycle import event, fixture


class OrderBoundsTests(unittest.TestCase):
    def test_amount_upper_bound(self):
        for path in (("order_total",), ("policy", "advance_amount"),
                     ("payments", 0, "amount"), ("refunds", 0, "amount"), ("event", "amount")):
            for amount in (engine.MAX_AMOUNT, engine.MAX_AMOUNT + 1):
                r = fixture("accepted", "record_payment" if path[0] == "event" else "request_advance")
                r["order_total"] = engine.MAX_AMOUNT
                if path[0] == "refunds":
                    r["payments"][0]["amount"] = engine.MAX_AMOUNT
                    r["refunds"] = [{"refund_id": "SYN-R0", "amount": 1}]
                if path[0] == "event":
                    r["payments"] = []
                target = r
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = amount
                q = engine.transition(r)
                with self.subTest(path=path, amount=amount):
                    self.assertEqual(q["status"], "ok" if amount == engine.MAX_AMOUNT else "rejected")
                    if q["status"] == "rejected":
                        self.assertEqual(q["codes"], ["OUT_OF_RANGE"])
        r = fixture("accepted", "record_refund")
        r.update(order_total=engine.MAX_AMOUNT, payments=[{"payment_id": "SYN-P0", "amount": engine.MAX_AMOUNT}])
        r["event"]["amount"] = engine.MAX_AMOUNT
        self.assertEqual(engine.transition(r)["status"], "ok")
        r["event"]["amount"] += 1
        self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])

    def test_positive_event_and_ledger_amounts(self):
        for kind, id_key in (("record_payment", "payment_id"), ("record_refund", "refund_id")):
            r = fixture("accepted", kind)
            for amount in (0, -1):
                r["event"]["amount"] = amount
                self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])
            r["event"]["amount"] = 1
            self.assertEqual(engine.transition(r)["status"], "ok")
        for field, key in (("payments", "payment_id"), ("refunds", "refund_id")):
            r = fixture()
            r[field] = [{key: "SYN-X", "amount": 0}]
            self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])

    def test_collection_limits(self):
        for field, key in (("payments", "payment_id"), ("refunds", "refund_id")):
            for size in (engine.MAX_RECORDS, engine.MAX_RECORDS + 1):
                r = fixture()
                r.update(order_total=engine.MAX_AMOUNT)
                r[field] = [{key: "SYN-" + str(i), "amount": 1} for i in range(size)]
                if field == "refunds":
                    r["payments"][0]["amount"] = engine.MAX_RECORDS
                q = engine.transition(r)
                self.assertEqual(q["status"], "ok" if size == engine.MAX_RECORDS else "rejected")
                if q["status"] == "rejected":
                    self.assertEqual(q["codes"], ["OUT_OF_RANGE"])

    def test_proposed_entry_capacity_and_allowed_events(self):
        for field, key, name in (("payments", "payment_id", "record_payment"), ("refunds", "refund_id", "record_refund")):
            r = fixture("accepted", name)
            r["order_total"] = engine.MAX_RECORDS + 10
            r[field] = [{key: "SYN-" + str(i), "amount": 1} for i in range(engine.MAX_RECORDS - 1)]
            if field == "refunds":
                r["payments"][0]["amount"] = engine.MAX_RECORDS + 10
            q = engine.transition(r)
            self.assertEqual(q["status"], "ok")
            self.assertNotIn(name, q["allowed_next_events"])
            r[field].append({key: "SYN-LAST", "amount": 1})
            self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])

    def test_identifier_length_limit(self):
        for field, key in (("payments", "payment_id"), ("refunds", "refund_id"), ("event", "payment_id")):
            for size in (engine.MAX_STRING_LENGTH, engine.MAX_STRING_LENGTH + 1):
                r = fixture("accepted", "record_payment" if field == "event" else "request_advance")
                if field == "refunds":
                    r[field] = [{key: "SYN-R0", "amount": 1}]
                target = r[field] if field == "event" else r[field][0]
                target[key] = "S" * size
                q = engine.transition(r)
                self.assertEqual(q["status"], "ok" if size == engine.MAX_STRING_LENGTH else "rejected")
                if q["status"] == "rejected":
                    self.assertEqual(q["codes"], ["OUT_OF_RANGE"])
        r = fixture("accepted", "record_refund")
        r["event"]["refund_id"] = "S" * engine.MAX_STRING_LENGTH
        self.assertEqual(engine.transition(r)["status"], "ok")
        r["event"]["refund_id"] += "S"
        self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])

    def test_preflight_structural_budgets(self):
        for depth in (engine.MAX_DEPTH, engine.MAX_DEPTH + 1):
            value = None
            for _ in range(depth - 1):
                value = [value]
            r = {"x": value}
            if depth == engine.MAX_DEPTH:
                engine._bounded(r)
            else:
                self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])
        for nodes in (engine.MAX_NODES, engine.MAX_NODES + 1):
            r = {"x": [[None] * 1000 for _ in range(11)] + [[None] * (nodes - 14 - 11000)]}
            if nodes == engine.MAX_NODES:
                engine._bounded(r)
            else:
                self.assertEqual(engine.transition(r)["codes"], ["OUT_OF_RANGE"])
        engine._bounded({str(i): None for i in range(engine.MAX_OBJECT_FIELDS)})
        self.assertEqual(engine.transition({str(i): None for i in range(engine.MAX_OBJECT_FIELDS + 1)})["codes"], ["OUT_OF_RANGE"])
        engine._bounded({"S" * engine.MAX_STRING_LENGTH: None})
        self.assertEqual(engine.transition({"S" * (engine.MAX_STRING_LENGTH + 1): None})["codes"], ["OUT_OF_RANGE"])

    def test_huge_inputs_precede_hash_and_item_work(self):
        requests = []
        for field in ("payments", "refunds"):
            r = fixture()
            r[field] = [object()] * 100_000
            requests.append(r)
        for path in (("order_total",), ("event", "amount"), ("policy", "advance_amount")):
            r = fixture("accepted", "record_payment")
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = 10 ** 30
            requests.append(r)
        for r in requests:
            saved_json, saved_validate = engine.canonical_json, engine._validate
            def forbidden(*args):
                raise AssertionError("Oversize reached hash or validation")
            try:
                engine.canonical_json = engine._validate = forbidden
                q = engine.transition(r)
            finally:
                engine.canonical_json, engine._validate = saved_json, saved_validate
            self.assertEqual(q["codes"], ["OUT_OF_RANGE"])
            self.assertIsNone(q["canonical_hash"])

    def test_timestamp_edges(self):
        for timestamp in ("0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z"):
            r = fixture()
            r.update(as_of=timestamp, valid_until=timestamp)
            self.assertEqual(engine.transition(r)["status"], "ok")
        r["as_of"] = "10000-01-01T00:00:00Z"
        self.assertEqual(engine.transition(r)["codes"], ["INVALID_TIMESTAMP"])
