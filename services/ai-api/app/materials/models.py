"""API-facing models of building-materials quoting (job CN, ADR 0085, module `materials`). The contract the web and the public calculator are built on (packages/contracts/materials.*).

Money is integer PAISE, rates are integer BASIS POINTS (1 bps = 0.01 %), an area is integer HUNDREDTHS of its unit (1,000 sq ft = 100000), pieces per area are integer THOUSANDTHS (4.5 = 4500). The calculator
is deterministic and never a model's. Requests are closed: an unknown field is a 422, and a GST rate is always sent, never assumed. Nothing here carries a storage path or a token."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints

SoldPer = Literal["piece", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload"]
AreaUnit = Literal["sq_ft", "sq_m"]
Rounding = Literal["half_up", "half_even", "down"]
Stock = Literal["in_stock", "few_left", "made_to_order"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
QuoteStatus = Literal["draft", "approved", "rejected", "superseded"]
RejectCode = Literal["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"]
Name120 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Sku = Annotated[str, StringConstraints(min_length=1, max_length=128)]
Hsn = Annotated[str, StringConstraints(pattern=r"^[0-9]{4,8}$")]
Bps = Annotated[StrictInt, Field(ge=0, le=10_000)]
Paise = Annotated[StrictInt, Field(ge=0, le=100_000_000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------------------------- the calculator: the rules, the lines, the answer
class SlabIn(_Strict):
    up_to_km: Annotated[StrictInt, Field(ge=0, le=5000)]
    charge_paise: Paise


class TransportIn(_Strict):
    """The owner's freight rule: none, per trip (a truck carries `truck_capacity` pieces or area) or per kilometre slab (a charge per trip by distance); optionally free above an amount of material.
    The freight's GST rate is required for any freight that is charged."""

    kind: Literal["none", "per_trip", "per_km_slab"] = "none"
    capacity_basis: Literal["pieces", "area"] | None = None
    truck_capacity: Annotated[StrictInt, Field(ge=1, le=1_000_000)] | None = None
    rate_per_trip_paise: Paise | None = None
    slabs: Annotated[list[SlabIn], Field(min_length=1, max_length=10)] | None = None
    free_above_paise: Annotated[StrictInt, Field(ge=1, le=1_000_000_000)] | None = None
    gst_bps: Bps | None = None


class HandlingIn(_Strict):
    """Loading and unloading: a flat amount per order or per trip."""

    per: Literal["order", "trip"]
    amount_paise: Paise
    gst_bps: Bps


class LayingIn(_Strict):
    """Laying: a rate per area unit (sq ft or sq m, the unit of the quote's area)."""

    rate_paise_per_area: Paise
    gst_bps: Bps


class PolicyBody(_Strict):
    """The rules a quote follows. Wastage is added to the pieces (default 5 %); the pieces are rounded UP once, at the end, and to whole pallets only if the owner chose that; the area-priced material bills the area
    the delivered pieces cover (`bill_wastage`), or only the customer's own area when turned off. Advance default 50 %, balance on delivery or on credit days, valid 7 days."""

    default_wastage_bps: Annotated[StrictInt, Field(ge=0, le=5000)] = 500
    round_to_pallet: StrictBool = False
    bill_wastage: StrictBool = True
    transport: TransportIn = TransportIn()
    handling: HandlingIn | None = None
    laying: LayingIn | None = None
    advance_bps: Bps = 5000
    credit_days: Annotated[StrictInt, Field(ge=0, le=180)] = 0
    validity_days: Annotated[StrictInt, Field(ge=0, le=365)] = 7
    rounding_mode: Rounding = "half_up"


class CalcLineIn(_Strict):
    """One product line. `area` lines are sold per piece or per the area unit and count pieces from the area; `direct` lines (bags, tonnes, a truckload) are a quantity times a price."""

    sku: Sku
    name: Name120
    mode: Literal["area", "direct"]
    sold_per: SoldPer
    unit_price_paise: Paise
    gst_bps: Bps
    hsn: Hsn | None = None
    area_unit: AreaUnit | None = None
    area_x100: Annotated[StrictInt, Field(ge=1, le=100_000_000)] | None = None
    pieces_per_area_x1000: Annotated[StrictInt, Field(ge=1, le=1_000_000)] | None = None
    pieces_per_pallet: Annotated[StrictInt, Field(ge=1, le=10_000_000)] | None = None
    quantity: Annotated[StrictInt, Field(ge=1, le=10_000_000)] | None = None
    min_order_qty: Annotated[StrictInt, Field(ge=1, le=10_000_000)] | None = None
    wastage_bps: Annotated[StrictInt, Field(ge=0, le=5000)] | None = None
    round_to_pallet: StrictBool | None = None


