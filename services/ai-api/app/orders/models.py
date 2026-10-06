"""API models for orders (ADR 0021). Every model is `extra="forbid"`: a column added to the database cannot leak by accident, and a body field that is not declared (a total, a state, an
approver, `owner_override`) is a 422, never ignored. Money is integer paise. The request and result TEXTS of an event (large, with the rule trace) are stored but never returned.
Nothing here sends anything: every event is a PERSON's record of something that happened outside the system."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, Field, StrictBool, StrictInt, model_validator

from app.crm.models import ApiUuid, _Strict

OrderState = Literal[
    "quote_approved",
    "quote_sent",
    "accepted",
    "advance_requested",
    "advance_paid",
    "in_preparation",
    "dispatched",
    "delivered",
    "closed_paid",
    "declined",
    "expired",
    "cancelled",
]
EventType = Literal[
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
]
LedgerType = Literal[
    "created",
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
]
LostReason = Literal[
    "price",
    "timing",
    "bought_elsewhere",
    "no_response",
    "requirement_changed",
    "product_unavailable",
    "credit_terms",
    "other",
]
CancelWindow = Literal[
    "quote_approved",
    "quote_sent",
    "accepted",
    "advance_requested",
    "advance_paid",
    "in_preparation",
]
# what the screen says, in our words: Won once the customer has accepted, Lost when declined
Outcome = Literal["open", "won", "lost", "cancelled", "expired"]
MONEY: tuple[str, ...] = ("record_payment", "record_refund")
MAX_AMOUNT = 1_000_000_000


def outcome_of(state: str) -> Outcome:
    if state == "declined":
        return "lost"
    if state == "cancelled":
        return "cancelled"
    if state == "expired":
        return "expired"
    if state in ("quote_approved", "quote_sent"):
        return "open"
    return "won"


# ----------------------------------------------------------------------------- requests
class CreateOrderIn(_Strict):
    """Start tracking an APPROVED quote as an order. The figures are the quote's, copied by the database: nothing here supplies an amount."""

    id: ApiUuid
    quote_id: ApiUuid


class RecordEventIn(_Strict):
    """One event a PERSON reports. The person's inputs are the event id (the idempotency key), the type, the time it happened, and (money events) the amount in paise and a ledger id,
    and (a decline) the lost reason. There is no field for a total, a state, an approver or `owner_override`: the database derives those."""

    id: ApiUuid
    type: EventType
    occurred_at: AwareDatetime | None = None
    amount_paise: StrictInt | None = Field(default=None, ge=1, le=MAX_AMOUNT)
    ledger_id: ApiUuid | None = None
    reason_code: LostReason | None = None

    @model_validator(mode="after")
    def _shape(self) -> RecordEventIn:
        money = self.type in MONEY
        if money != (self.amount_paise is not None and self.ledger_id is not None) or (
            not money and (self.amount_paise is not None or self.ledger_id is not None)
        ):
            raise ValueError(
                "money events need an amount and a ledger id; no other event takes either"
            )
        if (self.type == "customer_decline") != (self.reason_code is not None):
            raise ValueError("a decline needs a reason, and nothing else takes one")
        return self


class CreatePolicyIn(_Strict):
    id: ApiUuid
    effective_from: date
    advance_required: StrictBool
    dispatch_requires_advance: StrictBool
    cancel_allowed_until_state: CancelWindow
    allow_zero_value_orders: StrictBool


# ----------------------------------------------------------------------------- responses
class OrderEventOut(_Strict):
    id: uuid.UUID
    seq: int
    type: LedgerType
    prior_state: OrderState | None
    new_state: OrderState
    amount_paise: int | None
    ledger_id: uuid.UUID | None
    occurred_at: datetime
    reason_code: LostReason | None
    owner_approved_by: uuid.UUID | None
    recorded_by: uuid.UUID | None
    recorded_at: datetime
    engine_version: str | None
    canonical_hash: str | None


class OrderOut(_Strict):
    id: uuid.UUID
    order_no: int
    quote_id: uuid.UUID
    enquiry_id: uuid.UUID
    requirement_id: uuid.UUID
    lead_id: uuid.UUID
    state: OrderState
    outcome: Outcome
    order_total_paise: int
    advance_paise: int
    valid_until: date
    policy_version_id: uuid.UUID
    created_at: datetime
    closed_at: datetime | None
    paid_paise: int
    refunded_paise: int
    net_paise: int
    balance_paise: int
    event_count: int
    lost_reason: LostReason | None


class OrderDetailOut(OrderOut):
    events: list[OrderEventOut]
    # GUIDANCE from the pinned lifecycle for THIS caller's role, as of now (never approval: the database decides). Empty for a closed order.
    allowed_next_events: list[EventType] = []


class EventResultOut(_Strict):
    event_id: uuid.UUID
    order_id: uuid.UUID
    seq: int
    state: OrderState
    prior_state: OrderState | None
    outcome: Outcome
    replayed: bool
    # guidance from the lifecycle's own run (never approval); empty for a replay
    allowed_next_events: list[str]
    flags: list[str]
    paid_total: int | None
    balance_due: int | None


class PolicyOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    replayed: bool
