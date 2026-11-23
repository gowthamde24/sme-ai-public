import copy
import hashlib
import json
from pathlib import Path
import random
import unittest

import order_lifecycle as engine
from order_lifecycle import canonical_json, transition

STATES = ("quote_approved", "quote_sent", "accepted", "advance_requested", "advance_paid",
          "in_preparation", "dispatched", "delivered", "closed_paid", "declined", "expired", "cancelled")
EVENTS = ("send_quote", "customer_accept", "customer_decline", "expire", "request_advance",
          "record_payment", "start_preparation", "dispatch", "deliver", "cancel", "record_refund")
# Independent expectation, not an import of the engine matrix.
ALLOWED = {
    "quote_approved": {"send_quote", "expire", "cancel"},
    "quote_sent": {"customer_accept", "customer_decline", "expire", "cancel"},
    "accepted": {"request_advance", "record_payment", "start_preparation", "cancel", "record_refund"},
    "advance_requested": {"record_payment", "start_preparation", "cancel", "record_refund"},
    "advance_paid": {"record_payment", "start_preparation", "cancel", "record_refund"},
    "in_preparation": {"record_payment", "dispatch", "cancel", "record_refund"},
    "dispatched": {"record_payment", "deliver", "record_refund"},
    "delivered": {"record_payment", "record_refund"},
    "closed_paid": set(), "declined": set(), "expired": set(), "cancelled": set(),
}


def fixture(state="quote_approved", name="send_quote"):
    r = json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())
    r["current_state"] = state
    r["event"] = event(name)
    return r


def event(name, amount=1, identifier="SYN-NEW"):
    e = {"type": name}
    if name in ("record_payment", "record_refund"):
        e.update(amount=amount)
        e["payment_id" if name == "record_payment" else "refund_id"] = identifier
    return e


