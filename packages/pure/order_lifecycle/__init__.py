"""Pure INR order lifecycle proposals. No persistence, approvals or payment I/O."""
from datetime import datetime, timezone
import hashlib
import json

ENGINE_VERSION = "1.0.0"
MAX_AMOUNT = 1_000_000_000
MAX_RECORDS = 1_000
MAX_STRING_LENGTH = 128
MAX_DEPTH = 8
MAX_NODES = 12_000
MAX_OBJECT_FIELDS = 16

STATES = ("quote_approved", "quote_sent", "accepted", "advance_requested", "advance_paid",
          "in_preparation", "dispatched", "delivered", "closed_paid", "declined", "expired", "cancelled")
EVENTS = ("send_quote", "customer_accept", "customer_decline", "expire", "request_advance",
          "record_payment", "start_preparation", "dispatch", "deliver", "cancel", "record_refund")
PRE_DISPATCH = STATES[:6]
TERMINAL = STATES[8:]
# Structural matrix. Monetary/policy/time guards can further reject a pair.
MATRIX = {
    "quote_approved": {"send_quote": "quote_sent", "expire": "expired", "cancel": "cancelled"},
    "quote_sent": {"customer_accept": "accepted", "customer_decline": "declined", "expire": "expired", "cancel": "cancelled"},
    "accepted": {"request_advance": "advance_requested", "record_payment": "accepted", "start_preparation": "in_preparation", "cancel": "cancelled", "record_refund": "accepted"},
    "advance_requested": {"record_payment": "advance_requested", "start_preparation": "in_preparation", "cancel": "cancelled", "record_refund": "advance_requested"},
    "advance_paid": {"record_payment": "advance_paid", "start_preparation": "in_preparation", "cancel": "cancelled", "record_refund": "advance_paid"},
    "in_preparation": {"record_payment": "in_preparation", "dispatch": "dispatched", "cancel": "cancelled", "record_refund": "in_preparation"},
    "dispatched": {"record_payment": "dispatched", "deliver": "delivered", "record_refund": "dispatched"},
    "delivered": {"record_payment": "delivered", "record_refund": "delivered"},
    "closed_paid": {}, "declined": {}, "expired": {}, "cancelled": {},
}


class _Invalid(Exception):
    pass


def _typed(value, kind):
    if type(value) is not kind:
        raise TypeError("Expected " + kind.__name__)


def _fields(value, required):
    _typed(value, dict)
    if value.keys() != set(required):
        raise _Invalid("INVALID_FIELDS")


def _integer(value, minimum=0):
    _typed(value, int)
    if value < minimum or value > MAX_AMOUNT:
        raise _Invalid("OUT_OF_RANGE")


def _bounded(r):
    _typed(r, dict)
    for field in ("payments", "refunds"):
        if field in r:
            _typed(r[field], list)
            if len(r[field]) > MAX_RECORDS:
                raise _Invalid("OUT_OF_RANGE")
    stack = [(r, 0)]
    nodes = 0
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if depth > MAX_DEPTH or nodes > MAX_NODES:
            raise _Invalid("OUT_OF_RANGE")
        if type(value) is int:
            if value < -MAX_AMOUNT or value > MAX_AMOUNT:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is str:
            if len(value) > MAX_STRING_LENGTH:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is list:
            if len(value) > MAX_RECORDS:
                raise _Invalid("OUT_OF_RANGE")
            stack.extend((item, depth + 1) for item in value)
        elif type(value) is dict:
            if len(value) > MAX_OBJECT_FIELDS:
                raise _Invalid("OUT_OF_RANGE")
            for key, item in value.items():
                _typed(key, str)
                if len(key) > MAX_STRING_LENGTH:
                    raise _Invalid("OUT_OF_RANGE")
                stack.append((item, depth + 1))
        elif type(value) not in (bool, type(None)):
            raise TypeError("Only integer JSON values are supported")


def canonical_json(value):
    """Sorted compact ASCII JSON; strict JSON types and no floating point."""
    def check(item):
        if type(item) in (str, int, bool, type(None)):
            return
        if type(item) is list:
            for part in item:
                check(part)
        elif type(item) is dict:
            for key, part in item.items():
                _typed(key, str)
                check(part)
        else:
            raise TypeError("Only integer JSON values are supported")
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _timestamp(value):
    _typed(value, str)
    try:
        at = datetime.fromisoformat(value)
        if at.tzinfo != timezone.utc or at.isoformat(timespec="seconds").replace("+00:00", "Z") != value:
            raise ValueError()
        return at
    except ValueError:
        raise _Invalid("INVALID_TIMESTAMP") from None


