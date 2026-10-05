"""Our own wording of a typed value, for the screen ("20 pieces", "Rs 5,000 per piece", "15 November 2026").

Deterministic; the only customer-written text it can carry is the delivery city, which clients show as plain text like every other
field of an enquiry. Money is the customer's STATED budget in paise, never a price of ours.
"""

from __future__ import annotations

from app.requirements.normalise import Value
from app.requirements.questions import LABELS, MONTHS

_BASIS_WORDS = {"per_piece": "per piece", "total": "in total"}
_PAYMENT = {
    "advance_full": "Full advance",
    "cash_on_delivery": "Cash on delivery",
}


def label(code: str | None) -> str:
    if code is None:
        return ""
    return LABELS.get(code) or code.replace("_", " ").capitalize()


def rupees(paise: int) -> str:
    """Indian digit grouping: 1,50,000 and 2,50,00,000; paise only when there are some."""
    whole, part = divmod(paise, 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    return f"Rs {digits}" + (f".{part:02d}" if part else "")


def display(key: str, value: Value) -> str:
    if key in ("saree_type", "fabric", "colour"):
        return label(value.code)
    if key == "quantity" and value.int_value is not None:
        unit = "set" if value.basis == "set" else "piece"
        return f"{value.int_value} {unit}{'' if value.int_value == 1 else 's'}"
    if key == "budget" and value.int_value is not None:
        return f"{rupees(value.int_value)} {_BASIS_WORDS.get(value.basis or '', '')}".strip()
    if key == "deadline" and value.date_value is not None:
        d = value.date_value
        return f"{d.day} {MONTHS[d.month - 1]} {d.year}"
    if key == "delivery_city":
        return value.text or ""
    if key == "payment_terms" and value.code is not None:
        if value.code == "net_days" and value.int_value is not None:
            return f"Net {value.int_value} days"
        if value.code == "advance_partial" and value.int_value is not None:
            pct = value.int_value / 100
            return f"{pct:g}% advance"
        return _PAYMENT.get(value.code, label(value.code))
    return ""
