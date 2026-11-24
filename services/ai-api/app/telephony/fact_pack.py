"""The phone assistant's FACT PACK (28 Nov 2026): the few facts an AI phone call may use, built ONCE at the start of a call from what the owner already controls.

Until now a call was given no facts (the call path passed an empty list), so every question about the business was deflected to the team. The database function `phone_fact_pack` returns, for one workspace, the owner's
notes, the owner's FAQ answers, the calling hours, the active catalogue items (names and facts, never a price) and the CURRENT price list. This module turns that into short "facts the assistant may state", capped at
about 1,500 tokens, and into the set of rupee amounts the assistant may say.

THE ONE RULE ABOUT MONEY: an amount comes ONLY from a price-list row. Every rupee amount in the owner's notes and FAQ answers is taken out before the model sees it, the catalogue carries no price, and the voice
checks every sentence it is about to speak (app/talk_training/guard.py): an amount that is not a price-list amount is never spoken (a short deflection is said instead)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
MAX_TOKENS = 1500           # the whole pack (measured 28 Nov with count_tokens: Telugu about 1.1 characters a token, English about 2.6)
BUDGET = {"prices": 500, "catalogue": 350, "faq": 350}   # tokens per section; the notes get what is left
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
STOCK = {"in_stock": "in stock", "few_left": "only a few left", "made_to_order": "made to order"}
UNITS = {"piece": "piece", "metre": "metre", "meter": "metre", "kg": "kg", "set": "set", "dozen": "dozen", "pair": "pair"}
REMOVED = "(price: ask the price list)"

# a rupee amount in the words of an owner or of a model: a marker before or after the number
_NUM = r"\d[\d,]*(?:\.\d+)?"
_BEFORE = re.compile(r"(?:₹|\brs\.?|\binr\b|రూ\.?|रु\.?|ರೂ\.?)\s*(" + _NUM + r")", re.IGNORECASE)
_AFTER = re.compile(r"(" + _NUM + r")\s*(?:₹|/-|\brupees?\b|\brs\b|రూపాయ\w*|రూ\b|रुपय\w*|रु\b|ರೂಪಾಯಿ\w*)", re.IGNORECASE)


def amounts_paise(text: str) -> list[int]:
    """Every rupee amount written in a text (a marker before or after the digits), as integer paise."""
    found: list[int] = []
    for pattern in (_BEFORE, _AFTER):
        for m in pattern.finditer(text):
            raw = m.group(1).replace(",", "")
            whole, _, frac = raw.partition(".")
            if whole:
                found.append(int(whole) * 100 + int((frac + "00")[:2] or "0"))
    return found


def strip_amounts(text: str) -> str:
    """The text without any rupee amount (the owner's typed prices are not a source of an amount for a call)."""
    return _AFTER.sub(REMOVED, _BEFORE.sub(REMOVED, text))


def tokens(text: str) -> int:
    """A cheap estimate of the model tokens of a text (measured on Haiku with count_tokens, 28 Nov 2026): English about 2.6 characters a token in running text, Telugu about 1.1. Slightly high on purpose."""
    ascii_chars = sum(1 for c in text if c.isascii())
    return round(ascii_chars / 2.4 + (len(text) - ascii_chars) / 1.05) + 1


def rupees(paise: int) -> str:
    whole, frac = divmod(int(paise), 100)
    return f"Rs {whole:,}" + (f".{frac:02d}" if frac else "")


@dataclass(frozen=True)
class FactPack:
    facts: tuple[dict[str, str], ...]     # {"kind": ..., "text": ...} for app.knowledge.prompt.facts_block
    allowed_paise: frozenset[int]         # the only amounts the assistant may say (the price-list rows in the pack)
    tokens: int                           # the estimated size of the pack

    @property
    def has_prices(self) -> bool:
        return bool(self.allowed_paise)


def _clock(minute: int) -> str:
    return f"{minute // 60}:{minute % 60:02d}"


def _hours(raw: Any, now: datetime) -> list[str]:
    if not isinstance(raw, dict) or not raw.get("days"):
        return []
    days = sorted({int(d) for d in raw["days"] if 1 <= int(d) <= 7})
    first, last, start, end = days[0], days[-1], int(raw.get("from_minute") or 0), int(raw.get("to_minute") or 0)
    span = f"{DAYS[first - 1]} to {DAYS[last - 1]}" if days == list(range(first, last + 1)) and len(days) > 2 else ", ".join(DAYS[d - 1] for d in days)
    local = now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    is_open = local.isoweekday() in days and start <= minute < end
    return [f"Business hours (India time): {span}, {_clock(start)} to {_clock(end)}. Right now it is {DAYS[local.isoweekday() - 1]} {_clock(minute)}, so the business is {'OPEN' if is_open else 'CLOSED'}; if it is closed, say the team will answer when it opens."]


def _take(lines: list[str], budget: int) -> list[str]:
    out: list[str] = []
    used = 0
    for line in lines:
        cost = tokens(line)
        if used + cost > budget:
            break
        out.append(line)
        used += cost
    return out


def build(raw: dict[str, Any] | None, *, now: datetime | None = None) -> FactPack:
    """The pack for one call. `raw` is the database function's answer (None or empty: no facts, nothing to say)."""
    raw = raw if isinstance(raw, dict) else {}
    now = now or datetime.now(IST)
    facts: list[dict[str, str]] = []
    allowed: set[int] = set()
    for text in _hours(raw.get("hours"), now):
        facts.append({"kind": "hours", "text": text})
    price_lines: list[tuple[str, int]] = []
    for row in raw.get("prices") or []:
        try:
            paise = int(row["paise"])
            name = " ".join(str(row["name"]).split())[:80]
            unit = UNITS.get(str(row.get("unit") or "piece"), str(row.get("unit") or "piece"))
            moq = int(row.get("moq") or 1)
            gst = int(row.get("tax_bps") or 0) / 100
        except (KeyError, TypeError, ValueError):
            continue
        line = f"{name}: {rupees(paise)} per {unit}" + (f", minimum order {moq}" if moq > 1 else "") + (f", plus {gst:g}% GST" if gst else "")
        price_lines.append((line, paise))
    used = 0
    for line, paise in price_lines:
        if used + tokens(line) > BUDGET["prices"]:
            break
        facts.append({"kind": "price", "text": line})
        allowed.add(paise)
        used += tokens(line)
    cat: list[str] = []
    for row in raw.get("catalogue") or []:
        try:
            name = " ".join(str(row["name"]).split())[:80]
        except (KeyError, TypeError):
            continue
        colours = ", ".join(str(c) for c in row.get("colours") or [])
        occasions = ", ".join(str(o) for o in row.get("occasions") or [])
        cat.append(f"{name}: {str(row.get('fabric') or '').replace('_', ' ')}" + (f", colours {colours}" if colours else "") + (f", for {occasions}" if occasions else "") + f", {STOCK.get(str(row.get('stock')), 'ask the team about stock')}. (no price in the catalogue)")
    facts += [{"kind": "catalogue", "text": t} for t in _take(cat, BUDGET["catalogue"])]
    faq = [f"Customers ask: {' '.join(strip_amounts(str(r.get('q') or '')).split())} Answer: {' '.join(strip_amounts(str(r.get('a') or '')).split())}" for r in raw.get("faqs") or [] if isinstance(r, dict) and r.get("q") and r.get("a")]
    facts += [{"kind": "faq", "text": t} for t in _take(faq, BUDGET["faq"])]
    used_tokens = sum(tokens(f["text"]) for f in facts)
    notes = strip_amounts(str(raw.get("notes") or "")).strip()
    if notes and used_tokens < MAX_TOKENS:
        left = MAX_TOKENS - used_tokens
        lines = [" ".join(line.split()) for line in notes.splitlines() if line.strip()]
        facts += [{"kind": "notes", "text": t} for t in _take(lines, left)]
    return FactPack(tuple(facts), frozenset(allowed), sum(tokens(f["text"]) for f in facts))