def _identifier(value):
    _typed(value, str)
    if not value:
        raise _Invalid("EMPTY_IDENTIFIER")


def _ledger(records, id_key, duplicate_code):
    seen, total = set(), 0
    for record in records:
        _fields(record, (id_key, "amount"))
        _identifier(record[id_key])
        _integer(record["amount"], 1)
        if record[id_key] in seen:
            raise _Invalid(duplicate_code)
        seen.add(record[id_key])
        total += record["amount"]
    return total, seen


def _validate(r):
    _fields(r, ("current_state", "event", "as_of", "valid_until", "order_total", "payments", "refunds", "policy", "flags"))
    _typed(r["current_state"], str)
    if r["current_state"] not in STATES:
        raise _Invalid("INVALID_STATE")
    _typed(r["event"], dict)
    if "type" not in r["event"]:
        raise _Invalid("INVALID_FIELDS")
    name = r["event"]["type"]
    _typed(name, str)
    if name not in EVENTS:
        raise _Invalid("INVALID_EVENT")
    if name in ("record_payment", "record_refund"):
        key = "payment_id" if name == "record_payment" else "refund_id"
        _fields(r["event"], ("type", "amount", key))
        _integer(r["event"]["amount"], 1)
        _identifier(r["event"][key])
    else:
        _fields(r["event"], ("type",))
    now, until = _timestamp(r["as_of"]), _timestamp(r["valid_until"])
    _integer(r["order_total"])
    p = r["policy"]
    _fields(p, ("advance_required", "advance_amount", "dispatch_requires_advance", "cancel_allowed_until_state"))
    for key in ("advance_required", "dispatch_requires_advance"):
        _typed(p[key], bool)
    _integer(p["advance_amount"])
    if p["advance_amount"] > r["order_total"] or ((p["advance_required"] or p["dispatch_requires_advance"]) and p["advance_amount"] == 0):
        raise _Invalid("INVALID_ADVANCE")
    _typed(p["cancel_allowed_until_state"], str)
    if p["cancel_allowed_until_state"] not in PRE_DISPATCH:
        raise _Invalid("INVALID_CANCEL_WINDOW")
    _fields(r["flags"], ("owner_override",))
    _typed(r["flags"]["owner_override"], bool)
    payments, payment_ids = _ledger(r["payments"], "payment_id", "DUPLICATE_PAYMENT_ID")
    refunds, refund_ids = _ledger(r["refunds"], "refund_id", "DUPLICATE_REFUND_ID")
    return now, until, payments, refunds, payment_ids, refund_ids


def _guard(state, name, now, until, paid, r):
    p = r["policy"]
    if name == "expire" and now <= until:
        return "QUOTE_NOT_EXPIRED"
    if name in ("send_quote", "customer_accept") and now > until:
        return "QUOTE_EXPIRED"
    if name == "cancel" and PRE_DISPATCH.index(state) > PRE_DISPATCH.index(p["cancel_allowed_until_state"]):
        return "CANCEL_WINDOW_CLOSED"
    if name == "start_preparation" and p["advance_required"] and paid < p["advance_amount"]:
        return "ADVANCE_NOT_PAID"
    if name == "dispatch" and p["dispatch_requires_advance"] and paid < p["advance_amount"] and not r["flags"]["owner_override"]:
        return "ADVANCE_NOT_PAID"
    return None


def _allowed(state, now, until, paid, r):
    result = []
    for name in EVENTS:
        if name not in MATRIX[state] or _guard(state, name, now, until, paid, r):
            continue
        if name == "record_payment" and (paid >= r["order_total"] or len(r["payments"]) >= MAX_RECORDS):
            continue
        if name == "record_refund" and (paid == 0 or len(r["refunds"]) >= MAX_RECORDS):
            continue
        result.append(name)
    return result


