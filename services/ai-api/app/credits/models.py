# ruff: noqa: E501
"""The answers of the credits top-up (docs/contracts/credits-topup.md). Everything is in rupees and paise; a person never reads the word "credits" (the balance is a balance in rupees, 1 credit = ₹1 inside)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.pricing.models import BalanceOut

MIN_RUPEES = 100        # the database's pricing.settings.topup_min_paise / 100
MAX_RUPEES = 100_000    # the database's pricing.settings.topup_max_paise / 100
PRESET_RUPEES = (500, 1000, 2000, 5000)


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AmountOut(_Out):
    """One amount the customer may choose: what is added to the balance, the GST on top, and what is charged."""

    added_paise: int
    gst_paise: int
    total_paise: int
    added_text: str
    gst_text: str
    total_text: str


class TopupOptionsOut(_Out):
    gst_percent: float
    presets: list[AmountOut]
    custom_min_rupees: int
    custom_max_rupees: int
    mode: Literal["test", "live", "fake"]   # "test" or "fake": no real money moves; the web shows a visible test badge
    checkout_ready: bool                     # false when no provider key is set: the pay button stays off


class TopupOrderIn(_Out):
    amount_rupees: Annotated[int, Field(ge=MIN_RUPEES, le=MAX_RUPEES, strict=True)]   # the amount added to the balance, before GST


class TopupOrderOut(_Out):
    """Checkout-ready: pass `key_id`, `order_id` and `amount_paise` to Razorpay Checkout; nothing secret is here."""

    provider: Literal["razorpay", "fake"]
    mode: Literal["test", "live", "fake"]
    order_id: str
    key_id: str | None
    currency: Literal["INR"]
    amount_paise: int           # what Checkout charges (the total, GST included)
    added_paise: int
    gst_paise: int
    added_text: str
    gst_text: str
    total_text: str
    name: str
    description: str


class TopupConfirmIn(_Out):
    payment_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_.:-]{3,100}$")]
    signature: Annotated[str, Field(min_length=3, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")]


class TopupConfirmOut(_Out):
    state: Literal["paid"]
    replayed: bool              # true when the order was settled before (by this call earlier or by the webhook)
    added_text: str
    balance: BalanceOut
    invoice_number: str | None


class TopupFailedIn(_Out):
    reason: Literal["failed", "dismissed", "cancelled"]


class TopupFailedOut(_Out):
    recorded: bool


class TopupRowOut(_Out):
    order_id: str
    state: Literal["paid", "failed", "pending", "abandoned"]
    added_paise: int
    gst_paise: int
    total_paise: int
    added_text: str
    total_text: str
    failure_code: str | None
    failure_text: str | None
    created_at: datetime
    paid_at: datetime | None
    invoice_number: str | None
    refunded: bool


class TopupsOut(_Out):
    items: list[TopupRowOut]


class StatementRowOut(_Out):
    at: datetime
    kind: Literal["credit", "usage", "refund", "expiry"]
    label: str
    amount_paise: int           # positive = added, negative = taken
    amount_text: str
    balance_after_paise: int
    balance_after_text: str
    ref: str
    invoice_number: str | None


class StatementOut(_Out):
    items: list[StatementRowOut]
    has_more: bool
    next_before: datetime | None
    opening_paise: int
    closing_paise: int
    opening_text: str
    closing_text: str
    balance_paise: int
    balance_text: str


class InvoiceDetailOut(_Out):
    number: str
    kind: Literal["subscription", "topup", "payg_fee", "credit_note"]
    issued_at: datetime
    description: str
    subtotal_paise: int
    gst_paise: int
    total_paise: int
    subtotal_text: str
    gst_text: str
    total_text: str
    gst_percent: float
    tax_split: Literal["igst", "cgst_sgst"] | None
    cgst_paise: int
    sgst_paise: int
    igst_paise: int
    against_number: str | None
    buyer_name: str | None
    buyer_gstin: str | None
    buyer_state_code: str | None
    seller_name: str | None
    seller_gstin: str | None
    seller_address: str | None
    seller_sac: str | None
    seller_details_missing: bool   # true until the owner of the product has entered the company name and GSTIN: such an invoice is not yet a valid tax invoice


class InvoiceMailOut(_Out):
    sent: bool


ReasonCode = Literal["support_ticket", "customer_asked", "privacy_request", "incident", "billing_dispute", "other"]


class RefundIn(_Out):
    reason_code: ReasonCode
    reason_text: str = Field(min_length=3, max_length=300)
    idempotency_key: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")


class RefundOut(_Out):
    refund_id: str
    status: Literal["done"]
    refund_paise: int
    refund_text: str
    unused_paise: int           # the unused balance taken back
    gst_paise: int
    credit_note_number: str | None
    replayed: bool
