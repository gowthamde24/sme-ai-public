"""API models for quotes (T009). Responses are `extra="forbid"`: a column added to the database cannot leak by accident.

Money is integer paise everywhere. A quote's figures are the database's own recomputation of the pinned engine's result: nothing here computes a price. The request and
result TEXTS (large, with the rule trace) are stored but never returned by these models. Nothing here sends anything."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.crm.models import ApiUuid, _Strict

CustomerKind = Literal["new", "repeat"]
SaleUnit = Literal["piece", "set"]
RejectCode = Literal["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"]
WithdrawCode = Literal["price_changed", "customer_cancelled", "entered_in_error", "other"]
QuoteStatus = Literal["draft", "approved", "rejected", "superseded"]
# what the screen says: a superseded quote that carries a withdrawal is WITHDRAWN, the others were replaced by a newer one
Outcome = Literal["draft", "approved", "rejected", "withdrawn", "superseded"]


class QuoteLineOut(_Strict):
    line_no: int
    requirement_line_no: int
    product_id: uuid.UUID
    sku: str
    name: str
    sale_unit: SaleUnit
    qty: int
    unit_price_applied_paise: int
    price_break_min_qty: int | None
    line_subtotal_paise: int
    net_paise: int
    tax_paise: int
    gross_paise: int
    tax_bps: int


class UnquotedLineOut(_Strict):
    """A requirement line this quote does NOT cover: no saree type and quantity that a person confirmed. `summary` is our own wording of what is there."""

    line_no: int
    summary: list[str]
    reason: Literal["not_confirmed"] = "not_confirmed"


class QuoteOut(_Strict):
    id: uuid.UUID
    quote_no: int
    requirement_id: uuid.UUID
    enquiry_id: uuid.UUID
    lead_id: uuid.UUID
    status: QuoteStatus
    outcome: Outcome
    price_list_version_id: uuid.UUID
    policy_version_id: uuid.UUID
    engine_version: str
    canonical_hash: str
    customer_kind: CustomerKind
    delivery_state: str
    gst_supply: Literal["intra_state", "inter_state"]
    as_of: date
    valid_until: date
    due_date: date
    merchandise_net_paise: int
    item_tax_paise: int
    shipping_net_paise: int
    shipping_tax_paise: int
    total_paise: int
    advance_paise: int
    balance_paise: int
    engine_flags: list[str]
    review_flags: list[str]
    needs_owner_approval: bool
    created_by: uuid.UUID | None
    created_at: datetime
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    rejected_by: uuid.UUID | None
    rejected_at: datetime | None
    reject_code: RejectCode | None
    withdrawn_by: uuid.UUID | None
    withdrawn_at: datetime | None
    withdraw_code: WithdrawCode | None
    lines: list[QuoteLineOut]
    unquoted_lines: list[UnquotedLineOut] = Field(default_factory=list)


class QuoteSummaryOut(_Strict):
    id: uuid.UUID
    quote_no: int
    enquiry_id: uuid.UUID
    status: QuoteStatus
    outcome: Outcome
    customer_kind: CustomerKind
    valid_until: date
    total_paise: int
    needs_owner_approval: bool
    created_at: datetime


class CreateQuoteIn(_Strict):
    """A person's choices; the id is the caller's (an exact retry replays). Nothing here is a price: the figures come from the engine and are verified by the database."""

    id: ApiUuid
    customer_kind: CustomerKind
    delivery_state: str = Field(min_length=2, max_length=2)


class PickIn(_Strict):
    """A person says which catalog product a requirement line means. `from_suggestion` says the person took it from the mapper's suggestions; the SERVER then
    re-runs the mapper and records ITS hash (the client never supplies one), and refuses a product the mapper no longer suggests for that line."""

    line: int = Field(ge=1, le=5)
    product_id: ApiUuid
    qty: int = Field(ge=1, le=10000)
    sale_unit: SaleUnit
    from_suggestion: bool = False


class PickOut(_Strict):
    pick_id: uuid.UUID
    line: int
    product_id: uuid.UUID
    qty: int
    sale_unit: SaleUnit
    source: Literal["manual", "mapper_suggestion"]
    replayed: bool


class RejectIn(_Strict):
    code: RejectCode


class WithdrawIn(_Strict):
    code: WithdrawCode


class DecisionOut(_Strict):
    quote_id: uuid.UUID
    status: QuoteStatus
    replayed: bool


class QuoteTextOut(_Strict):
    """The plain customer-facing text of an APPROVED quote, for a person to copy. The system sends nothing."""

    text: str
    line_count: int
    canonical_hash: str
    renderer_version: str
    sent_by_system: Literal[False] = False


class ApproveOut(DecisionOut):
    """The approval, and the text rendered from the stored approved row (None with a fixed `text_error` code if the renderer is unavailable: the approval stands)."""

    approved_by: uuid.UUID | None = None
    text: QuoteTextOut | None = None
    text_error: str | None = None


# ----------------------------------------------------------------------------- the picking screen
class PriceItemOut(_Strict):
    product_id: uuid.UUID
    sku: str
    name: str
    sale_unit: SaleUnit
    unit_price_paise: int
    minimum_order_quantity: int
    tax_bps: int


class SuggestionOut(_Strict):
    status: Literal["matched", "ambiguous", "unmatched", "needs_human", "needs_input"]
    reason: str | None
    candidates: list[PriceItemOut]
    truncated: bool


class PickedOut(_Strict):
    product_id: uuid.UUID
    qty: int
    sale_unit: SaleUnit
    source: Literal["manual", "mapper_suggestion"]


class SetupLineOut(_Strict):
    line_no: int
    summary: list[str]
    quantity: int | None
    basis: str | None
    quotable: bool
    pick: PickedOut | None
    suggestion: SuggestionOut | None


class QuoteSetupOut(_Strict):
    """Everything the screen needs to make a draft: the confirmed requirement's lines with the mapper's suggestions and the person's picks, and what is missing."""

    requirement_id: uuid.UUID | None
    requirement_status: Literal["draft", "confirmed"] | None
    today: date
    price_list_version_id: uuid.UUID | None
    policy_version_id: uuid.UUID | None
    seller_state: str | None
    required_inputs: list[str]
    mapper_version: str | None
    missing: list[str]
    lines: list[SetupLineOut]
    price_list: list[PriceItemOut]
    delivery_states: dict[str, str]