def transition(request):
    """Propose one transition with net INR paise; never execute/approve it."""
    digest, paid, balance = None, None, None
    trace, reasons = [], []

    def rule(rule_id, **values):
        trace.append({"rule_id": rule_id, "inputs": values,
                      "text": rule_id + ": " + canonical_json(values)})

    def flag(code, **values):
        reasons.append({"code": code, **values})

    def output(status, new_state=None, allowed=(), code=None):
        result = {"status": status, "new_state": new_state, "allowed_next_events": list(allowed),
                  "balance_due": balance, "paid_total": paid,
                  "flags": {"needs_owner_approval": bool(reasons), "reasons": reasons},
                  "trace": trace, "engine_version": ENGINE_VERSION, "canonical_hash": digest}
        if code:
            result["codes"] = [code]
        return result

    try:
        _bounded(request)
    except _Invalid as exc:
        return output("rejected", code=str(exc))
    digest = hashlib.sha256(canonical_json({"engine_version": ENGINE_VERSION, "inputs": request}).encode("utf-8")).hexdigest()
    try:
        now, until, receipts, returns, payment_ids, refund_ids = _validate(request)
    except _Invalid as exc:
        return output("rejected", code=str(exc))
    net = receipts - returns
    rule("money.snapshot", payments=receipts, refunds=returns, net=net, order_total=request["order_total"])
    if net < 0:
        return output("rejected", code="REFUND_EXCEEDS_PAID")
    if net > request["order_total"]:
        flag("OVERPAYMENT", proposed_paid_total=net, order_total=request["order_total"])
        return output("rejected", code="OVERPAYMENT")
    paid, balance = net, request["order_total"] - net
    state, event, p = request["current_state"], request["event"], request["policy"]
    if state == "closed_paid" and balance != 0:
        paid = balance = None
        return output("rejected", code="CLOSED_UNPAID")
    name = event["type"]
    rule("state.matrix", current_state=state, event=name, allowed=name in MATRIX[state])
    if name not in MATRIX[state]:
        return output("rejected", code="ILLEGAL_TRANSITION")
    guard = _guard(state, name, now, until, paid, request)
    rule("state.guards", as_of=request["as_of"], valid_until=request["valid_until"],
         paid_total=paid, policy=p, owner_override=request["flags"]["owner_override"], rejection=guard)
    if guard:
        return output("rejected", code=guard)
    proposed = paid
    if name == "record_payment":
        if event["payment_id"] in payment_ids:
            return output("rejected", code="DUPLICATE_PAYMENT_ID")
        if len(request["payments"]) >= MAX_RECORDS:
            return output("rejected", code="OUT_OF_RANGE")
        proposed = paid + event["amount"]
        if proposed > request["order_total"]:
            flag("OVERPAYMENT", proposed_paid_total=proposed, order_total=request["order_total"])
            rule("payment.overpayment", amount=event["amount"], paid_total=paid, proposed=proposed)
            return output("rejected", code="OVERPAYMENT")
    elif name == "record_refund":
        if event["refund_id"] in refund_ids:
            return output("rejected", code="DUPLICATE_REFUND_ID")
        if len(request["refunds"]) >= MAX_RECORDS:
            return output("rejected", code="OUT_OF_RANGE")
        if event["amount"] > paid:
            return output("rejected", code="REFUND_EXCEEDS_PAID")
        proposed = paid - event["amount"]
        flag("REFUND_REQUIRES_OWNER_APPROVAL", amount=event["amount"], refund_id=event["refund_id"])
    if name == "dispatch" and p["dispatch_requires_advance"] and paid < p["advance_amount"]:
        flag("ADVANCE_OVERRIDE", paid_total=paid, advance_amount=p["advance_amount"])
    if name == "cancel" and paid > 0:
        flag("CANCELLATION_WITH_FUNDS", paid_total=paid)
    paid, balance = proposed, request["order_total"] - proposed
    new_state = MATRIX[state][name]
    if name == "record_payment" and state in ("accepted", "advance_requested") and p["advance_required"] and paid >= p["advance_amount"]:
        new_state = "advance_paid"
    if name == "record_refund" and state == "advance_paid" and p["advance_required"] and paid < p["advance_amount"]:
        new_state = "advance_requested"
    if new_state == "delivered" and balance == 0:
        new_state = "closed_paid"
    rule("state.result", new_state=new_state, paid_total=paid, balance_due=balance)
    # Capacity includes the proposed ledger entry; caller persists it only on ok.
    capacity_request = dict(request)
    if name == "record_payment":
        capacity_request["payments"] = request["payments"] + [{"payment_id": event["payment_id"], "amount": event["amount"]}]
    elif name == "record_refund":
        capacity_request["refunds"] = request["refunds"] + [{"refund_id": event["refund_id"], "amount": event["amount"]}]
    return output("ok", new_state, _allowed(new_state, now, until, paid, capacity_request))
