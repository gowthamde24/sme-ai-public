"""A store's order or checkout, read into the few closed facts we keep. Pure functions: a payload goes in, a small frozen object comes out, or None when it is not something we can use (no id, no number to
call). Nothing here logs. Fields are read from the stores' own documentation (docs/contracts/commerce-notify.md section B):
  Shopify order webhook   = the REST order object: id, name ("#1001"), phone, email, customer{first_name,last_name,phone}, shipping_address{phone,city}, billing_address{phone}, payment_gateway_names[],
                            financial_status, fulfillment_status, fulfillments[]{tracking_number,tracking_company,shipment_status}, total_price, currency, cancelled_at, line_items[]{title,quantity},
                            checkout_token, buyer_accepts_marketing, created_at
  Shopify checkout        id, token, abandoned_checkout_url (never kept), completed_at, phone, email, customer, shipping_address, billing_address, total_price, currency, line_items[]{title,quantity}
  WooCommerce order       REST v3 order: id, number, status, currency, total, payment_method, payment_method_title, date_paid, date_created_gmt, billing{first_name,last_name,phone,email,city},
                            shipping{phone,city}, line_items[]{name,quantity}, meta_data[]
A total in a currency other than INR is not turned into rupees (total_paise 0): the assistant never says an amount it cannot stand behind."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.lead_sources.phones import check_phone

COD_WORDS = ("cash on delivery", "cash_on_delivery", "cod", "pay on delivery", "pay at delivery")
_NUMBER = re.compile(r"[^#A-Za-z0-9 _-]")
_REF = re.compile(r"[^A-Za-z0-9_.:-]")
_TRACK = re.compile(r"[^A-Za-z0-9 ./:_-]")


@dataclass(frozen=True)
class OrderEvent:
    external_id: str
    number: str
    status: str                 # placed | confirmed | packed | shipped | delivered | cancelled | returned
    payment: str                # cod | prepaid | unknown
    total_paise: int
    items: str                  # item names, one line, at most 200 characters
    tracking: str
    phone: str | None           # the stored form (+91...), or None
    name: str | None
    email: str | None
    city: str | None
    placed_at: datetime
    checkout_ref: str | None    # the checkout this order finished (so its call-back is cancelled)
    accepts_marketing: bool


@dataclass(frozen=True)
class CheckoutEvent:
    external_id: str
    completed: bool
    total_paise: int
    items: str
    phone: str | None
    name: str | None


def _d(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _s(value: Any, limit: int = 200) -> str:
    return " ".join(str(value).split())[:limit] if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def paise(amount: Any, currency: Any) -> int:
    """Rupees as the store writes them ("1299.00") to whole paise; 0 when the currency is not INR or the text is not an amount."""
    if _s(currency).upper() not in ("INR", ""):
        return 0
    try:
        value = Decimal(str(amount).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return 0
    if value < 0 or value > Decimal("100000000"):
        return 0
    return int((value * 100).quantize(Decimal(1)))


def _when(value: Any) -> datetime:
    if isinstance(value, str):
        try:
            when = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            return when if when.tzinfo else when.replace(tzinfo=UTC)
        except ValueError:
            pass
    return datetime.now(UTC)


def _phone(*candidates: Any) -> str | None:
    for raw in candidates:
        found = check_phone(raw).stored if isinstance(raw, str) else None
        if found:
            return found
    return None


def _items(lines: Any, key: str) -> str:
    names: list[str] = []
    if isinstance(lines, list):
        for line in lines[:10]:
            if isinstance(line, dict) and _s(line.get(key), 80):
                qty = line.get("quantity")
                names.append(_s(line.get(key), 80) + (f" x{qty}" if isinstance(qty, int) and qty > 1 else ""))
    text = ", ".join(names)
    return text if len(text) <= 200 else text[:197].rstrip() + "..."


def _name(*parts: Any) -> str | None:
    text = " ".join(p for p in (_s(x, 60) for x in parts) if p)
    return text[:100] or None


def _cod(words: tuple[str, ...], *labels: Any) -> bool:
    for label in labels:
        low = _s(label, 120).lower()
        if any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", low) for w in words):
            return True
    return False


def _gateways(payload: dict[str, Any]) -> list[Any]:
    names = payload.get("payment_gateway_names")
    return list(names) if isinstance(names, list) else []


def shopify_order(payload: dict[str, Any], *, extra_cod_words: tuple[str, ...] = ()) -> OrderEvent | None:
    if not isinstance(payload, dict) or payload.get("id") in (None, ""):
        return None
    external = _REF.sub("", _s(payload["id"], 80))
    if not external:
        return None
    customer = _d(payload.get("customer"))
    ship = _d(payload.get("shipping_address"))
    bill = _d(payload.get("billing_address"))
    words = COD_WORDS + tuple(w.lower() for w in extra_cod_words)
    financial = _s(payload.get("financial_status"), 30).lower()
    if _cod(words, *_gateways(payload)):
        payment = "cod"
    elif financial in ("paid", "partially_paid", "authorized"):
        payment = "prepaid"
    else:
        payment = "unknown"
    fulfilments = [f for f in (payload.get("fulfillments") or []) if isinstance(f, dict)]
    tracking = next((_TRACK.sub("", _s(f.get("tracking_number"), 80)) for f in fulfilments if _s(f.get("tracking_number"), 80)), "")
    company = next((_s(f.get("tracking_company"), 30) for f in fulfilments if _s(f.get("tracking_company"), 30)), "")
    if tracking and company:
        tracking = _TRACK.sub("", f"{company} {tracking}")[:80]
    fulfilled = _s(payload.get("fulfillment_status"), 20).lower()
    if payload.get("cancelled_at"):
        status = "cancelled"
    elif any(_s(f.get("shipment_status"), 30).lower() == "delivered" for f in fulfilments):
        status = "delivered"
    elif fulfilled == "fulfilled" or (fulfilments and fulfilled == "partial"):
        status = "shipped"
    elif financial == "refunded":
        status = "returned"
    else:
        status = "placed"
    number = _NUMBER.sub("", _s(payload.get("name"), 30)) or ("#" + _NUMBER.sub("", _s(payload.get("order_number"), 20)))
    if number in ("#", ""):
        number = "#" + external[-6:]
    return OrderEvent(
        external_id=external, number=number[:30], status=status, payment=payment, total_paise=paise(payload.get("total_price"), payload.get("currency")),
        items=_items(payload.get("line_items"), "title"), tracking=tracking,
        phone=_phone(payload.get("phone"), ship.get("phone"), bill.get("phone"), customer.get("phone")),
        name=_name(customer.get("first_name") or ship.get("first_name") or bill.get("first_name"), customer.get("last_name") or ship.get("last_name") or bill.get("last_name")),
        email=_s(payload.get("email") or customer.get("email"), 254) or None, city=_s(ship.get("city") or bill.get("city"), 100) or None,
        placed_at=_when(payload.get("created_at")), checkout_ref=(_REF.sub("", _s(payload.get("checkout_token"), 80)) or None),
        accepts_marketing=payload.get("buyer_accepts_marketing") is True,
    )


_WOO_STATUS = {"pending": "placed", "on-hold": "placed", "processing": "confirmed", "completed": "shipped", "cancelled": "cancelled", "failed": "cancelled", "refunded": "returned", "trash": "cancelled"}


def woo_order(payload: dict[str, Any], *, extra_cod_words: tuple[str, ...] = ()) -> OrderEvent | None:
    if not isinstance(payload, dict) or payload.get("id") in (None, ""):
        return None
    external = _REF.sub("", _s(payload["id"], 80))
    if not external:
        return None
    bill = _d(payload.get("billing"))
    ship = _d(payload.get("shipping"))
    words = COD_WORDS + tuple(w.lower() for w in extra_cod_words)
    if _s(payload.get("payment_method"), 40).lower() == "cod" or _cod(words, payload.get("payment_method_title")):
        payment = "cod"
    elif payload.get("date_paid") or _s(payload.get("payment_method"), 40):
        payment = "prepaid" if payload.get("date_paid") else "unknown"
    else:
        payment = "unknown"
    number = "#" + _NUMBER.sub("", _s(payload.get("number") or payload.get("id"), 20))
    return OrderEvent(
        external_id=external, number=number[:30], status=_WOO_STATUS.get(_s(payload.get("status"), 20).lower(), "placed"), payment=payment,
        total_paise=paise(payload.get("total"), payload.get("currency")), items=_items(payload.get("line_items"), "name"), tracking="",
        phone=_phone(bill.get("phone"), ship.get("phone")), name=_name(bill.get("first_name") or ship.get("first_name"), bill.get("last_name") or ship.get("last_name")),
        email=_s(bill.get("email"), 254) or None, city=_s(bill.get("city") or ship.get("city"), 100) or None,
        placed_at=_when(payload.get("date_created_gmt") or payload.get("date_created")), checkout_ref=None, accepts_marketing=False,
    )


def shopify_checkout(payload: dict[str, Any]) -> CheckoutEvent | None:
    if not isinstance(payload, dict):
        return None
    ref = _REF.sub("", _s(payload.get("token") or payload.get("id"), 80))
    if not ref:
        return None
    customer = _d(payload.get("customer"))
    ship = _d(payload.get("shipping_address"))
    bill = _d(payload.get("billing_address"))
    return CheckoutEvent(
        external_id=ref, completed=bool(payload.get("completed_at")), total_paise=paise(payload.get("total_price"), payload.get("currency")),
        items=_items(payload.get("line_items"), "title"), phone=_phone(payload.get("phone"), ship.get("phone"), bill.get("phone"), customer.get("phone")),
        name=_name(customer.get("first_name") or ship.get("first_name") or bill.get("first_name"), customer.get("last_name") or ship.get("last_name") or bill.get("last_name")),
    )
