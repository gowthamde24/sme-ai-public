"""The order REQUEST BUILDER: from an order's recorded state (the row, its policy version and its ledger) and ONE event a person reports, to the exact request the pinned lifecycle runs on.
Pure: no I/O, no clock (the caller gives `as_of`).

THE CONTRACT with the database (app.order_build, migration 20261019090000): record_order_event refuses (SM238) any request that is not the one the database builds from its own ledger, so this
module must produce it as the same JSON value (object key order does not matter; the ARRAYS do):
  * current_state = the order's state (the cache the ledger agrees with);
  * event         = {"type"} or {"type", "amount", "payment_id"} (record_payment) or {"type", "amount", "refund_id"} (record_refund);
  * as_of         = the API's now, UTC, whole seconds, "YYYY-MM-DDTHH:MM:SSZ" (the database bounds it to its own clock);
  * valid_until   = the quote's valid-until DATE at 23:59:59 India time, as UTC, same format (a quote is valid through its last day);
  * order_total   = the order's total in paise (copied from the approved quote);
  * payments / refunds = the ledger's `record_payment` / `record_refund` events in `seq` order, each {payment_id | refund_id, amount} (ids are lower-case UUID text);
  * policy        = {advance_required, advance_amount (the ORDER's advance, copied from the quote), dispatch_requires_advance, cancel_allowed_until_state};
  * flags         = {"owner_override": true only for an OWNER dispatching; false for every other event and role}. A caller never supplies it: it is derived from the role the token proved.
The integration tests build requests with this module and with the database side by side and require them equal."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

IST = timezone(
    timedelta(hours=5, minutes=30)
)  # India has no daylight saving: a fixed offset is the whole rule

EVENT_TYPES = (
    "send_quote",
    "customer_accept",
    "customer_decline",
    "expire",
    "request_advance",
    "record_payment",
    "start_preparation",
    "dispatch",
    "deliver",
    "cancel",
    "record_refund",
)
MONEY_EVENTS = ("record_payment", "record_refund")
# the closed list of lost reasons (plan decision 7): `customer_decline` carries one, nothing else does
LOST_REASONS = (
    "price",
    "timing",
    "bought_elsewhere",
    "no_response",
    "requirement_changed",
    "product_unavailable",
    "credit_terms",
    "other",
)
PRE_DISPATCH = (
    "quote_approved",
    "quote_sent",
    "accepted",
    "advance_requested",
    "advance_paid",
    "in_preparation",
)
MAX_AMOUNT = 1_000_000_000  # the lifecycle's own cap (INR 10,000,000)
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class OrderRequestError(ValueError):
    """The inputs cannot be turned into a request. `code` is a fixed name; no value is ever echoed."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class OrderState:
    """What the database recorded for an order: read with the caller's token, never taken from a request body."""

    state: str
    order_total_paise: int
    advance_paise: int
    valid_until: date
    advance_required: bool
    dispatch_requires_advance: bool
    cancel_allowed_until_state: str
    payments: tuple[tuple[str, int], ...] = ()  # (payment_id, amount_paise) in seq order
    refunds: tuple[tuple[str, int], ...] = ()  # (refund_id, amount_paise) in seq order


@dataclass(frozen=True)
class OrderEvent:
    """One event a person reports. For a money event both the amount (integer paise) and the ledger id (a UUID) are required; for any other event neither may be given."""

    type: str
    amount_paise: int | None = None
    ledger_id: str | None = None


def utc_text(moment: datetime) -> str:
    """The lifecycle's canonical timestamp: UTC, whole seconds, a trailing Z."""
    if moment.tzinfo is None:
        raise OrderRequestError("naive_time")
    return moment.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def valid_until_text(day: date) -> str:
    """The last instant of the quote's valid-until day in India (23:59:59 IST), as the lifecycle's UTC text."""
    return utc_text(datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=IST))


def owner_override(role: str, event_type: str) -> bool:
    """Derived, never supplied: only an Owner dispatching can use the override (the lifecycle's own rule: only `dispatch` reads it)."""
    return role == "owner" and event_type == "dispatch"


def _int(value: object) -> int:
    if type(value) is not int:
        raise OrderRequestError("not_integer")
    return value


def _bool(value: object) -> bool:
    if type(value) is not bool:
        raise OrderRequestError("not_boolean")
    return value


def _event_dict(event: OrderEvent) -> dict[str, Any]:
    if event.type not in EVENT_TYPES:
        raise OrderRequestError("unknown_event")
    if event.type in MONEY_EVENTS:
        if event.amount_paise is None or event.ledger_id is None:
            raise OrderRequestError("money_event_incomplete")
        amount = _int(event.amount_paise)
        if not 1 <= amount <= MAX_AMOUNT:
            raise OrderRequestError("amount_out_of_range")
        if not isinstance(event.ledger_id, str) or not _UUID.fullmatch(event.ledger_id):
            raise OrderRequestError("bad_ledger_id")
        key = "payment_id" if event.type == "record_payment" else "refund_id"
        return {"type": event.type, "amount": amount, key: event.ledger_id}
    if event.amount_paise is not None or event.ledger_id is not None:
        raise OrderRequestError("event_takes_no_amount")
    return {"type": event.type}


def _ledger(rows: tuple[tuple[str, int], ...], key: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ledger_id, amount in rows:
        if not isinstance(ledger_id, str) or not _UUID.fullmatch(ledger_id):
            raise OrderRequestError("bad_ledger_id")
        out.append({key: ledger_id, "amount": _int(amount)})
    return out


def new_ledger_id() -> str:
    """A fresh ledger id: a lower-case UUID text."""
    return str(uuid.uuid4())


def build_request(
    order: OrderState, event: OrderEvent, *, as_of: datetime, role: str
) -> dict[str, Any]:
    """The request for the pinned lifecycle: `order` is what the database recorded, `event` what the person reports, `role` the role the token proved (it only decides `owner_override`)."""
    if order.cancel_allowed_until_state not in PRE_DISPATCH:
        raise OrderRequestError("bad_cancel_window")
    if not isinstance(order.valid_until, date) or isinstance(order.valid_until, datetime):
        raise OrderRequestError("bad_valid_until")
    return {
        "current_state": order.state,
        "event": _event_dict(event),
        "as_of": utc_text(as_of),
        "valid_until": valid_until_text(order.valid_until),
        "order_total": _int(order.order_total_paise),
        "payments": _ledger(order.payments, "payment_id"),
        "refunds": _ledger(order.refunds, "refund_id"),
        "policy": {
            "advance_required": _bool(order.advance_required),
            "advance_amount": _int(order.advance_paise),
            "dispatch_requires_advance": _bool(order.dispatch_requires_advance),
            "cancel_allowed_until_state": order.cancel_allowed_until_state,
        },
        "flags": {"owner_override": owner_override(role, event.type)},
    }