class CalcCustomerIn(_Strict):
    outstanding_paise: Annotated[StrictInt, Field(ge=0, le=1_000_000_000)] = 0
    credit_limit_paise: Annotated[StrictInt, Field(ge=0, le=1_000_000_000)] | None = None


class CalcIn(_Strict):
    """The public calculator and the owner's preview: no business data is read or stored. `as_of` is today in India when left out."""

    as_of: date | None = None
    lines: Annotated[list[CalcLineIn], Field(min_length=1, max_length=20)]
    policy: PolicyBody = PolicyBody()
    customer: CalcCustomerIn = CalcCustomerIn()
    laying: StrictBool = False
    distance_km: Annotated[StrictInt, Field(ge=0, le=5000)] | None = None


class CalcFlagOut(_Strict):
    code: str
    sku: str | None = None
    exposure: int | None = None
    credit_limit_paise: int | None = None
    distance_km: int | None = None


class CalcFlagsOut(_Strict):
    needs_owner_approval: bool
    reasons: list[CalcFlagOut]


class CalcLineOut(_Strict):
    sku: str
    name: str
    hsn: str | None
    mode: Literal["area", "direct"]
    unit_price_paise: int
    gst_bps: int
    pieces: int | None
    pieces_without_wastage: int | None
    pallets: int | None
    delivered_area_x100: int | None
    billed_quantity: int
    billed_per: SoldPer
    load: int
    material: int
    tax: int
    gross: int


class CalcTotalsOut(_Strict):
    material: int
    transport: int
    handling: int
    laying: int
    subtotal: int
    item_tax: int
    transport_tax: int
    handling_tax: int
    laying_tax: int
    tax: int
    total: int


class CalcTermsOut(_Strict):
    advance_amount: int
    balance: int
    credit_days: int
    due_date: date | None
    balance_on: Literal["delivery", "credit_days"]


class CalcRangeOut(_Strict):
    """The estimate a customer is shown before an exact quote: LOW has no wastage and no pallet rounding, HIGH is the quote itself. Both include GST."""

    total_low: int
    total_high: int


class CalcTraceOut(_Strict):
    rule_id: str
    inputs: dict[str, Any]
    text: str


class CalcOut(_Strict):
    status: Literal["draft", "rejected"]
    engine_version: str
    canonical_hash: str | None
    # the calculator's closed codes when it rejected the request (empty for a draft)
    codes: list[str] = []
    lines: list[CalcLineOut] = []
    trips: int | None = None
    totals: CalcTotalsOut | None = None
    payment_terms: CalcTermsOut | None = None
    valid_until: date | None = None
    flags: CalcFlagsOut
    range: CalcRangeOut | None = None
    trace: list[CalcTraceOut] = []


# ---------------------------------------------------------------------------------------------- the owner's rules (a policy version)
class PolicyIn(_Strict):
    """A new version of the rules (the Owner, with a second factor). `version_id` is the caller's, so a retry is safe; `effective_from` is today or later (today when left out)."""

    version_id: uuid.UUID
    effective_from: date | None = None
    policy: PolicyBody


class PolicyVersionOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    policy: PolicyBody


class PolicyVersionRefOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    created_at: datetime


class PolicyOut(_Strict):
    current: PolicyVersionOut | None
    versions: list[PolicyVersionRefOut]


class PolicySavedOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    replayed: bool


# ---------------------------------------------------------------------------------------------- items: a material in the catalogue
class MaterialItemIn(_Strict):
    """The whole item at once; the same id again changes it. The size, thickness, pieces per area and per pallet, minimum order, lead days, GST rate and HSN code are the pack's custom fields of the item
    (PUT .../catalogue custom values), entered by the owner: nothing is assumed. `price_paise` is the EXACT price per selling unit: leave the field OUT to keep it; send a number to set it or `null` to clear it.
    Only the Owner, with a second factor, may send it at all. `active` can be true only while the item has a photo."""

    name: Name120
    sell_unit: SoldPer
    area_unit: AreaUnit | None = None
    stock_status: Stock = "in_stock"
    active: StrictBool = False
    price_paise: Annotated[StrictInt, Field(ge=100, le=100_000_000)] | None = None


class MaterialPhotoOut(_Strict):
    id: uuid.UUID
    position: int
    url: str | None
    thumb_url: str | None
    width: int
    height: int
    bytes: int
    expires_in_seconds: int


class MaterialInputsOut(_Strict):
    """What a quote reads from the item, exactly as it will read it, and what is still missing. A missing GST rate or price is never assumed."""

    price_paise: int | None
    gst_bps: int | None
    hsn: str | None
    pieces_per_area_x1000: int | None
    pieces_per_pallet: int | None
    min_order_qty: int | None
    lead_days: int | None
    # a quote by area needs: price, GST rate, pieces per area, a coverage unit; a quote by quantity needs: price, GST rate
    missing_for_area: list[str]
    missing_for_quantity: list[str]


