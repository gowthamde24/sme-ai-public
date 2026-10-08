"""The optional price range of an item type (manual-price quote, slice 1). A pure function with no I/O.

The DATABASE decides (`app.price_outside_range`, `app.item_type_price_outside_range`); this mirror is for the API to refuse early and for a later slice to share one rule in tests.
A price outside the range is refused with the code `price_outside_range`. There is NO override flag: whether the owners may override a refusal is their decision, later.
Money is integer minor units (paise); nothing here uses a float."""

from __future__ import annotations

PRICE_OUTSIDE_RANGE = "price_outside_range"
MAX_PRICE_PAISE = 100_000_000


def price_outside_range(price_paise: int, min_paise: int | None, max_paise: int | None) -> bool:
    """True when the price lies below the lowest or above the highest. A missing bound is no bound; both missing never refuse. A missing, non-integer or non-positive price is refused
    (ValueError), not treated as inside: the same rule as the database function."""
    if isinstance(price_paise, bool) or not isinstance(price_paise, int) or price_paise < 1:
        raise ValueError("price must be a whole number of paise, at least 1")
    return (min_paise is not None and price_paise < min_paise) or (
        max_paise is not None and price_paise > max_paise
    )
