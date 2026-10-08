"""The pure price-range check of an item type (manual-price quote, slice 1): the mirror of
`app.price_outside_range`. Integer paise only."""

from __future__ import annotations

from typing import Any

import pytest

from app.quotes.price_range import MAX_PRICE_PAISE, PRICE_OUTSIDE_RANGE, price_outside_range


def test_the_refusal_code_is_the_one_the_plan_names() -> None:
    assert PRICE_OUTSIDE_RANGE == "price_outside_range"


@pytest.mark.parametrize(
    ("price", "low", "high", "outside"),
    [
        (100, 200, 300, True),  # below
        (199, 200, 300, True),  # one paisa below
        (200, 200, 300, False),  # exactly the lowest
        (250, 200, 300, False),
        (300, 200, 300, False),  # exactly the highest
        (301, 200, 300, True),  # one paisa above
        (100, None, None, False),  # no range: never outside
        (100, None, 50, True),  # only a ceiling
        (40, None, 50, False),
        (100, 150, None, True),  # only a floor
        (150, 150, None, False),
        (5000, 5000, 5000, False),  # equal bounds: only that price
        (4999, 5000, 5000, True),
        (5001, 5000, 5000, True),
        (1, 1, MAX_PRICE_PAISE, False),
        (MAX_PRICE_PAISE, 1, MAX_PRICE_PAISE, False),
    ],
)
def test_below_the_lowest_or_above_the_highest_is_outside(
    price: int, low: int | None, high: int | None, outside: bool
) -> None:
    assert price_outside_range(price, low, high) is outside


@pytest.mark.parametrize("bad", [0, -1, None, 1.5, "100", True])
def test_a_price_that_is_not_a_positive_whole_number_is_refused_not_treated_as_inside(
    bad: Any,
) -> None:
    with pytest.raises(ValueError):
        price_outside_range(bad, 1, 2)
