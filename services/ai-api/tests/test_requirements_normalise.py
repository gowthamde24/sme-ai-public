"""T008: the deterministic normalisers (the model points at words; this code makes the typed values)."""

# ruff: noqa: E501, S311

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.requirements.normalise import (
    Normalised,
    Refused,
    normalise,
    numbers_in,
    received_day,
    worse,
)

RECEIVED = datetime(2026, 10, 5, 10, 0, tzinfo=UTC)  # a Monday


def n(key: str, raw: str, received: datetime = RECEIVED) -> Normalised:
    return normalise(key, raw, received)


def refused(key: str, raw: str) -> str:
    with pytest.raises(Refused) as e:
        n(key, raw)
    return e.value.reason


# ------------------------------------------------------------------------------------------- quantity
@pytest.mark.parametrize(
    ("raw", "qty", "basis", "certainty"),
    [
        ("20", 20, "piece", "stated"),
        ("20 sarees", 20, "piece", "stated"),
        ("20pcs", 20, "piece", "stated"),
        ("1,200 pieces", 1200, "piece", "stated"),
        ("10,000", 10_000, "piece", "stated"),
        ("2 dozen", 24, "piece", "stated"),
        ("a dozen", 12, "piece", "stated"),
        ("half dozen", 6, "piece", "stated"),
        ("twenty five", 25, "piece", "stated"),
        ("two hundred", 200, "piece", "stated"),
        ("one hundred and fifty", 150, "piece", "stated"),
        ("bees", 20, "piece", "stated"),
        ("do sau", 200, "piece", "stated"),
        ("pachas sarees", 50, "piece", "stated"),
        ("about 50", 50, "piece", "implied"),
        ("~30", 30, "piece", "implied"),
        ("20-30", 20, "piece", "ambiguous"),
        ("20 to 30 sarees", 20, "piece", "ambiguous"),
        ("5 sets", 5, "set", "stated"),
    ],
)
def test_quantity(raw: str, qty: int, basis: str, certainty: str) -> None:
    got = n("quantity", raw)
    assert (got.value.int_value, got.value.basis, got.certainty) == (qty, basis, certainty)


def test_quantity_caps_and_refusals() -> None:
    assert n("quantity", "10000").value.int_value == 10_000
    assert refused("quantity", "10001") == "over_cap"
    assert refused("quantity", "1,00,00,000") == "over_cap"
    assert refused("quantity", "0") == "under_floor"
    assert refused("quantity", "do you have") == "unparsed"
    assert refused("quantity", "2.5") == "unparsed"
    assert refused("quantity", "") == "unparsed"


# ------------------------------------------------------------------------------------------- money
@pytest.mark.parametrize(
    ("raw", "paise", "basis", "certainty"),
    [
        ("Rs 5,000 per piece", 500_000, "per_piece", "stated"),
        ("5k each", 500_000, "per_piece", "stated"),
        ("INR 2.5 lakh total", 25_000_000, "total", "stated"),
        ("₹ 1,50,000 total", 15_000_000, "total", "stated"),
        ("1 crore total", 1_000_000_000, "total", "stated"),
        ("50000", 5_000_000, "total", "ambiguous"),  # no basis: a human decides
        ("5-6k per saree", 500_000, "per_piece", "ambiguous"),
        ("about 20k total", 2_000_000, "total", "implied"),
        ("fifty thousand total", 5_000_000, "total", "stated"),
        ("two lakh overall", 20_000_000, "total", "stated"),
    ],
)
def test_budget(raw: str, paise: int, basis: str, certainty: str) -> None:
    got = n("budget", raw)
    assert (got.value.int_value, got.value.basis, got.certainty) == (paise, basis, certainty)


def test_budget_caps() -> None:
    assert (
        n("budget", "10,00,000 per piece").value.int_value == 100_000_000
    )  # INR 1,000,000: the engine's MAX_UNIT_PRICE
    assert refused("budget", "10,00,001 per piece") == "over_cap"
    assert (
        n("budget", "1 crore total").value.int_value == 1_000_000_000
    )  # INR 10,000,000: MAX_CREDIT_LIMIT
    assert refused("budget", "1.01 crore total") == "over_cap"
    assert refused("budget", "0 total") == "under_floor"
    assert refused("budget", "no idea") == "unparsed"
    assert refused("budget", "2.005 total") == "unparsed"  # a fraction of a paisa


# ------------------------------------------------------------------------------------------- dates
@pytest.mark.parametrize(
    ("raw", "expected", "certainty"),
    [
        ("2026-11-15", date(2026, 11, 15), "stated"),
        ("15/11/2026", date(2026, 11, 15), "stated"),  # day first
        ("15-11-26", date(2026, 11, 15), "stated"),
        ("15 November 2026", date(2026, 11, 15), "stated"),
        ("Nov 15th, 2026", date(2026, 11, 15), "stated"),
        ("15th of Nov", date(2026, 11, 15), "implied"),  # the year is inferred
        ("5 Jan", date(2027, 1, 5), "implied"),  # already past this year: next year
        ("today", date(2026, 10, 5), "implied"),
        ("tomorrow", date(2026, 10, 6), "implied"),
        ("day after tomorrow", date(2026, 10, 7), "implied"),
        ("next week", date(2026, 10, 12), "implied"),
        ("in 2 weeks", date(2026, 10, 19), "implied"),
        ("within 10 days", date(2026, 10, 15), "implied"),
        ("by month end", date(2026, 10, 31), "implied"),
        ("end of next month", date(2026, 11, 30), "implied"),
        ("next Friday", date(2026, 10, 9), "implied"),
        ("Monday", date(2026, 10, 12), "implied"),  # strictly after the received day
        ("1 Oct 2026", date(2026, 10, 1), "ambiguous"),  # before the received day
    ],
)
def test_deadline(raw: str, expected: date, certainty: str) -> None:
    got = n("deadline", raw)
    assert (got.value.date_value, got.certainty) == (expected, certainty)


