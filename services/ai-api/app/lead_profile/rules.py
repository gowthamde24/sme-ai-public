"""The first guess of a lead's profile (job EE, contract-context-sources.md B3), made by RULES and never by a model: what they want, how much, where, the budget, the timeline, how urgent, the language, and whether the lead is
junk. It reads only the words the person wrote (the arrival text, a phone number or an address already removed) and the two facts "has a phone" / "has an e-mail". Every field it fills carries a confidence ("medium" for a
pattern that matched, "low" for a guess); nothing here is "high": only the owner makes a field high. A model may improve the empty or low fields later (service.py); the owner's fixed fields are never touched.

Pure text rules for English, Telugu, Hindi and Kannada (the product's languages), with Tamil and Malayalam read by script. Every regular expression is BOUNDED (no nested or open-ended repeats), so no input can make one slow."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass, field

FIELDS = ("need", "quantity", "area", "city", "budget", "timeline", "urgency", "language")
MAX = {"need": 200, "quantity": 100, "area": 100, "city": 100, "budget": 100, "timeline": 100, "campaign": 120}

_SCRIPTS = (("te", 0x0C00, 0x0C7F), ("kn", 0x0C80, 0x0CFF), ("hi", 0x0900, 0x097F), ("ta", 0x0B80, 0x0BFF), ("ml", 0x0D00, 0x0D7F))

_UNITS = (
    r"sq\.?\s{0,2}ft|sqft|sq\.?\s{0,2}feet|square\s{1,2}feet|sq\.?\s{0,2}yards?|sq\.?\s{0,2}m|pieces?|pcs|nos|units?|blocks?|bricks?|bags?|tons?|tonnes?|kgs?|quintals?|meters?|metres?|mtrs?|"
    r"sarees?|sets?|loads?|trips?|acres?|cents|gajam|plots?|flats?|bhk|seats?|boxes|packets?|litres?|liters?"
)
_QUANTITY = re.compile(rf"(?<![\w.,])(\d{{1,3}}(?:,\d{{2,3}}){{0,3}}|\d{{1,7}})(?:\.\d{{1,2}})?\s{{0,2}}(?:[A-Za-z]{{2,12}}\s{{1,2}}){{0,1}}(?:{_UNITS})\b", re.IGNORECASE)
_BUDGET = re.compile(
    r"(?:(?:₹|rs\.?|inr|rupees)\s{0,2}\d[\d,]{0,12}(?:\.\d{1,2})?(?:\s{0,2}(?:lakhs?|lacs?|crores?|cr|k|thousand|l))?|\b\d{1,3}(?:\.\d{1,2})?\s{0,2}(?:lakhs?|lacs?|crores?)\b)",
    re.IGNORECASE,
)
_DAYS = r"monday|tuesday|wednesday|thursday|friday|saturday|sunday"
_TIMELINE = re.compile(
    rf"\b(?:today|tonight|tomorrow|this\s{{1,2}}(?:week|weekend|month)|next\s{{1,2}}(?:week|month|year)|asap|immediately|right\s{{1,2}}now|urgent(?:ly)?|"
    rf"(?:within|in|after)\s{{1,2}}\d{{1,3}}\s{{1,2}}(?:days?|weeks?|months?|hours?)|by\s{{1,2}}(?:{_DAYS}|\d{{1,2}}(?:st|nd|rd|th)?\s{{1,2}}[A-Za-z]{{3,9}}|end\s{{1,2}}of\s{{1,2}}(?:the\s{{1,2}})?(?:week|month|year)))\b",
    re.IGNORECASE,
)
_URGENT = re.compile(r"\b(?:urgent(?:ly)?|asap|immediately|right\s{1,2}now|today|tonight|emergency|at\s{1,2}once)\b|వెంటనే|అర్జెంట్|ఇవాళ|ఈ రోజు|तुरंत|जल्दी|आज ही|आज|ತುರ್ತು|ಈಗಲೇ|ಇಂದೇ", re.IGNORECASE)
_RELAXED = re.compile(r"\b(?:just\s{1,2}(?:checking|enquiring|inquiring|asking|looking)|no\s{1,2}hurry|not\s{1,2}urgent|later|few\s{1,2}months|next\s{1,2}(?:month|year)|someday|in\s{1,2}future)\b", re.IGNORECASE)
_CITIES = (
    "Eluru Vijayawada Guntur Hyderabad Secunderabad Visakhapatnam Vizag Rajahmundry Kakinada Nellore Tirupati Kurnool Anantapur Dharmavaram Warangal Karimnagar Nizamabad Khammam Bengaluru Bangalore Mysuru Mysore "
    "Hubballi Mangaluru Chennai Coimbatore Madurai Kochi Thiruvananthapuram Mumbai Pune Delhi Kolkata Ahmedabad Surat Jaipur Lucknow Nagpur Indore Bhopal Patna Chandigarh Gurugram Noida"
).split()
_CITY_RE = re.compile(r"\b(" + "|".join(_CITIES) + r")\b", re.IGNORECASE)
_AREA = re.compile(r"\b(?:in|at|near|around|from)\s{1,2}([A-Z][A-Za-z]{2,20}(?:\s{1,2}[A-Z][A-Za-z]{2,20}){0,2})\b")
_LABELLED = re.compile(r"\b(?:requirement|requirements|looking\s{1,2}for|enquiry|inquiry|need|interested\s{1,2}in|product|query|message)\s{0,2}[:\-]\s{0,2}([^\n.;]{3,200})", re.IGNORECASE)
_GREETING = re.compile(r"^(?:hi|hello|hey|dear\s{1,2}sir|dear\s{1,2}sir/madam|good\s{1,2}(?:morning|afternoon|evening)|namaste|namaskaram)\b[\s,!.]{0,4}", re.IGNORECASE)
_URL = re.compile(r"(?:https?://|www\.)[^\s]{3,200}", re.IGNORECASE)
_TEST = re.compile(r"^\s{0,3}(?:test|testing|asdf|qwerty|demo|dummy|sample)\b|\btest\s{1,2}(?:lead|enquiry|inquiry|message)\b", re.IGNORECASE)
_SPAM = re.compile(r"\b(?:casino|lottery|bitcoin|crypto|forex|viagra|backlinks?|seo\s{1,2}services?|loan\s{1,2}offer|win\s{1,2}cash|click\s{1,2}here|earn\s{1,2}money|work\s{1,2}from\s{1,2}home|guest\s{1,2}post)\b", re.IGNORECASE)
_ABUSE = re.compile(r"\b(?:fuck\w{0,4}|shit|bastard|idiot|stupid|bitch)\b", re.IGNORECASE)
_CONTACT_EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}")
_CONTACT_PHONE = re.compile(r"(?<![\w])(?:\+?91[\s-]{0,2})?[6-9]\d{4}[\s-]{0,2}\d{5}(?!\d)")
_CONTROL = re.compile("[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​  ‪-‮⁠-⁤⁦-⁩﻿]")


@dataclass
class Guess:
    fields: dict[str, str] = field(default_factory=dict)
    confidence: dict[str, str] = field(default_factory=dict)
    junk: str | None = None

    def put(self, name: str, value: str | None, confidence: str) -> None:
        clean = clean_value(value, MAX.get(name, 100)) if value is not None else None
        if clean is not None:
            self.fields[name] = clean
            self.confidence[name] = confidence


def has_link(value: str) -> bool:
    return _URL.search(value) is not None


def clean_value(value: str, limit: int) -> str | None:
    """One line, no control characters, cut to the column's limit; None when empty or when it holds a phone number or an e-mail address (a profile never repeats those)."""
    text = " ".join(_CONTROL.sub("", value).split())[:limit].strip(" ,;:-")
    if len(text) < 1 or _CONTACT_EMAIL.search(text) or _CONTACT_PHONE.search(text):
        return None
    return text


