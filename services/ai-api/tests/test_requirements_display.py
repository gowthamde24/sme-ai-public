"""T008: our own wording of a typed value (what the review screen shows)."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import date

import pytest

from app.requirements.display import display, label, rupees
from app.requirements.normalise import Value


@pytest.mark.parametrize(
    ("paise", "text"),
    [
        (100, "Rs 1"),
        (12345, "Rs 123.45"),
        (500_000, "Rs 5,000"),
        (15_000_000, "Rs 1,50,000"),
        (1_000_000_000, "Rs 1,00,00,000"),
        (100_000_000, "Rs 10,00,000"),
        (99_999_900, "Rs 9,99,999"),
    ],
)
def test_money_uses_indian_grouping(paise: int, text: str) -> None:
    assert rupees(paise) == text


@pytest.mark.parametrize(
    ("key", "value", "text"),
    [
        ("saree_type", Value(code="dharmavaram_pattu"), "Dharmavaram pattu"),
        ("saree_type", Value(code="other"), "Other"),
        ("fabric", Value(code="cotton_silk"), "Cotton silk"),
        ("colour", Value(code="red"), "Red"),
        ("quantity", Value(int_value=1, basis="piece"), "1 piece"),
        ("quantity", Value(int_value=24, basis="piece"), "24 pieces"),
        ("quantity", Value(int_value=3, basis="set"), "3 sets"),
        ("budget", Value(int_value=500_000, basis="per_piece"), "Rs 5,000 per piece"),
        ("budget", Value(int_value=25_000_000, basis="total"), "Rs 2,50,000 in total"),
        ("deadline", Value(date_value=date(2026, 11, 5)), "5 November 2026"),
        ("delivery_city", Value(text="Navi Mumbai"), "Navi Mumbai"),
        ("payment_terms", Value(code="net_days", int_value=30, basis="days"), "Net 30 days"),
        (
            "payment_terms",
            Value(code="advance_partial", int_value=5000, basis="bps"),
            "50% advance",
        ),
        (
            "payment_terms",
            Value(code="advance_partial", int_value=2550, basis="bps"),
            "25.5% advance",
        ),
        ("payment_terms", Value(code="advance_full"), "Full advance"),
        ("payment_terms", Value(code="cash_on_delivery"), "Cash on delivery"),
    ],
)
def test_display(key: str, value: Value, text: str) -> None:
    assert display(key, value) == text


def test_an_empty_value_displays_nothing_and_a_label_of_none_is_empty() -> None:
    assert display("quantity", Value()) == ""
    assert display("unknown", Value(code="x")) == ""
    assert label(None) == ""
