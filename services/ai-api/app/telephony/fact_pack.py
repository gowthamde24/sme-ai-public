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
BUDGET = {"prices": 500, "catalogue": 350, "items": 250, "faq": 350}   # tokens per section; the notes get what is left
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
STOCK = {"in_stock": "in stock", "few_left": "only a few left", "made_to_order": "made to order"}
PERIODS = {"one_time": "", "per_month": " per month", "per_year": " per year", "per_hour": " per hour", "per_day": " per day", "per_unit": " per unit"}   # a from-price is never in the pack
STOCK = {"in_stock": "in stock", "few_left": "only a few left", "made_to_order": "made to order", "out_of_stock": "out of stock"}
UNITS = {"piece": "piece", "metre": "metre", "meter": "metre", "kg": "kg", "set": "set", "dozen": "dozen", "pair": "pair", "service": "service", "course": "course", "listing": "listing"}
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


def _hours(raw: Any, now: datetime, holidays: tuple[str, ...] = ()) -> list[str]:
    if not isinstance(raw, dict) or not raw.get("days"):
        return []
    days = sorted({int(d) for d in raw["days"] if 1 <= int(d) <= 7})
    first, last, start, end = days[0], days[-1], int(raw.get("from_minute") or 0), int(raw.get("to_minute") or 0)
    span = f"{DAYS[first - 1]} to {DAYS[last - 1]}" if days == list(range(first, last + 1)) and len(days) > 2 else ", ".join(DAYS[d - 1] for d in days)
    local = now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    today_closed = local.date().isoformat() in holidays
    is_open = local.isoweekday() in days and start <= minute < end and not today_closed
    return [f"Business hours (India time): {span}, {_clock(start)} to {_clock(end)}. Right now it is {DAYS[local.isoweekday() - 1]} {_clock(minute)}, so the business is {'OPEN' if is_open else 'CLOSED'}" + (" (today is a holiday)" if today_closed else "") + "; if it is closed, say the team will answer when it opens."]


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
    holidays = tuple(str(h)[:10] for h in (raw.get("holidays") or []) if isinstance(h, str))
    for text in _hours(raw.get("hours"), now, holidays):
        facts.append({"kind": "hours", "text": text})
    if holidays:
        facts.append({"kind": "hours", "text": "The business is closed on these dates (holidays): " + ", ".join(holidays[:12]) + "."})
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
        label = " ".join(str(row.get("label") or "").split())[:40]
        period = PERIODS.get(str(row.get("period") or ""))
        if label and period is not None:   # a price column of one of the owner's lists: the item AND the column's name travel with the amount, so two prices of one item can never be swapped
            line = f"{name}, {label}: {rupees(paise)}{period}" + (" (the usual price: say this one when the caller does not say which)" if row.get("default") is True else "")
        elif row.get("tier") is True:   # a price-list rate for a bigger order: "from 50" is the quantity at which this rate starts, not a minimum order
            line = f"{name}: {rupees(paise)} per {unit}" + (f" when you buy {moq} or more" if moq > 1 else "")
        else:
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
    item_lines: list[str] = []
    for row in raw.get("items") or []:   # an availability word and a short description of a list item: said as the list states them, nothing promised beyond
        try:
            name = " ".join(str(row["name"]).split())[:80]
        except (KeyError, TypeError):
            continue
        av = " ".join(strip_amounts(str(row.get("availability") or "")).split())[:60]
        desc = " ".join(strip_amounts(str(row.get("description") or "")).split())[:200]
        if av or desc:
            item_lines.append(f"{name}" + (f": {av}" if av else "") + (f". {desc}" if desc else ""))
    facts += [{"kind": "item", "text": t} for t in _take(item_lines, BUDGET["items"])]
    faq = [f"Customers ask: {' '.join(strip_amounts(str(r.get('q') or '')).split())} Answer: {' '.join(strip_amounts(str(r.get('a') or '')).split())}" for r in raw.get("faqs") or [] if isinstance(r, dict) and r.get("q") and r.get("a")]
    facts += [{"kind": "faq", "text": t} for t in _take(faq, BUDGET["faq"])]
    used_tokens = sum(tokens(f["text"]) for f in facts)
    notes = strip_amounts(str(raw.get("notes") or "")).strip()
    if notes and used_tokens < MAX_TOKENS:
        left = MAX_TOKENS - used_tokens
        lines = [" ".join(line.split()) for line in notes.splitlines() if line.strip()]
        facts += [{"kind": "notes", "text": t} for t in _take(lines, left)]
    return FactPack(tuple(facts), frozenset(allowed), sum(tokens(f["text"]) for f in facts))