def language_of(text: str) -> tuple[str, str] | None:
    """(code, confidence): by script (Telugu, Kannada, Hindi, Tamil, Malayalam) when at least three letters of it are present, else English by Latin letters."""
    counts = {code: 0 for code, _, _ in _SCRIPTS}
    latin = 0
    for ch in text[:2000]:
        o = ord(ch)
        for code, lo, hi in _SCRIPTS:
            if lo <= o <= hi:
                counts[code] += 1
                break
        else:
            if ch.isascii() and ch.isalpha():
                latin += 1
    best = max(counts, key=lambda c: counts[c])
    if counts[best] >= 3 and counts[best] * 2 >= latin:
        return best, "medium"
    if latin >= 6:
        return "en", "medium" if counts[best] == 0 else "low"
    return None


def need_of(text: str) -> str | None:
    """What they want, in their words: the labelled part ("Requirement: ..."), else the first sentence without its greeting."""
    labelled = _LABELLED.search(text)
    if labelled:
        return labelled.group(1)
    body = _GREETING.sub("", " ".join(text.split()), count=1)
    first = re.split(r"(?<=[.!?])\s{1,3}", body, maxsplit=1)[0]
    return first if len(first) >= 4 else None


def guess(text: str | None, *, source: str | None = None, has_phone: bool = True, has_email: bool = False) -> Guess:
    """The profile the rules can make from what the person wrote; empty fields stay absent."""
    g = Guess()
    words = " ".join((text or "").split())[:2000]
    if not has_phone and not has_email:
        g.junk = "no_contact"
    if words:
        if _TEST.search(words):
            g.junk = "test"
        elif len(_URL.findall(words)) >= 2 or _SPAM.search(words):
            g.junk = "spam"
        elif _ABUSE.search(words):
            g.junk = "abuse"
        need = need_of(words)
        if need:
            g.put("need", need, "low")
        q = _QUANTITY.search(words)
        if q:
            g.put("quantity", q.group(0), "medium")
        b = _BUDGET.search(words)
        if b:
            g.put("budget", b.group(0), "medium")
        t = _TIMELINE.search(words)
        if t:
            g.put("timeline", t.group(0), "medium")
        city = _CITY_RE.search(words)
        if city:
            g.put("city", city.group(1).title(), "medium")
        area = next((m.group(1) for m in _AREA.finditer(words) if not (city and m.group(1).lower() == city.group(1).lower()) and not _CITY_RE.fullmatch(m.group(1))), None)
        if area:
            g.put("area", area, "low")
        if _URGENT.search(words):
            g.put("urgency", "high", "medium" if t else "low")
        elif _RELAXED.search(words):
            g.put("urgency", "low", "low")
        elif t:
            g.put("urgency", "normal", "low")
        lang = language_of(words)
        if lang:
            g.put("language", lang[0], lang[1])
    return g
