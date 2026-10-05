"""The value-in-span check (owner change D): does the quote SUPPORT the typed value?

Deterministic, in the runtime, before anything is written:
  * a number (quantity, budget, advance percentage, net days) must be one of the numbers the quote states (with "k", "lakh",
    "dozen" and number words applied, the same reading the normaliser uses);
  * a date must be one of the dates the quote expresses (resolved from the received day in Asia/Kolkata);
  * a closed-vocabulary value needs a word or phrase from its small synonym list in the quote ('other' needs any words);
  * a city must appear in the quote.
A value the quote does not support is refused: a model cannot attach a number or a choice to words that do not say it.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal

from app.requirements import vocabulary as V
from app.requirements.normalise import Value, date_candidates, numbers_in, received_day


def supports(key: str, value: Value, quote: str, received_at: datetime) -> bool:
    if key in ("saree_type", "fabric", "colour"):
        return value.code is not None and V.supports(key, value.code, quote)
    if key == "quantity":
        return value.int_value is not None and Decimal(value.int_value) in numbers_in(quote)
    if key == "budget":
        return value.int_value is not None and Decimal(value.int_value) / 100 in numbers_in(quote)
    if key == "deadline":
        wanted = value.date_value
        return wanted is not None and any(
            d == wanted for d, _ in date_candidates(quote, received_day(received_at))
        )
    if key == "delivery_city":
        return bool(value.text) and V.phrase_in(quote, value.text or "")
    if key == "payment_terms":
        if value.code is None or not V.supports("payment_terms", value.code, quote):
            return False
        if value.code == "net_days":
            return value.int_value is not None and Decimal(value.int_value) in numbers_in(quote)
        if value.code == "advance_partial":
            return value.int_value is not None and Decimal(value.int_value) / 100 in numbers_in(
                quote
            )
        return True
    return False


_RANGE_BEFORE = re.compile(
    r"\d[\d,.]*\s*(?:k|lakh|lac|crore|cr)?\s*(?:-|–|—|to)\s*$", re.IGNORECASE
)
_RANGE_AFTER = re.compile(r"^\s*(?:-|–|—|to)\s*\d")


def in_range_context(body: str, start: int, end: int) -> bool:
    """Is the quoted number one end of a range in the enquiry ("20-30 sarees": a quote of "30 sarees" alone)? A model may quote only
    one end; the text around the quote says it is not a single number, so the field cannot be `stated`."""
    return bool(
        _RANGE_BEFORE.search(body[max(0, start - 24) : start])
        or _RANGE_AFTER.search(body[end : end + 24])
    )