class LifecycleTests(unittest.TestCase):
    def ok(self, r):
        q = transition(r)
        self.assertEqual(q["status"], "ok", q.get("codes"))
        self.assertNotIn("codes", q)
        return q

    def reject(self, r, code):
        q = transition(r)
        self.assertEqual(q["status"], "rejected")
        self.assertEqual(q["codes"], [code])
        self.assertIsNone(q["new_state"])
        self.assertEqual(q["allowed_next_events"], [])
        return q

    def test_full_state_event_matrix(self):
        tested = 0
        for state in STATES:
            for name in EVENTS:
                r = fixture(state, name)
                if state == "closed_paid":
                    r["payments"][0]["amount"] = r["order_total"]
                if name == "expire":
                    r["as_of"] = "2026-10-06T06:00:01Z"
                with self.subTest(state=state, event=name):
                    if name in ALLOWED[state]:
                        self.ok(r)
                    else:
                        self.reject(r, "ILLEGAL_TRANSITION")
                tested += 1
        self.assertEqual(tested, 132)
        self.assertEqual(set(engine.STATES), set(STATES))
        self.assertEqual(set(engine.EVENTS), set(EVENTS))

    def test_structural_target_states(self):
        expected = [("quote_approved", "send_quote", "quote_sent"),
                    ("quote_sent", "customer_accept", "accepted"),
                    ("quote_sent", "customer_decline", "declined"),
                    ("accepted", "request_advance", "advance_requested"),
                    ("accepted", "start_preparation", "in_preparation"),
                    ("advance_requested", "start_preparation", "in_preparation"),
                    ("advance_paid", "start_preparation", "in_preparation"),
                    ("in_preparation", "dispatch", "dispatched"),
                    ("dispatched", "deliver", "delivered")]
        for state, name, target in expected:
            self.assertEqual(self.ok(fixture(state, name))["new_state"], target)

    def test_expiry_boundary_and_before_accepted(self):
        for state in ("quote_approved", "quote_sent"):
            for stamp, allowed in (("2026-10-06T05:59:59Z", False),
                                   ("2026-10-06T06:00:00Z", False),
                                   ("2026-10-06T06:00:01Z", True)):
                r = fixture(state, "expire")
                r["as_of"] = stamp
                if allowed:
                    self.assertEqual(self.ok(r)["new_state"], "expired")
                else:
                    self.reject(r, "QUOTE_NOT_EXPIRED")
        self.reject(fixture("accepted", "expire"), "ILLEGAL_TRANSITION")

    def test_send_and_accept_validity_boundary(self):
        for state, name in (("quote_approved", "send_quote"), ("quote_sent", "customer_accept")):
            r = fixture(state, name)
            r["as_of"] = r["valid_until"]
            self.ok(r)
            r["as_of"] = "2026-10-06T06:00:01Z"
            self.reject(r, "QUOTE_EXPIRED")

    def test_advance_preparation_guard(self):
        for state in ("accepted", "advance_requested", "advance_paid"):
            r = fixture(state, "start_preparation")
            r["payments"][0]["amount"] = 99
            self.reject(r, "ADVANCE_NOT_PAID")
            r["flags"]["owner_override"] = True
            self.reject(r, "ADVANCE_NOT_PAID")
            r["payments"][0]["amount"] = 100
            self.assertEqual(self.ok(r)["new_state"], "in_preparation")
            r["payments"][0]["amount"] = 1
            r["policy"]["advance_required"] = False
            self.ok(r)

    def test_dispatch_advance_and_override(self):
        r = fixture("in_preparation", "dispatch")
        r["payments"][0]["amount"] = 99
        self.reject(r, "ADVANCE_NOT_PAID")
        r["flags"]["owner_override"] = True
        q = self.ok(r)
        self.assertEqual(q["new_state"], "dispatched")
        self.assertEqual(q["flags"]["reasons"], [{"code": "ADVANCE_OVERRIDE", "paid_total": 99, "advance_amount": 100}])
        r["payments"][0]["amount"] = 100
        self.assertFalse(self.ok(r)["flags"]["needs_owner_approval"])
        r["flags"]["owner_override"] = False
        r["payments"][0]["amount"] = 1
        r["policy"]["dispatch_requires_advance"] = False
        self.ok(r)

    def test_advance_payment_and_refund_threshold(self):
        r = fixture("advance_requested", "record_payment")
        r["payments"][0]["amount"] = 98
        self.assertEqual(self.ok(r)["new_state"], "advance_requested")
        r["event"]["amount"] = 2
        self.assertEqual(self.ok(r)["new_state"], "advance_paid")
        r = fixture("advance_paid", "record_refund")
        self.assertEqual(self.ok(r)["new_state"], "advance_requested")
        r["payments"][0]["amount"] = 101
        self.assertEqual(self.ok(r)["new_state"], "advance_paid")
        r["policy"]["advance_required"] = False
        r["payments"][0]["amount"] = 100
        self.assertEqual(self.ok(r)["new_state"], "advance_paid")

    def test_payment_progression_only_early_states(self):
        for state in ("accepted", "advance_requested"):
            self.assertEqual(self.ok(fixture(state, "record_payment"))["new_state"], "advance_paid")
        for state in ("advance_paid", "in_preparation", "dispatched", "delivered"):
            self.assertEqual(self.ok(fixture(state, "record_payment"))["new_state"], state)
        r = fixture("accepted", "record_payment")
        r["policy"]["advance_required"] = False
        self.assertEqual(self.ok(r)["new_state"], "accepted")

    def test_closed_only_delivered_and_exactly_paid(self):
        for amount, target in ((999, "delivered"), (1000, "closed_paid")):
            r = fixture("dispatched", "deliver")
            r["payments"][0]["amount"] = amount
            q = self.ok(r)
            self.assertEqual(q["new_state"], target)
            self.assertEqual(q["balance_due"], 1000 - amount)
            if target == "closed_paid":
                self.assertEqual(q["allowed_next_events"], [])
        r = fixture("delivered", "record_payment")
        r["event"]["amount"] = 900
        self.assertEqual(self.ok(r)["new_state"], "closed_paid")
        r = fixture("in_preparation", "record_payment")
        r["event"]["amount"] = 900
        self.assertEqual(self.ok(r)["new_state"], "in_preparation")
        self.reject(fixture("closed_paid", "record_refund"), "CLOSED_UNPAID")

    def test_money_payment_refund_and_conservation(self):
        r = fixture("accepted", "record_payment")
        r["payments"].append({"payment_id": "SYN-P1", "amount": 200})
        r["refunds"] = [{"refund_id": "SYN-R0", "amount": 50}]
        r["event"]["amount"] = 75
        q = self.ok(r)
        self.assertEqual((q["paid_total"], q["balance_due"]), (325, 675))
        r["event"] = event("record_refund", 75)
        q = self.ok(r)
        self.assertEqual((q["paid_total"], q["balance_due"]), (175, 825))
        self.assertEqual(q["flags"]["reasons"][0]["code"], "REFUND_REQUIRES_OWNER_APPROVAL")

    def test_overpayment_rejects_and_flags(self):
        r = fixture("accepted", "record_payment")
        r["event"]["amount"] = 900
        self.assertEqual(self.ok(r)["balance_due"], 0)
        r["event"]["amount"] = 901
        q = self.reject(r, "OVERPAYMENT")
        self.assertEqual((q["paid_total"], q["balance_due"]), (100, 900))
        self.assertTrue(q["flags"]["needs_owner_approval"])
        self.assertEqual(q["flags"]["reasons"][0]["code"], "OVERPAYMENT")
        r["payments"][0]["amount"] = 1001
        q = self.reject(r, "OVERPAYMENT")
        self.assertTrue(q["flags"]["needs_owner_approval"])
        self.assertIsNone(q["paid_total"])
        self.assertIsNone(q["balance_due"])

    def test_refund_cannot_exceed_paid(self):
        r = fixture("accepted", "record_refund")
        r["event"]["amount"] = 100
        q = self.ok(r)
        self.assertEqual((q["paid_total"], q["balance_due"]), (0, 1000))
        r["event"]["amount"] = 101
        self.reject(r, "REFUND_EXCEEDS_PAID")
        r["refunds"] = [{"refund_id": "SYN-R0", "amount": 101}]
        self.reject(r, "REFUND_EXCEEDS_PAID")

    def test_idempotency_history_and_incoming(self):
        for kind, id_key, code in (("payments", "payment_id", "DUPLICATE_PAYMENT_ID"),
                                   ("refunds", "refund_id", "DUPLICATE_REFUND_ID")):
            r = fixture("accepted", "record_payment" if kind == "payments" else "record_refund")
            r[kind] = [{id_key: "SYN-X", "amount": 1}] * 2
            self.reject(r, code)
            r[kind].pop()
            r["event"][id_key] = "SYN-X"
            self.reject(r, code)
        # Payment/refund identifiers occupy separate namespaces.
        r = fixture("accepted", "record_refund")
        r["event"]["refund_id"] = r["payments"][0]["payment_id"]
        self.ok(r)

    def test_cancel_window_and_post_dispatch(self):
        r = fixture("accepted", "cancel")
        r["policy"]["cancel_allowed_until_state"] = "accepted"
        q = self.ok(r)
        self.assertEqual(q["new_state"], "cancelled")
        self.assertEqual(q["flags"]["reasons"][0]["code"], "CANCELLATION_WITH_FUNDS")
        r["current_state"] = "advance_requested"
        self.reject(r, "CANCEL_WINDOW_CLOSED")
        r["flags"]["owner_override"] = True
        self.reject(r, "CANCEL_WINDOW_CLOSED")
        for state in ("dispatched", "delivered"):
            self.reject(fixture(state, "cancel"), "ILLEGAL_TRANSITION")
        r = fixture("accepted", "cancel")
        r["payments"] = []
        self.assertFalse(self.ok(r)["flags"]["needs_owner_approval"])

    def test_allowed_events_are_guard_filtered(self):
        r = fixture("quote_approved", "send_quote")
        self.assertEqual(self.ok(r)["allowed_next_events"], ["customer_accept", "customer_decline", "cancel"])
        r = fixture("accepted", "record_payment")
        r["payments"] = []
        self.assertNotIn("start_preparation", self.ok(r)["allowed_next_events"])
        r = fixture("advance_paid", "start_preparation")
        self.assertIn("dispatch", self.ok(r)["allowed_next_events"])
        r = fixture("dispatched", "deliver")
        r["payments"][0]["amount"] = 1000
        self.assertEqual(self.ok(r)["allowed_next_events"], [])
        r = fixture("accepted", "record_refund")
        r["event"]["amount"] = 100
        self.assertNotIn("record_refund", self.ok(r)["allowed_next_events"])

    def test_zero_total(self):
        r = fixture("dispatched", "deliver")
        r.update(order_total=0, payments=[])
        r["policy"].update(advance_required=False, advance_amount=0, dispatch_requires_advance=False)
        q = self.ok(r)
        self.assertEqual((q["paid_total"], q["balance_due"], q["new_state"]), (0, 0, "closed_paid"))

    def test_invalid_values_and_types(self):
        for path, value, code in ((("current_state",), "bogus", "INVALID_STATE"),
                                 (("event", "type"), "bogus", "INVALID_EVENT"),
                                 (("as_of",), "2026-02-30T06:00:00Z", "INVALID_TIMESTAMP"),
                                 (("valid_until",), "2026-10-06T06:00:00+00:00", "INVALID_TIMESTAMP"),
                                 (("policy", "advance_amount"), 1001, "INVALID_ADVANCE"),
                                 (("policy", "advance_amount"), 0, "INVALID_ADVANCE"),
                                 (("policy", "cancel_allowed_until_state"), "dispatched", "INVALID_CANCEL_WINDOW"),
                                 (("payments", 0, "payment_id"), "", "EMPTY_IDENTIFIER"),
                                 (("payments", 0, "amount"), 0, "OUT_OF_RANGE"),
                                 (("order_total",), -1, "OUT_OF_RANGE")):
            r = fixture()
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.reject(r, code)
        for path, value in ((("order_total",), True), (("order_total",), "1000"),
                            (("flags", "owner_override"), 1), (("policy", "advance_required"), None),
                            (("payments",), ()), (("event",), "send_quote")):
            r = fixture()
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.assertRaises(TypeError):
                transition(r)
        with self.assertRaises(TypeError):
            transition(json.loads("1.5"))
        r = fixture()
        r["extra"] = 1
        self.reject(r, "INVALID_FIELDS")

    def test_hash_determinism_roundtrip_and_immutability(self):
        r = fixture()
        before = copy.deepcopy(r)
        q = self.ok(r)
        self.assertEqual(r, before)
        self.assertEqual(q, transition(r))
        self.assertEqual(json.loads(canonical_json(q)), q)
        self.assertEqual(transition(dict(reversed(list(r.items())))), q)
        self.assertEqual(engine.ENGINE_VERSION, "1.0.0")
        self.assertEqual(q["canonical_hash"], hashlib.sha256(canonical_json(
            {"engine_version": "1.0.0", "inputs": r}).encode("utf-8")).hexdigest())
        self.assertEqual(q["canonical_hash"], "652cb5dff6df0e799c8d2eed251c4708d916566a914449aaccd9574728bfcbcf")
        def leaves(value, path=()):
            if type(value) is dict:
                for key, item in value.items():
                    yield from leaves(item, path + (key,))
            elif type(value) is list:
                for index, item in enumerate(value):
                    yield from leaves(item, path + (index,))
            else:
                yield path, value
        for path, value in leaves(r):
            altered = copy.deepcopy(r)
            target = altered
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = not value if type(value) is bool else value + 1 if type(value) is int else value + "x"
            self.assertNotEqual(transition(altered)["canonical_hash"], q["canonical_hash"])

    def test_250_seeded_sequences(self):
        rng = random.Random(1011)
        for sequence in range(250):
            r = fixture()
            r["payments"] = []
            r["policy"]["advance_required"] = bool(rng.randrange(2))
            r["policy"]["dispatch_requires_advance"] = bool(rng.randrange(2))
            r["policy"]["cancel_allowed_until_state"] = rng.choice(STATES[:6])
            for step in range(24):
                state = r["current_state"]
                choices = sorted(ALLOWED[state]) if step % 2 == 0 and ALLOWED[state] else list(EVENTS)
                name = rng.choice(choices)
                r["event"] = event(name, rng.randrange(1, 1101), f"SYN-{sequence}-{step}")
                r["flags"]["owner_override"] = bool(rng.randrange(2))
                if name == "expire":
                    r["as_of"] = "2026-10-06T06:00:01Z"
                before = copy.deepcopy(r)
                q = transition(r)
                self.assertEqual(r, before)
                self.assertEqual(q, transition(r))
                self.assertEqual(q["canonical_hash"], transition(r)["canonical_hash"])
                if q["status"] == "ok":
                    self.assertIn(name, ALLOWED[state])
                    if name == "record_payment":
                        r["payments"].append({"payment_id": r["event"]["payment_id"], "amount": r["event"]["amount"]})
                    if name == "record_refund":
                        r["refunds"].append({"refund_id": r["event"]["refund_id"], "amount": r["event"]["amount"]})
                    r["current_state"] = q["new_state"]
                else:
                    self.assertIsNone(q["new_state"])
                    self.assertEqual(r["current_state"], state)
                expected_paid = sum(p["amount"] for p in r["payments"]) - sum(p["amount"] for p in r["refunds"])
                self.assertEqual(q["paid_total"], expected_paid)
                self.assertEqual(q["balance_due"], r["order_total"] - expected_paid)
                self.assertGreaterEqual(q["paid_total"], 0)
                self.assertGreaterEqual(q["balance_due"], 0)
                if r["current_state"] == "closed_paid":
                    self.assertEqual(q["balance_due"], 0)
                if state in STATES[8:]:
                    self.assertEqual(q["codes"], ["ILLEGAL_TRANSITION"])
                    self.assertEqual(r["current_state"], state)
