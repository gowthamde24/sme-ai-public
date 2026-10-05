"""Deterministic normalisers: the model points at WORDS, this code turns them into typed values.

`normalise(key, raw, received_at)` takes the value as the enquiry words it ("2 dozen", "Rs 5k each", "next Friday",
"Kanchipuram", "net 30") and returns a typed `Value` with a certainty FLOOR, or raises `Refused`. The model never computes a
number, a date or a price (CLAUDE.md non-negotiable 4); the budget is only what the customer stated, never a price of ours.

Rules worth knowing (each is tested):
  * quantity: digits with Indian or western commas, number words (English and a few Latin-script Hindi words), "dozen",
    "half dozen", "set(s)"; a range keeps its lower bound and is `ambiguous`; "about / around / ~" is `implied`.
    1..10,000 per line (the quote engine's MAX_QUANTITY_PER_LINE); anything else is refused.
  * money: INR, "5k", "50,000", "1.5 lakh", "2 crore"; per piece versus total by marker words; no marker = `ambiguous`
    (stored as a total, a human decides). Stored in paise. A per-piece amount <= INR 1,000,000, a total <= INR 10,000,000.
  * dates: resolved from `received_at` IN ASIA/KOLKATA (an enquiry received at 23:30 UTC on the 4th is the 5th in India).
    Absolute dates are `stated`; a missing year, and every relative phrase ("tomorrow", "next Friday", "by month end",
    "in 2 weeks"), are `implied`; a date before the received day is `ambiguous`. Festival and season words are never
    resolved: refused.
  * delivery city: letters, spaces and . ' - only, at most 60 characters.
  * payment terms: cash on delivery, "N% advance", "full advance", "net N" / "N days credit" (0..180 days).
"""

from __future__ import annotations

import calendar
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from app.requirements import vocabulary as V

IST = ZoneInfo("Asia/Kolkata")
_ORDER = {"stated": 0, "implied": 1, "ambiguous": 2}