class MaterialItemOut(_Strict):
    id: uuid.UUID
    name: str
    sell_unit: SoldPer
    area_unit: AreaUnit | None
    stock_status: Stock
    active: bool
    price_paise: int | None
    price_text: str | None
    photo_count: int
    photos: list[MaterialPhotoOut]
    inputs: MaterialInputsOut
    created_at: datetime
    updated_at: datetime


class MaterialItemSummaryOut(_Strict):
    id: uuid.UUID
    name: str
    sell_unit: SoldPer
    area_unit: AreaUnit | None
    stock_status: Stock
    active: bool
    price_paise: int | None
    price_text: str | None
    photo_count: int
    cover: MaterialPhotoOut | None


class MaterialItemListOut(_Strict):
    items: list[MaterialItemSummaryOut]
    next_cursor: str | None


class MaterialItemSavedOut(_Strict):
    item: MaterialItemOut
    created: bool


class MaterialPhotoResultOut(_Strict):
    photo: MaterialPhotoOut
    replayed: bool
    item: MaterialItemOut


# ---------------------------------------------------------------------------------------------- quotes
class PickIn(_Strict):
    """The person's choice of the catalogue item that answers requirement line `line_no`."""

    line_no: Annotated[StrictInt, Field(ge=1, le=5)]
    item_id: uuid.UUID


class QuotePreviewIn(_Strict):
    picks: Annotated[list[PickIn], Field(min_length=1, max_length=5)]
    site_id: uuid.UUID | None = None


class QuoteDraftIn(_Strict):
    """Make a draft. `quote_id` is the caller's: a retry replays. The figures are never sent: the database builds the request from the confirmed requirement, your picks, the owner's prices and rules, and the
    site's distance, and refuses any figure that is not its own."""

    quote_id: uuid.UUID
    picks: Annotated[list[PickIn], Field(min_length=1, max_length=5)]
    site_id: uuid.UUID | None = None


class QuotePreviewOut(_Strict):
    """The calculator's answer for a requirement and picks, and the database's agreement with it. Nothing is stored."""

    as_of: date
    valid_until: date
    result: CalcOut
    # the database computed the same figures independently
    database_agrees: bool


class QuoteLineOut(_Strict):
    line_no: int
    catalogue_item_id: uuid.UUID
    name: str
    mode: Literal["area", "direct"]
    sold_per: SoldPer
    unit_price_paise: int
    gst_bps: int
    hsn: str | None
    area_x100: int | None
    area_unit: AreaUnit | None
    pieces: int | None
    pallets: int | None
    delivered_area_x100: int | None
    billed_quantity: int
    material_paise: int
    tax_paise: int


class MaterialQuoteOut(_Strict):
    id: uuid.UUID
    quote_no: int
    requirement_id: uuid.UUID
    enquiry_id: uuid.UUID
    lead_id: uuid.UUID
    site_id: uuid.UUID | None
    status: QuoteStatus
    policy_version_id: uuid.UUID
    engine_version: str
    canonical_hash: str
    as_of: date
    valid_until: date
    due_date: date | None
    trips: int
    material_paise: int
    transport_paise: int
    handling_paise: int
    laying_paise: int
    tax_paise: int
    total_paise: int
    advance_paise: int
    balance_paise: int
    flags: list[str]
    needs_owner_approval: bool
    created_at: datetime
    approved_at: datetime | None
    rejected_at: datetime | None
    reject_code: RejectCode | None
    lines: list[QuoteLineOut]


class MaterialQuoteDetailOut(MaterialQuoteOut):
    """A quote with the rule trace the calculator wrote (why each number is what it is)."""

    trace: list[CalcTraceOut]


class MaterialQuoteListOut(_Strict):
    items: list[MaterialQuoteOut]


class QuoteDraftOut(_Strict):
    quote: MaterialQuoteOut
    replayed: bool


class RejectIn(_Strict):
    code: RejectCode


class QuoteTextOut(_Strict):
    """The quote as a message to the customer: a clear table of words and numbers, made by fixed templates from the stored figures (no model). English is the reviewed text; the others are drafts."""

    language: Language
    language_review: Literal["reviewed", "draft"]
    text: str


class OrderFromQuoteIn(_Strict):
    order_id: uuid.UUID


class CreditWarningOut(_Strict):
    credit_limit_paise: int | None
    outstanding_paise: int
    would_be_paise: int
    exceeded: bool


class OrderCreatedOut(_Strict):
    order_id: uuid.UUID
    order_no: int
    state: str
    replayed: bool
    # a WARNING the owner decides on, never a block; null when the customer's dues are not tracked
    credit: CreditWarningOut | None
