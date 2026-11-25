"""What the phone assistant may say about THIS caller's own store orders (docs/contracts/commerce-notify.md section B). The database function `commerce_order_facts` returns at most three orders whose number
is the caller's own (a connected store, the owner's "answer order questions" choice on); this turns them into fact lines for the call's fact pack (app/telephony/fact_pack.py reads `raw["orders"]`).
The words say only what the store says. No delivery date is promised, no address or name is in a line, and an amount is said only when the order's total is known (it is then in the pack's allowed amounts)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

ENABLED = False   # set from COMMERCE=on by create_app: only then does a call look up the caller's orders

STATUS_WORDS = {
    "placed": "received and not confirmed yet",
    "confirmed": "confirmed and being prepared",
    "packed": "packed and not sent yet",
    "shipped": "sent",
    "delivered": "marked delivered",
    "cancelled": "cancelled",
    "returned": "returned or refunded",
}
PAYMENT_WORDS = {"cod": "cash on delivery", "prepaid": "paid online", "unknown": ""}


def rupees(paise: int) -> str:
    whole, frac = divmod(int(paise), 100)
    return f"Rs {whole:,}" + (f".{frac:02d}" if frac else "")


def order_facts(rows: Any) -> tuple[list[dict[str, str]], set[int]]:
    """(fact lines for the pack, the amounts they say in paise)."""
    facts: list[dict[str, str]] = []
    amounts: set[int] = set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        number = " ".join(str(row.get("number") or "").split())[:30]
        status = STATUS_WORDS.get(str(row.get("status")))
        if not number or status is None:
            continue
        bits = [PAYMENT_WORDS.get(str(row.get("payment")), "")]
        try:
            paise = int(row.get("paise") or 0)
        except (TypeError, ValueError):
            paise = 0
        if paise > 0:
            bits.append(rupees(paise))
            amounts.add(paise)
        items = " ".join(str(row.get("items") or "").split())[:120]
        if items:
            bits.append(items)
        tracking = " ".join(str(row.get("tracking") or "").split())[:80]
        text = f"This caller's own order {number} ({', '.join(b for b in bits if b)}): {status}." + (f" Tracking: {tracking}." if tracking and row.get("status") in ("shipped", "delivered") else "")
        text += " Say only this about the order; for anything else (a date, an address, a change) say the team will check and call back."
        facts.append({"kind": "order", "text": text})
    return facts, amounts