class Refused(Exception):  # noqa: N818 - a refusal, not an error
    """The value cannot be turned into a typed value. `reason` is a short fixed code."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Value:
    code: str | None = None
    int_value: int | None = None
    date_value: date | None = None
    text: str | None = None
    basis: str | None = None


@dataclass(frozen=True)
class Normalised:
    value: Value
    certainty: str  # the floor: the final certainty is the worse of this and the proposer's


def worse(a: str, b: str) -> str:
    return a if _ORDER[a] >= _ORDER[b] else b


# ------------------------------------------------------------------------------------------------- numbers
_ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
    # Latin-script Hindi (a few; enough for the common order sizes)
    "ek": 1, "char": 4, "paanch": 5, "panch": 5, "chhe": 6, "cheh": 6, "saat": 7, "aath": 8,
    "nau": 9, "gyarah": 11, "barah": 12, "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18,
    "unnis": 19, "bees": 20, "pachees": 25, "tees": 30, "chalis": 40, "pachas": 50, "saath": 60, "sattar": 70,
    "assi": 80, "nabbe": 90,
}  # fmt: skip
# English words as well ("do you have", "teen", "das"): a number only when a multiplier follows ("do sau" = 200)
_HINDI_AMBIGUOUS = {"do": 2, "teen": 3, "das": 10}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}  # fmt: skip
_HUNDRED = {"hundred", "sau"}
_THOUSAND = {"thousand", "hazaar", "hazar"}
_LAKH = {"lakh", "lakhs", "lac", "lacs"}
_CRORE = {"crore", "crores"}
_DOZEN = {"dozen", "doz", "dozens", "darjan"}
_FILLER = {"and", "a", "an", "of"}
_MULTIPLIERS = _HUNDRED | _THOUSAND | _LAKH | _CRORE | _DOZEN
_WORD = re.compile(r"[a-z]+|\d[\d,]*(?:\.\d+)?|[^\sa-z\d]", re.IGNORECASE)

_DIGITS = re.compile(
    r"(?<![A-Za-z0-9.,])"
    r"(?P<n>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?!\d)"
    r"(?:\s*(?P<s>k|thousand|lakhs?|lacs?|crores?|cr|dozens?|doz)\b"
    r"|(?![A-Za-z])|(?=(?:pcs?|pieces?|sarees?|saris?|nos)\b))",
    re.IGNORECASE,
)
_RANGE = re.compile(
    r"(?<![A-Za-z0-9.,])(?P<a>\d[\d,]*(?:\.\d+)?)\s*(?:-|–|to)\s*(?P<b>\d[\d,]*(?:\.\d+)?)"
    r"(?:\s*(?P<s>k|thousand|lakhs?|lacs?|crores?|cr|dozens?|doz)\b)?",
    re.IGNORECASE,
)
_MULT = {"k": 1000, "thousand": 1000, "cr": 10**7, "doz": 12}


def _multiplier(suffix: str) -> int:
    s = suffix.casefold()
    if s in _MULT:
        return _MULT[s]
    if s.startswith("lakh") or s.startswith("lac"):
        return 100_000
    if s.startswith("crore"):
        return 10**7
    if s.startswith("doz"):
        return 12
    raise ValueError(suffix)


def _to_decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None


def _word_numbers(text: str) -> list[tuple[int, Decimal]]:
    """(position of the first word, value) for each run of number words ("twenty five", "two hundred", "a dozen")."""
    found: list[tuple[int, Decimal]] = []
    items = [(m.start(), m.group(0).casefold()) for m in _WORD.finditer(text)]
    i = 0
    while i < len(items):
        pos, tok = items[i]
        known = (
            tok in _ONES
            or tok in _TENS
            or tok in _HUNDRED
            or tok in _THOUSAND
            or tok in _LAKH
            or tok in _CRORE
        )
        known = known or tok in _DOZEN
        nxt = items[i + 1][1] if i + 1 < len(items) else ""
        known = known or (tok in _HINDI_AMBIGUOUS and nxt in _MULTIPLIERS)
        lead_filler = tok in {"a", "an"} and nxt in _MULTIPLIERS
        half = tok == "half" and i + 1 < len(items) and items[i + 1][1] in _DOZEN
        if not (known or lead_filler or half):
            i += 1
            continue
        total, current, seen, j = Decimal(0), Decimal(0), False, i
        if half:
            found.append((pos, Decimal(6)))
            i += 2
            continue
        while j < len(items):
            t = items[j][1]
            if t in _ONES:
                current += _ONES[t]
                seen = True
            elif t in _TENS:
                current += _TENS[t]
                seen = True
            elif t in _HINDI_AMBIGUOUS and j + 1 < len(items) and items[j + 1][1] in _MULTIPLIERS:
                current += _HINDI_AMBIGUOUS[t]
                seen = True
            elif t in _HUNDRED:
                current = (current or Decimal(1)) * 100
                seen = True
            elif t in _THOUSAND:
                total += (current or Decimal(1)) * 1000
                current, seen = Decimal(0), True
            elif t in _LAKH:
                total += (current or Decimal(1)) * 100_000
                current, seen = Decimal(0), True
            elif t in _CRORE:
                total += (current or Decimal(1)) * 10**7
                current, seen = Decimal(0), True
            elif t in _DOZEN:
                total, current, seen = Decimal(0), (total + (current or Decimal(1))) * 12, True
            elif t in _FILLER and j + 1 < len(items) and (
                items[j + 1][1] in _ONES or items[j + 1][1] in _TENS or items[j + 1][1] in _HUNDRED
                or items[j + 1][1] in _THOUSAND or items[j + 1][1] in _LAKH or items[j + 1][1] in _DOZEN
            ):  # fmt: skip
                pass
            else:
                break
            j += 1
        if seen:
            found.append((pos, total + current))
        i = max(j, i + 1)
    return found


def numbers_in(text: str) -> set[Decimal]:
    """Every number the text states, as written and with its multiplier ("5k" -> 5 and 5000; "2 dozen" -> 2 and 24)."""
    out: set[Decimal] = set()
    for m in _RANGE.finditer(text):
        for part in (m.group("a"), m.group("b")):
            d = _to_decimal(part)
            if d is not None:
                out.add(d)
                if m.group("s"):
                    out.add(d * _multiplier(m.group("s")))
    for m in _DIGITS.finditer(text):
        d = _to_decimal(m.group("n"))
        if d is None:
            continue
        out.add(d)
        if m.group("s"):
            out.add(d * _multiplier(m.group("s")))
    for _, value in _word_numbers(text):
        out.add(value)
    return out


def _first_number(raw: str) -> tuple[Decimal, str | None] | None:
    """The first number in the text: (value with its multiplier, the multiplier word or None)."""
    best: tuple[int, Decimal, str | None] | None = None
    for m in _DIGITS.finditer(raw):
        d = _to_decimal(m.group("n"))
        if d is None:
            continue
        suffix = m.group("s")
        cand = (m.start(), d * _multiplier(suffix) if suffix else d, suffix)
        if best is None or cand[0] < best[0]:
            best = cand
        break
    for pos, value in _word_numbers(raw):
        if best is None or pos < best[0]:
            best = (pos, value, None)
        break
    return None if best is None else (best[1], best[2])


# ------------------------------------------------------------------------------------------------- quantity
_APPROX = re.compile(
    r"\b(?:about|around|approx(?:imately)?|nearly|roughly|almost|close to|upto|up to)\b|~",
    re.IGNORECASE,
)
_SET = re.compile(r"\bsets?\b", re.IGNORECASE)


def normalise_quantity(raw: str) -> Normalised:
    certainty = "stated"
    if _APPROX.search(raw):
        certainty = "implied"
    rng = _RANGE.search(raw)
    if rng is not None:
        a = _to_decimal(rng.group("a"))
        if a is not None and rng.group("s"):
            a *= _multiplier(rng.group("s"))
        number = a
        certainty = "ambiguous"
    else:
        first = _first_number(raw)
        number = None if first is None else first[0]
    if number is None:
        raise Refused("unparsed")
    if number != number.to_integral_value():
        raise Refused("unparsed")
    n = int(number)
    if n < 1:
        raise Refused("under_floor")
    if n > V.MAX_QUANTITY:
        raise Refused("over_cap")
    basis = "set" if _SET.search(raw) else "piece"
    return Normalised(Value(int_value=n, basis=basis), certainty)


# ------------------------------------------------------------------------------------------------- money
_PER_PIECE = re.compile(
    r"\b(?:per|each|a|every|/)\s*(?:piece|pieces|pc|pcs|saree|sarees|sari|saris|unit|item)\b"
    r"|\beach\b|\bapiece\b|\bpp\b|/\s*(?:pc|pcs|piece|saree)\b",
    re.IGNORECASE,
)
_TOTAL = re.compile(
    r"\btotal\b|\boverall\b|\bin all\b|\bwhole order\b|\bentire order\b|\bfor the (?:lot|order)\b|\bal+ together\b|\baltogether\b",
    re.IGNORECASE,
)


def normalise_budget(raw: str) -> Normalised:
    rng = _RANGE.search(raw)
    certainty = "stated"
    if rng is not None:
        a = _to_decimal(rng.group("a"))
        if a is None:
            raise Refused("unparsed")
        if rng.group("s"):
            a *= _multiplier(rng.group("s"))
        amount = a
        certainty = "ambiguous"
    else:
        first = _first_number(raw)
        if first is None:
            raise Refused("unparsed")
        amount = first[0]
    if _APPROX.search(raw):
        certainty = worse(certainty, "implied")
    per, total = bool(_PER_PIECE.search(raw)), bool(_TOTAL.search(raw))
    if per and not total:
        basis, cap = "per_piece", V.MAX_UNIT_BUDGET_PAISE
    elif total and not per:
        basis, cap = "total", V.MAX_TOTAL_BUDGET_PAISE
    else:
        basis, cap, certainty = "total", V.MAX_TOTAL_BUDGET_PAISE, "ambiguous"
    paise = amount * 100
    if paise != paise.to_integral_value():
        raise Refused("unparsed")
    if paise < 1:
        raise Refused("under_floor")
    if paise > cap:
        raise Refused("over_cap")
    return Normalised(Value(int_value=int(paise), basis=basis), certainty)


# ------------------------------------------------------------------------------------------------- dates
_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5, "jun": 6,
    "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}  # fmt: skip
_WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2, "thursday": 3, "thu": 3,
    "thur": 3, "thurs": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}  # fmt: skip
_MONTH_RE = "|".join(sorted(_MONTHS, key=len, reverse=True))
_WEEKDAY_RE = "|".join(sorted(_WEEKDAYS, key=len, reverse=True))
_FESTIVALS = re.compile(
    r"\b(?:diwali|deepavali|dussehra|dasara|dasera|navratri|pongal|sankranti|ugadi|gudi padwa|onam|eid|ramzan|ramadan|"
    r"christmas|holi|rakhi|raksha bandhan|akshaya tritiya|wedding season|marriage season|festive season|festival|"
    r"muhurat|shaadi season|puja|pooja|varalakshmi|karva chauth|durga puja|ganesh chaturthi|vinayaka)\b",
    re.IGNORECASE,
)
_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_NUMERIC = re.compile(r"(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/])")
_DAY_MONTH = re.compile(
    rf"(?<![\d])(\d{{1,2}})(?:st|nd|rd|th)?\s*(?:of\s+)?({_MONTH_RE})\b\.?(?:,?\s*(\d{{4}}))?",
    re.IGNORECASE,
)
_MONTH_DAY = re.compile(
    rf"\b({_MONTH_RE})\b\.?\s*(\d{{1,2}})(?:st|nd|rd|th)?(?!\d)(?:,?\s*(\d{{4}}))?", re.IGNORECASE
)
_IN_N = re.compile(r"\b(?:in|within|after)\s+(\d{1,3})\s*(day|days|week|weeks)\b", re.IGNORECASE)
_MONTH_END = re.compile(
    r"\b(?:by\s+)?(?:the\s+)?(?:end of (?:this |the )?month|month[- ]?end)\b", re.IGNORECASE
)
_NEXT_MONTH_END = re.compile(r"\bend of next month\b", re.IGNORECASE)
_WEEKDAY = re.compile(rf"\b(?:next |this |coming |on )?({_WEEKDAY_RE})\b", re.IGNORECASE)


def received_day(received_at: datetime) -> date:
    """The calendar day an enquiry was received, in India."""
    if received_at.tzinfo is None:
        raise ValueError("received_at must carry a time zone")
    return received_at.astimezone(IST).date()


def _make(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _in_range(d: date) -> date:
    if not date(2020, 1, 1) <= d <= date(2100, 1, 1):
        raise Refused("over_cap")
    return d


def date_candidates(text: str, today: date) -> list[tuple[date, str]]:
    """Every date the text expresses, with its certainty floor, in order of appearance. Festivals are not dates."""
    found: list[tuple[int, date, str]] = []

    def add(pos: int, d: date | None, certainty: str) -> None:
        if d is not None:
            found.append((pos, d, certainty))

    taken: list[tuple[int, int]] = []

    def free(m: re.Match[str]) -> bool:
        return not any(s <= m.start() < e or s < m.end() <= e for s, e in taken)

    def take(m: re.Match[str]) -> None:
        taken.append((m.start(), m.end()))

    for m in _ISO.finditer(text):
        add(m.start(), _make(int(m[1]), int(m[2]), int(m[3])), "stated")
        take(m)
    for m in _NUMERIC.finditer(text):
        if not free(m):
            continue
        year = int(m[3])
        year = year + 2000 if year < 100 else year
        add(
            m.start(), _make(year, int(m[2]), int(m[1])), "stated"
        )  # day first, as written in India
        take(m)
    for rx, day_i, mon_i in ((_DAY_MONTH, 1, 2), (_MONTH_DAY, 2, 1)):
        for m in rx.finditer(text):
            if not free(m):
                continue
            month = _MONTHS[m[mon_i].casefold()]
            day = int(m[day_i])
            if m[3]:
                add(m.start(), _make(int(m[3]), month, day), "stated")
            else:
                d = _make(today.year, month, day)
                if d is not None and d < today:
                    d = _make(today.year + 1, month, day)
                add(m.start(), d, "implied")  # the year is inferred
            take(m)
    for m in _IN_N.finditer(text):
        n = int(m[1]) * (7 if m[2].casefold().startswith("week") else 1)
        add(m.start(), today + timedelta(days=n), "implied")
        take(m)
    for m in _NEXT_MONTH_END.finditer(text):
        y, mo = (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)
        add(m.start(), date(y, mo, calendar.monthrange(y, mo)[1]), "implied")
        take(m)
    for m in _MONTH_END.finditer(text):
        if free(m):
            add(
                m.start(),
                date(today.year, today.month, calendar.monthrange(today.year, today.month)[1]),
                "implied",
            )
            take(m)
    for m in re.finditer(r"\b(day after tomorrow|tomorrow|today|next week)\b", text, re.IGNORECASE):
        word = m[1].casefold()
        delta = {"today": 0, "tomorrow": 1, "day after tomorrow": 2, "next week": 7}[word]
        add(m.start(), today + timedelta(days=delta), "implied")
    for m in _WEEKDAY.finditer(text):
        if not free(m):
            continue
        target = _WEEKDAYS[m[1].casefold()]
        ahead = (
            target - today.weekday()
        ) % 7 or 7  # the first such weekday strictly after the received day
        add(m.start(), today + timedelta(days=ahead), "implied")
    found.sort(key=lambda x: x[0])
    return [(d, c) for _, d, c in found]


def normalise_deadline(raw: str, received_at: datetime) -> Normalised:
    if _FESTIVALS.search(raw):
        raise Refused("festival")
    today = received_day(received_at)
    candidates = date_candidates(raw, today)
    if not candidates:
        raise Refused("unparsed")
    d, certainty = candidates[0]
    _in_range(d)
    if d < today:
        certainty = "ambiguous"
    return Normalised(Value(date_value=d), certainty)


# ------------------------------------------------------------------------------------------------- city, vocabulary, payment
def _city_chars_ok(city: str) -> bool:
    """Letters (any script) and the marks that spell them, plus space . ' - ; never a digit, a symbol or a line break."""
    if not unicodedata.category(city[0]).startswith("L"):
        return False
    return all(unicodedata.category(c)[0] in "LM" or c in " .'-" for c in city)