def test_relative_dates_resolve_in_india_not_in_utc() -> None:
    late_utc = datetime(2026, 10, 4, 20, 0, tzinfo=UTC)  # 01:30 on the 5th in Asia/Kolkata
    assert received_day(late_utc) == date(2026, 10, 5)
    assert n("deadline", "today", late_utc).value.date_value == date(2026, 10, 5)
    assert n("deadline", "tomorrow", late_utc).value.date_value == date(2026, 10, 6)
    early_utc = datetime(2026, 10, 5, 20, 0, tzinfo=UTC)  # 01:30 on the 6th in India
    assert n("deadline", "by month end", early_utc).value.date_value == date(2026, 10, 31)
    assert n("deadline", "tomorrow", early_utc).value.date_value == date(2026, 10, 7)
    with pytest.raises(ValueError):
        received_day(datetime(2026, 10, 5, 10, 0))  # noqa: DTZ001 - a naive time is refused on purpose


@pytest.mark.parametrize(
    "raw", ["Diwali", "before Diwali", "by Pongal", "wedding season", "festival time", "Dussehra"]
)
def test_a_festival_is_never_resolved_to_a_date(raw: str) -> None:
    assert refused("deadline", raw) == "festival"


def test_date_refusals() -> None:
    assert refused("deadline", "soon") == "unparsed"
    assert refused("deadline", "2101-01-01") == "over_cap"
    assert refused("deadline", "2019-12-31") == "over_cap"
    assert refused("deadline", "31/02/2026") == "unparsed"  # not a real date


# ------------------------------------------------------------------------------------------- city, vocabulary, payment
@pytest.mark.parametrize(
    ("raw", "city"),
    [
        ("Hyderabad", "Hyderabad"),
        ("  Navi   Mumbai. ", "Navi Mumbai"),
        ("St. John's", "St. John's"),
        ("बेंगलुरु", "बेंगलुरु"),
    ],
)
def test_city(raw: str, city: str) -> None:
    assert n("delivery_city", raw).value.text == city


@pytest.mark.parametrize(
    "raw",
    [
        "Hyd 500081",
        "x" * 61,
        "a@b.in",
        "http://x.test",
        "send money now!",
        "<script>",
        "Pune\nand Delhi",
    ],
)
def test_a_city_is_letters_only(raw: str) -> None:
    assert refused("delivery_city", raw) == "not_a_city"


@pytest.mark.parametrize(
    ("raw", "code", "num", "basis", "certainty"),
    [
        ("COD", "cash_on_delivery", None, None, "stated"),
        ("cash on delivery", "cash_on_delivery", None, None, "stated"),
        ("100% advance", "advance_full", None, None, "stated"),
        ("full advance", "advance_full", None, None, "stated"),
        ("advance", "advance_full", None, None, "implied"),
        ("50% advance", "advance_partial", 5000, "bps", "stated"),
        ("30 percent advance", "advance_partial", 3000, "bps", "stated"),
        ("net 30", "net_days", 30, "days", "stated"),
        ("30 days credit", "net_days", 30, "days", "stated"),
        ("payment within 45 days", "net_days", 45, "days", "stated"),
        ("net 180", "net_days", 180, "days", "stated"),
    ],
)
def test_payment_terms(
    raw: str, code: str, num: int | None, basis: str | None, certainty: str
) -> None:
    got = n("payment_terms", raw)
    assert (got.value.code, got.value.int_value, got.value.basis, got.certainty) == (
        code,
        num,
        basis,
        certainty,
    )


def test_payment_refusals() -> None:
    assert refused("payment_terms", "net 181") == "over_cap"
    assert refused("payment_terms", "365 days") == "over_cap"
    assert refused("payment_terms", "0% advance") == "under_floor"
    assert refused("payment_terms", "150% advance") == "over_cap"
    assert refused("payment_terms", "as usual") == "unparsed"


def test_vocabulary_values() -> None:
    assert n("saree_type", "Kanchipuram").value.code == "kanjivaram"
    assert n("saree_type", "dharmavaram silk").certainty == "stated"
    assert n("colour", "mehendi green").value.code == "green"
    other = n("colour", "turquoise")
    assert (other.value.code, other.certainty) == ("other", "implied")
    assert refused("colour", "  ") == "unparsed"
    assert refused("nonsense", "x") == "unknown_field"
    assert refused("quantity", "x" * 121) == "unparsed"


# ------------------------------------------------------------------------------------------- helpers
def test_numbers_in_reads_multipliers_and_words() -> None:
    got = numbers_in("2 dozen at 5k, 1.5 lakh or twenty five or 5-6k")
    for want in (2, 24, 5, 5000, 6000, 150_000, 25, 12):
        assert Decimal(want) in got
    assert Decimal(2) not in numbers_in("do you have 20 sarees")
    assert numbers_in("29ABCDE1234F1Z5") == set()  # glued to letters: not a number


def test_worse_orders_certainty() -> None:
    assert worse("stated", "implied") == "implied"
    assert worse("ambiguous", "implied") == "ambiguous"
    assert worse("stated", "stated") == "stated"
