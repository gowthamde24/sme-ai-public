"""API models for quotes (T009). Responses are `extra="forbid"`: a column added to the database cannot leak by accident.

Money is integer paise everywhere. A quote's figures are the database's own recomputation of the pinned engine's result: nothing here computes a price. The request and
result TEXTS (large, with the rule trace) are stored but never returned by these models. Nothing here sends anything."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    Field,
    SerializerFunctionWrapHandler,
    StrictBool,
    StrictInt,
    StringConstraints,
    model_serializer,
    model_validator,
)

from app.crm.models import ApiUuid, _Strict

CustomerKind = Literal["new", "repeat"]
SaleUnit = Literal["piece", "set"]
RejectCode = Literal["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"]
WithdrawCode = Literal["price_changed", "customer_cancelled", "entered_in_error", "other"]
QuoteStatus = Literal["draft", "approved", "rejected", "superseded"]
# what the screen says: a superseded quote that carries a withdrawal is WITHDRAWN, the others were replaced by a newer one
Outcome = Literal["draft", "approved", "rejected", "withdrawn", "superseded"]
PricingKind = Literal["list", "manual"]
PriceSource = Literal["list", "typed_by_person"]


class QuoteLineOut(_Strict):
    line_no: int
    requirement_line_no: int
    product_id: uuid.UUID | None  # null on a manual line: it names an item type, not a product
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
    price_source: PriceSource = "list"
    item_type_code: str | None = None

    @model_serializer(mode="wrap")
    def _leave_out_what_only_a_manual_line_has(
        self, handler: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        """A list-price line's JSON is exactly what it was before manual quotes existed: the two fields only a manual line needs are left out when they say "list"."""
        data: dict[str, Any] = handler(self)
        if self.price_source == "list":
            data.pop("price_source", None)
        if self.item_type_code is None:
            data.pop("item_type_code", None)
        return data


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
    pricing_kind: PricingKind = "list"
    price_list_version_id: uuid.UUID | None  # null on a manual quote: it has no price list
    policy_version_id: uuid.UUID
    engine_version: str
    canonical_hash: str
    customer_kind: CustomerKind
    delivery_state: str | None  # null on a manual quote that was made without one
    gst_supply: Literal["intra_state", "inter_state"] | None
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

    @model_serializer(mode="wrap")
    def _leave_out_what_only_a_manual_quote_has(
        self, handler: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        """A list-price quote's JSON is exactly what it was before manual quotes existed: `pricing_kind` is left out when it says "list"."""
        data: dict[str, Any] = handler(self)
        if self.pricing_kind == "list":
            data.pop("pricing_kind", None)
        return data


class QuoteSummaryOut(_Strict):
    id: uuid.UUID
    quote_no: int
    enquiry_id: uuid.UUID
    status: QuoteStatus
    outcome: Outcome
    pricing_kind: PricingKind = "list"
    customer_kind: CustomerKind
    valid_until: date
    total_paise: int
    needs_owner_approval: bool
    created_at: datetime

    @model_serializer(mode="wrap")
    def _leave_out_what_only_a_manual_quote_has(
        self, handler: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if self.pricing_kind == "list":
            data.pop("pricing_kind", None)
        return data


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


# ----------------------------------------------------------------------------- the quote policy (a version the Owner or Admin publishes)
RoundingMode = Literal["half_up", "half_even", "down"]
RequiredInput = Literal["delivery_state", "delivery_city", "payment_terms", "deadline"]


class CreateQuotePolicyIn(_Strict):
    """Exactly the fields of `public.create_quote_policy_version` and nothing else (extra keys are a 422). This model checks SHAPE and BOUNDS only; every rule (the second factor, the role,
    a delivery state among the required inputs, an effective date not before the latest version, a replay) is the database's. A field left out stays out: the API sets no default (the database
    applies its own: exclusive tax, half-up rounding, a zero repeat credit limit, delivery state as the one required input, no free-shipping threshold, the GST date at the version's own date,
    the shipping tax at the goods rate). The GST rate itself has no default."""

    id: ApiUuid
    effective_from: date
    discount_ceiling_bps: Annotated[StrictInt, Field(ge=0, le=10000)]
    shipping_flat_fee_paise: Annotated[StrictInt, Field(ge=0, le=100_000_000)]
    shipping_free_above_paise: Annotated[StrictInt, Field(ge=0, le=100_000_000)] | None = None
    # not typed separately any more: left out, the database sets it to the goods rate (gst_rate_bps); an explicit value is still accepted (list-price quotes)
    shipping_tax_bps: Annotated[StrictInt, Field(ge=0, le=10000)] | None = None
    validity_days: Annotated[StrictInt, Field(ge=1, le=365)]
    new_advance_bps: Annotated[StrictInt, Field(ge=0, le=10000)]
    repeat_advance_bps: Annotated[StrictInt, Field(ge=0, le=10000)]
    new_net_days: Annotated[StrictInt, Field(ge=0, le=180)]
    repeat_net_days: Annotated[StrictInt, Field(ge=0, le=180)]
    # GST for manual-price quotes (price-list items keep their own rate): a REQUIRED choice with no default; the date it applies from is optional (the database uses the version's own date)
    gst_rate_bps: Annotated[StrictInt, Field(ge=0, le=2800)]
    gst_effective_from: date | None = None
    tax_mode: Literal["exclusive"] | None = None
    rounding_mode: RoundingMode | None = None
    repeat_credit_limit_paise: Annotated[StrictInt, Field(ge=0, le=1_000_000_000)] | None = None
    seller_state: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
    required_inputs: Annotated[list[RequiredInput], Field(max_length=4)] | None = None


class QuotePolicyResultOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    replayed: bool


class QuotePolicyVersionOut(_Strict):
    """One published version, newest first. `in_force` marks the version that applies today (the latest whose date has come: the database's own rule, read through the same query the quote
    screens use)."""

    id: uuid.UUID
    version_no: int
    effective_from: date
    discount_ceiling_bps: int
    shipping_flat_fee_paise: int
    shipping_free_above_paise: int | None
    shipping_tax_bps: int
    validity_days: int
    new_advance_bps: int
    repeat_advance_bps: int
    new_net_days: int
    repeat_net_days: int
    gst_rate_bps: int
    gst_effective_from: date
    tax_mode: str
    rounding_mode: str
    repeat_credit_limit_paise: int
    seller_state: str
    required_inputs: list[str]
    created_at: datetime
    in_force: bool


# ----------------------------------------------------------------------------- item types (the tenant's own list, with an optional price range)
ItemTypeCode = Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$")]
PricePaise = Annotated[StrictInt, Field(ge=1, le=100_000_000)]


class SaveItemTypeIn(_Strict):
    """Create or REPLACE one item type (the code is in the path and never changes). Shape and bounds only: whether the caller may, the second factor, the lowest price not above the
    highest and the clean name are the database's (`public.save_item_type`). A price bound left out means "no bound": the call replaces the record, it does not merge."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    position: Annotated[StrictInt, Field(ge=0, le=10000)] = 0
    active: StrictBool = True
    min_price_paise: PricePaise | None = None
    max_price_paise: PricePaise | None = None

    @model_validator(mode="after")
    def _range_is_ordered(self) -> SaveItemTypeIn:
        if (
            self.min_price_paise is not None
            and self.max_price_paise is not None
            and self.min_price_paise > self.max_price_paise
        ):
            raise ValueError("the lowest price must not be above the highest")
        return self


class ItemTypeOut(_Strict):
    id: uuid.UUID
    code: str
    name: str
    position: int
    active: bool
    min_price_paise: int | None
    max_price_paise: int | None


class ItemTypeSavedOut(_Strict):
    id: uuid.UUID
    code: str
    created: bool


# ----------------------------------------------------------------------------- the manual-price quote (the owners type each line's price)
class ManualLineIn(_Strict):
    """One typed line. The price is the person's own number, in paise; nothing else is read from the caller (no name, no tax, no price source)."""

    item_type_code: ItemTypeCode
    qty: Annotated[StrictInt, Field(ge=1, le=10_000)]
    unit_price_paise: PricePaise


class CreateManualQuoteIn(_Strict):
    """A person's typed lines and choices; the id is the caller's (an exact retry replays). Shape and bounds only: the figures come from the engine and are verified by the
    database, which also decides the role, the item types, the GST rate in force and the requirement."""

    id: ApiUuid
    customer_kind: CustomerKind
    delivery_state: str | None = Field(default=None, min_length=2, max_length=2)
    lines: list[ManualLineIn] = Field(min_length=1, max_length=5)