def normalise_city(raw: str) -> Normalised:
    if any(c in raw for c in "\r\n\t"):
        raise Refused("not_a_city")
    city = " ".join(raw.split()).strip(" .,;:-")
    if not city or len(city) > V.MAX_CITY_CHARS or not _city_chars_ok(city):
        raise Refused("not_a_city")
    return Normalised(Value(text=city), "stated")


def normalise_code(key: str, raw: str) -> Normalised:
    code = V.code_for(key, raw)
    if code is not None:
        return Normalised(Value(code=code), "stated")
    if not V.tokens(raw):
        raise Refused("unparsed")
    # not on the list: 'other', a human decides
    return Normalised(Value(code="other"), "implied")


_COD = re.compile(r"\bcod\b|cash on delivery|pay(?:ment)? on delivery", re.IGNORECASE)
_PERCENT = re.compile(r"(\d{1,3})(?:\.\d+)?\s*(?:%|per ?cent|percent)", re.IGNORECASE)
_ADVANCE = re.compile(
    r"\badvance\b|\bupfront\b|\bprepaid\b|\bdeposit\b|\bfull payment\b", re.IGNORECASE
)
_NET_N = re.compile(r"\bnet\s*(\d{1,4})\b|(\d{1,4})\s*(?:days?|din)\b", re.IGNORECASE)