# ---- an amount SAID IN WORDS (28 Nov 2026): the digits check cannot see "రెండు వేల ఐదు వందల రూపాయలు" or "two thousand rupees"; this reads Telugu and English number words next to a rupee word
_TE_UNITS = {"ఒకటి": 1, "ఒక": 1, "ఒక్క": 1, "రెండు": 2, "మూడు": 3, "నాలుగు": 4, "ఐదు": 5, "అయిదు": 5, "ఆరు": 6, "ఏడు": 7, "ఎనిమిది": 8, "తొమ్మిది": 9, "పది": 10, "పదకొండు": 11, "పన్నెండు": 12, "పదమూడు": 13, "పద్నాలుగు": 14, "పదిహేను": 15,
             "పదహారు": 16, "పదిహేడు": 17, "పద్దెనిమిది": 18, "పందొమ్మిది": 19, "ఇరవై": 20, "ముప్పై": 30, "నలభై": 40, "యాభై": 50, "యాబై": 50, "అరవై": 60, "డెబ్బై": 70, "ఎనభై": 80, "తొంభై": 90}
_TE_HUNDRED = ("వంద", "వందల", "వందలు")
_TE_THOUSAND = ("వెయ్యి", "వేలు", "వేల", "వెయ్యిల")
_TE_LAKH = ("లక్ష", "లక్షలు", "లక్షల")
_EN_UNITS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
             "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "a": 1}
_RUPEE_WORDS = re.compile(r"^(?:రూపాయలు|రూపాయల|రూపాయి|రూ|rupees?|rs|inr|₹|रुपये|रुपया|रु)\.?$", re.IGNORECASE)
_SPLIT = re.compile(r"[\s,;:!?()\[\]\"'\u200c\u200d]+")   # words are cut at spaces and punctuation (Telugu vowel signs are marks, not letters: never cut at them)
UNKNOWN = -1   # an amount in words that could not be worked out: never a listed amount, so it is blocked


def _value(tokens: list[str]) -> int | None:
    """The number said by number words (Telugu or English), or None when the tokens are not a number."""
    total = current = 0
    seen = False
    for token in tokens:
        t = token.casefold()
        if t in _TE_UNITS or t in _EN_UNITS:
            current += _TE_UNITS.get(t, _EN_UNITS.get(t, 0)) if t != "a" else 1
            seen = True
        elif t in _TE_HUNDRED or t == "hundred":
            current = max(current, 1) * 100
            seen = True
        elif t in _TE_THOUSAND or t == "thousand":
            total += max(current, 1) * 1000
            current = 0
            seen = True
        elif t in _TE_LAKH or t in ("lakh", "lakhs"):
            total += max(current, 1) * 100000
            current = 0
            seen = True
        elif t in ("and", "మరియు"):
            continue
        else:
            return None
    return total + current if seen else None


def _is_number_word(token: str) -> bool:
    t = token.casefold()
    return t in _TE_UNITS or t in _EN_UNITS or t in _TE_HUNDRED or t in _TE_THOUSAND or t in _TE_LAKH or t in ("hundred", "thousand", "lakh", "lakhs", "and")


def word_amounts_paise(text: str, *, price_context: bool = False) -> list[int]:
    """Every rupee amount said in number words. A run of number words counts when a rupee word is next to it, or when it holds a thousand or a lakh word (a sum of money in a sales call); a run whose value cannot be
    worked out is UNKNOWN (-1) and is blocked like any amount that is not on the price list. `price_context`: the caller's last turn asked about a price, so a bare hundreds run ("ఐదు వందలు") in the answer is an
    amount too (two hundred people is not a price; five hundred, answering "how much?", is)."""
    tokens = [t.strip(".") for t in _SPLIT.split(text.replace("₹", " ₹ ")) if t.strip(".")]
    found: list[int] = []
    i = 0
    while i < len(tokens):
        if not _is_number_word(tokens[i]) or tokens[i].casefold() in ("and", "a"):
            i += 1
            continue
        j = i
        while j < len(tokens) and _is_number_word(tokens[j]):
            j += 1
        run = [t for t in tokens[i:j]]
        before = tokens[i - 1] if i > 0 else ""
        after = tokens[j] if j < len(tokens) else ""
        big = any(t.casefold() in (*_TE_THOUSAND, *_TE_LAKH, "thousand", "lakh", "lakhs") for t in run) or (price_context and any(t.casefold() in (*_TE_HUNDRED, "hundred") for t in run))
        if _RUPEE_WORDS.match(after) or _RUPEE_WORDS.match(before) or big:
            value = _value(run)
            found.append(value * 100 if value else UNKNOWN)
        i = j
    return found


_PRICE_ASK = re.compile(r"ధర|రేటు|ఎంత|ఖరీదు|\bprice\b|\brate\b|\bcost\b|\bhow much\b|कीमत|दाम|कितना|ಬೆಲೆ|ಎಷ್ಟು", re.IGNORECASE)


def asks_price(text: str) -> bool:
    """Did the caller ask what something costs (ధర, ఎంత, price, rate, cost, how much ...)?"""
    return bool(_PRICE_ASK.search(text))


def all_amounts_paise(text: str, *, price_context: bool = False) -> list[int]:
    """Digits and words together: what the guard checks against the price list."""
    return amounts_paise(text) + word_amounts_paise(text, price_context=price_context)
