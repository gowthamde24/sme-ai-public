"""The Researcher's decision (ADR 0119, job part B). Deterministic rules first; a model may only reword the one-line reason, never the score or the decision.

Fit score 0..100 = category match to the business type's buyers (0..40) + size signals: rating and reviews (0..20) + distance (0..15) + STOCK MATCH: what they would likely buy against what we have (0..25).

Decision, in this order:
  skip         suppressed, contacted in the last 90 days, no phone number, not a buyer type (not_a_buyer), fit < 50 (fit_low); a competitor is never skipped: it goes to the Owner
  needs_owner  fit 50 .. bar-1 (fit_middle), a very large buyer, low stock, looks like a competitor or wholesaler, AND every would-be call of a search until the Owner has said yes to 10 of them (first_calls)
  call_ready   fit >= the Owner's bar (default 70), stock matches, inside the calling hours, under the daily call cap
  researching  would be call_ready but it is outside the calling hours or the day's cap is used: decided again later (never called now)
"""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from app.lead_finder.packdata import BuyerType, PackLeadFinder
from app.lead_finder.sources import Place

IST = timezone(timedelta(hours=5, minutes=30))
FIRST_CALLS = 10
RECENT_DAYS = 90
SKIP_BELOW = 50
Status = Literal["call_ready", "needs_owner", "skipped", "researching"]


@dataclass(frozen=True)
class StockLine:
    """One item of OUR catalogue as the Researcher and the call see it. `price_paise` only when the Owner set an exact price; `stock` is the catalogue's closed word."""

    name: str
    keywords: str
    price_paise: int | None
    unit: str
    moq: int | None
    stock: Literal["in_stock", "few_left", "made_to_order", "out_of_stock"]

    @property
    def available(self) -> bool:
        return self.stock in ("in_stock", "few_left")


@dataclass(frozen=True)
class Settings:
    fit_bar: int = 70
    daily_call_cap: int = 20
    call_from_hour: int = 10
    call_to_hour: int = 19

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Settings:
        return cls(fit_bar=int(row.get("fit_bar", 70)), daily_call_cap=int(row.get("daily_call_cap", 20)), call_from_hour=int(row.get("call_from_hour", 10)), call_to_hour=int(row.get("call_to_hour", 19)))


@dataclass(frozen=True)
class Situation:
    """What changes over a day: the time now, calls already made today, call_ready ones waiting, the Owner's yeses in this search."""

    now: datetime
    calls_today: int = 0
    ready_waiting: int = 0
    approved_in_search: int = 0


@dataclass(frozen=True)
class StockMatch:
    matched: list[str] = field(default_factory=list)
    low: list[str] = field(default_factory=list)
    enough: bool = False

    def as_json(self) -> dict[str, Any]:
        return {"matched": self.matched[:5], "low": self.low[:5], "enough": self.enough}


@dataclass(frozen=True)
class Decision:
    status: Status
    reason: str
    fit: int
    fit_reason: str
    stock: StockMatch
    buyer_type: str | None


def buyer_type_of(place: Place, data: PackLeadFinder) -> tuple[BuyerType | None, bool]:
    """(the type, whether it is one of the main buyer types). Words are matched in the category first, then the name."""
    text = f"{place.category or ''} {place.name}".casefold()
    for group, main in ((data.buyer_types, True), (data.related_types, False)):
        for t in group:
            if any(w in text for w in t.words):
                return t, main
    return None, False


def is_competitor(place: Place, data: PackLeadFinder) -> bool:
    text = f"{place.category or ''} {place.name}".casefold()
    return any(w in text for w in data.competitor_words)


def is_very_large(place: Place, data: PackLeadFinder) -> bool:
    text = f"{place.category or ''} {place.name}".casefold()
    return (place.review_count or 0) >= data.very_large_reviews or any(w in text for w in data.very_large_words)


def stock_match(buyer: BuyerType | None, stock: list[StockLine]) -> StockMatch:
    """What they would likely buy (the buyer type's `likely` words) against what we have. Enough = at least one matching item in stock (not "few left", not made to order)."""
    if buyer is None:
        return StockMatch()
    likely = buyer.likely or tuple(buyer.words)
    hits = [s for s in stock if any(w in s.keywords.casefold() for w in likely)]
    matched = [s.name for s in hits if s.stock == "in_stock"]
    low = [s.name for s in hits if s.stock == "few_left"]
    return StockMatch(matched=matched, low=low, enough=bool(matched))