def normalise_payment(raw: str) -> Normalised:
    if _COD.search(raw):
        return Normalised(Value(code="cash_on_delivery"), "stated")
    pct = _PERCENT.search(raw)
    if pct is not None and (_ADVANCE.search(raw) or "%" in raw or "percent" in raw.casefold()):
        n = int(pct.group(1))
        if n == 100:
            return Normalised(Value(code="advance_full"), "stated")
        if n < 1 or n > 100:
            raise Refused("over_cap" if n > 100 else "under_floor")
        return Normalised(Value(code="advance_partial", int_value=n * 100, basis="bps"), "stated")
    net = _NET_N.search(raw)
    if net is not None and not _ADVANCE.search(raw):
        days = int(net.group(1) or net.group(2))
        if days > V.MAX_NET_DAYS:
            raise Refused("over_cap")
        return Normalised(Value(code="net_days", int_value=days, basis="days"), "stated")
    if _ADVANCE.search(raw):
        # "advance" alone: most likely all of it, but a human must say
        certainty = (
            "stated"
            if re.search(r"\bfull\b|\bcomplete\b|\b100\b", raw, re.IGNORECASE)
            else "implied"
        )
        return Normalised(Value(code="advance_full"), certainty)
    raise Refused("unparsed")


# ------------------------------------------------------------------------------------------------- entry point
def normalise(key: str, raw: str, received_at: datetime) -> Normalised:
    text = raw.strip()
    if not text or len(text) > 120:
        raise Refused("unparsed")
    if key == "quantity":
        return normalise_quantity(text)
    if key == "budget":
        return normalise_budget(text)
    if key == "deadline":
        return normalise_deadline(text, received_at)
    if key == "delivery_city":
        return normalise_city(text)
    if key == "payment_terms":
        return normalise_payment(text)
    if key in ("saree_type", "fabric", "colour"):
        return normalise_code(key, text)
    raise Refused("unknown_field")