def size_points(place: Place) -> int:
    r = place.review_count or 0
    pts = 12 if r >= 200 else 8 if r >= 50 else 4 if r >= 10 else 0
    if place.rating is not None:
        pts += 8 if place.rating >= 4.2 else 5 if place.rating >= 3.8 else 2
    return pts


def distance_points(km: float | None) -> int:
    if km is None:
        return 8   # unknown: the searched area was named by the Owner, so it is near enough to be worth a middle score
    return 15 if km <= 5 else 10 if km <= 15 else 6 if km <= 40 else 2


def fit_score(buyer: BuyerType | None, place: Place, stock: StockMatch, km: float | None) -> int:
    category = buyer.weight if buyer else 0
    stock_pts = 25 if stock.enough else 12 if stock.low else 0
    return max(0, min(100, category + size_points(place) + distance_points(km) + stock_pts))


def reason_line(buyer: BuyerType | None, stock: StockMatch, place: Place) -> str:
    """One line, built from closed words and our own item names only (no personal data, no model)."""
    who = buyer.label if buyer else (place.category or "Business")
    if stock.enough:
        have = ", ".join(stock.matched[:2])
        line = f"{who}; we have {have} in stock"
    elif stock.low:
        line = f"{who}; only a few left of {', '.join(stock.low[:2])}"
    elif buyer:
        line = f"{who}; nothing in our stock matches yet"
    else:
        line = f"{who}; not a buyer of what we sell"
    if place.review_count:
        line += f"; {place.review_count} reviews"
    return line[:300]


def within_hours(now: datetime, s: Settings) -> bool:
    local = now.astimezone(IST)
    return s.call_from_hour <= local.hour < s.call_to_hour and 9 <= local.hour < 21


def decide(place: Place, data: PackLeadFinder, stock: list[StockLine], settings: Settings, situation: Situation, *, km: float | None = None,
           suppressed: bool = False, last_contacted_at: datetime | None = None, owner_approved: bool = False) -> Decision:
    buyer, _main = buyer_type_of(place, data)
    match = stock_match(buyer, stock)
    fit = fit_score(buyer, place, match, km)
    line = reason_line(buyer, match, place)
    btype = buyer.code if buyer else None

    def out(status: Status, reason: str) -> Decision:
        return Decision(status=status, reason=reason, fit=fit, fit_reason=line, stock=match, buyer_type=btype)

    # skip
    if suppressed:
        return out("skipped", "suppressed")
    if last_contacted_at is not None and situation.now - last_contacted_at < timedelta(days=RECENT_DAYS):
        return out("skipped", "contacted_recently")
    if not place.phone:
        return out("skipped", "no_phone")
    # a competitor or wholesaler is the Owner's call (it may also be a reseller), whatever its score
    if is_competitor(place, data):
        return out("needs_owner", "competitor")
    if buyer is None:
        return out("skipped", "not_a_buyer")
    if fit < SKIP_BELOW:
        return out("skipped", "fit_low")
    # needs the Owner
    if is_very_large(place, data):
        return out("needs_owner", "very_large")
    if fit < settings.fit_bar:
        return out("needs_owner", "fit_middle")
    if not match.enough:
        return out("needs_owner", "low_stock" if match.low else "no_stock_match")
    if not owner_approved and situation.approved_in_search < FIRST_CALLS:
        return out("needs_owner", "first_calls")
    # call ready, unless the hour or the cap says wait
    if not within_hours(situation.now, settings):
        return out("researching", "outside_hours")
    if situation.calls_today + situation.ready_waiting >= settings.daily_call_cap:
        return out("researching", "daily_cap")
    return out("call_ready", "owner_approved" if owner_approved else "fit_high")


def decide_all(places: list[Place], data: PackLeadFinder, stock: list[StockLine], settings: Settings, situation: Situation) -> list[Decision]:
    """Decisions for a whole new search: each call_ready one counts against the day's cap for the next."""
    out: list[Decision] = []
    waiting = situation.ready_waiting
    for place in places:
        d = decide(place, data, stock, settings, Situation(now=situation.now, calls_today=situation.calls_today, ready_waiting=waiting, approved_in_search=situation.approved_in_search))
        if d.status == "call_ready":
            waiting += 1
        out.append(d)
    return out
