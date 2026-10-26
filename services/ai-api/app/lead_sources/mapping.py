"""Which column of a lead file is which (job DR / A2). Rules first: a header in English, Telugu, Hindi, Kannada, Tamil or Malayalam, or a messy one ("Mob. No.", "WA number"), is scored
against synonyms like app/integrations/mapping.py does for customer files; then the VALUES of a still-unplaced column are looked at by shape (ten digits = a phone, an @ = an e-mail). Only what the
rules cannot place goes to the model, and it sees the HEADER and a SHAPE ("10 digits", "e-mail", "short text"), never a value. The owner always confirms the mapping.
The wording of the Telugu, Hindi, Kannada, Tamil and Malayalam headers is a first draft that waits for a native reader."""

# ruff: noqa: E501

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Protocol

# field -> (label, synonyms). Every field is optional; a row needs a phone or an e-mail (validate_mapping).
FIELDS: dict[str, tuple[str, tuple[str, ...]]] = {
    "name": ("Name", (
        "name", "full name", "customer", "customer name", "lead name", "contact name", "contact person", "person", "client", "client name", "buyer", "buyer name", "sender name", "first name", "enquirer",
        "పేరు", "కస్టమర్ పేరు", "नाम", "ग्राहक का नाम", "ग्राहक नाम", "ಹೆಸರು", "ಗ್ರಾಹಕರ ಹೆಸರು", "பெயர்", "வாடிக்கையாளர் பெயர்", "പേര്", "ഉപഭോക്താവിന്റെ പേര്")),
    "phone": ("Phone or WhatsApp number", (
        "phone", "phone no", "phone number", "ph", "ph no", "mobile", "mobile no", "mobile number", "mob", "mob no", "mobile num", "cell", "cell no", "whatsapp", "whatsapp no", "whatsapp number", "wa number", "wa no",
        "contact", "contact no", "contact number", "telephone", "tel", "number", "sender mobile", "customer phone", "customer mobile",
        "ఫోన్", "ఫోన్ నంబర్", "మొబైల్", "మొబైల్ నంబర్", "వాట్సాప్", "फोन", "फ़ोन", "फोन नंबर", "मोबाइल", "मोबाइल नंबर", "मोबाइल नं", "व्हाट्सएप", "वाट्सऐप", "ಫೋನ್", "ಫೋನ್ ಸಂಖ್ಯೆ", "ಮೊಬೈಲ್", "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ", "ವಾಟ್ಸಾಪ್",
        "தொலைபேசி", "தொலைபேசி எண்", "கைபேசி", "மொபைல்", "மொபைல் எண்", "வாட்ஸ்அப்", "ഫോൺ", "ഫോൺ നമ്പർ", "മൊബൈൽ", "മൊബൈൽ നമ്പർ", "വാട്സ്ആപ്പ്")),
    "email": ("E-mail", (
        "email", "e mail", "email id", "email address", "mail", "mail id", "sender email",
        "ఈమెయిల్", "ఇమెయిల్", "ईमेल", "ई मेल", "ईमेल पता", "ಇಮೇಲ್", "மின்னஞ்சல்", "ഇമെയിൽ", "ഇ-മെയിൽ")),
    "city": ("City", (
        "city", "town", "location", "place", "area", "district", "locality", "sender city",
        "నగరం", "ఊరు", "ప్రాంతం", "शहर", "नगर", "जिला", "क्षेत्र", "ನಗರ", "ಊರು", "ಪ್ರದೇಶ", "நகரம்", "ஊர்", "பகுதி", "നഗരം", "സ്ഥലം")),
    "message": ("What they asked for", (
        "message", "requirement", "requirements", "enquiry", "inquiry", "query", "comments", "comment", "remarks", "remark", "notes", "note", "looking for", "interested in", "product", "description",
        "సందేశం", "అవసరం", "వివరాలు", "संदेश", "ज़रूरत", "आवश्यकता", "विवरण", "टिप्पणी", "ಸಂದೇಶ", "ಅಗತ್ಯ", "ವಿವರ", "செய்தி", "தேவை", "விவரம்", "സന്ദേശം", "ആവശ്യം", "വിവരങ്ങൾ")),
    "external_id": ("Lead id (from the portal)", ("lead id", "query id", "enquiry id", "inquiry id", "unique id", "unique query id", "ref", "ref no", "reference", "reference no", "id", "lead no", "lead number", "sr no")),
    "received_at": ("When they enquired", (
        "date", "time", "date time", "datetime", "enquiry date", "inquiry date", "lead date", "created", "created at", "created on", "received", "received at", "query time", "timestamp",
        "తేదీ", "तारीख", "दिनांक", "ದಿನಾಂಕ", "தேதி", "തീയതി")),
    "source_note": ("Campaign or note", ("source", "lead source", "campaign", "ad", "ad name", "form", "channel", "medium")),
}  # fmt: skip

_PUNCT = re.compile(r"[^\w\s]|_", re.UNICODE)
_PHONE_LIKE = re.compile(r"^\+?[0-9][0-9 ().-]{6,18}[0-9]$")
_EMAIL_LIKE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DATE_LIKE = re.compile(r"^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T]\d{1,2}:\d{2}(:\d{2})?)?$")


def normalise(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower().replace("‌", "").replace("‍", "")
    s = _PUNCT.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class Suggestion:
    index: int
    header: str
    field: str | None
    confidence: str  # exact | partial | weak | ai | none


def _score(header: str, synonyms: tuple[str, ...]) -> int:
    h = normalise(header)
    if not h:
        return 0
    best = 0
    words = set(h.split())
    for syn in synonyms:
        s = normalise(syn)
        if h == s:
            return 3
        if f" {s} " in f" {h} ":
            best = max(best, 2)
        elif len(s.split()) == 1 and s in words and len(s) > 3:
            best = max(best, 1)
    return best


def shape_of(value: str) -> str:
    """A description of a value that says nothing about its content: this is what the model may see."""
    v = value.strip()
    if not v:
        return "empty"
    if _EMAIL_LIKE.fullmatch(v):
        return "e-mail"
    if _PHONE_LIKE.fullmatch(v):
        digits = re.sub(r"[^0-9]", "", v)
        return "10 digits" if len(digits) == 10 else f"{len(digits)} digits"
    if _DATE_LIKE.fullmatch(v):
        return "date"
    if re.fullmatch(r"[0-9]+", v):
        return "whole number"
    return "short text" if len(v) <= 40 else "long text"


def column_shape(values: list[str]) -> str:
    """The most common shape among the non-empty values of a column (at most 200 looked at)."""
    shapes: dict[str, int] = {}
    for v in values[:200]:
        s = shape_of(v)
        if s != "empty":
            shapes[s] = shapes.get(s, 0) + 1
    if not shapes:
        return "empty"
    top = max(shapes.items(), key=lambda kv: (kv[1], kv[0]))
    return top[0] if top[1] * 2 >= sum(shapes.values()) else "mixed"


def suggest(headers: list[str], columns: list[list[str]]) -> list[Suggestion]:
    """Rules only. `columns[i]` holds the values of column i (for the shape guess)."""
    order = {f: i for i, f in enumerate(FIELDS)}
    scored: list[tuple[int, int, int, str]] = []
    for ci, header in enumerate(headers):
        for f, (_label, syn) in FIELDS.items():
            s = _score(header, syn)
            if s:
                scored.append((-s, ci, order[f], f))
    scored.sort()
    used: set[int] = set()
    chosen: dict[str, tuple[int, int]] = {}
    for neg, ci, _o, f in scored:
        if ci in used or f in chosen:
            continue
        chosen[f] = (ci, -neg)
        used.add(ci)
    # a column nobody named, whose values are plainly phone numbers or e-mail addresses
    for ci in range(len(headers)):
        if ci in used or ci >= len(columns):
            continue
        shape = column_shape(columns[ci])
        guess = "email" if shape == "e-mail" else "phone" if shape == "10 digits" else None
        if guess and guess not in chosen:
            chosen[guess] = (ci, 1)
            used.add(ci)
    by_col = {ci: (f, s) for f, (ci, s) in chosen.items()}
    out: list[Suggestion] = []
    for ci, header in enumerate(headers):
        if ci in by_col:
            f, s = by_col[ci]
            out.append(Suggestion(ci, header[:60], f, {3: "exact", 2: "partial", 1: "weak"}[s]))
        else:
            out.append(Suggestion(ci, header[:60], None, "none"))
    return out


def mapping_from(suggestions: list[Suggestion]) -> dict[str, int]:
    return {s.field: s.index for s in suggestions if s.field}


def validate_mapping(mapping: object, width: int) -> dict[str, int]:
    """A mapping from the client: {field: column index}. Known fields, indexes inside the file, no column used twice, a phone or an e-mail among them."""
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError("mapping_invalid")
    out: dict[str, int] = {}
    for f, idx in mapping.items():
        if f not in FIELDS or isinstance(idx, bool) or not isinstance(idx, int) or not 0 <= idx < width:
            raise ValueError("mapping_invalid")
        out[f] = idx
    if len(set(out.values())) != len(out):
        raise ValueError("mapping_invalid")
    if "phone" not in out and "email" not in out:
        raise ValueError("mapping_required_missing")
    return out


@dataclass(frozen=True)
class ColumnInfo:
    index: int
    header: str   # the owner's header text: UNTRUSTED
    shape: str    # from column_shape: no value in it


class ColumnMatcher(Protocol):
    def match(self, token: str, tenant_id: object, columns: list[ColumnInfo], free_fields: list[str]) -> dict[int, str]:
        """For each column the model could place, the field it is. Columns it cannot place are left out. The caller checks the answer."""
        ...


class FakeColumnMatcher:
    """Tests and development: header (normalised) -> field."""

    def __init__(self, answers: dict[str, str] | None = None) -> None:
        self.answers = {normalise(k): v for k, v in (answers or {}).items()}
        self.seen: list[list[ColumnInfo]] = []

    def match(self, token: str, tenant_id: object, columns: list[ColumnInfo], free_fields: list[str]) -> dict[int, str]:
        self.seen.append(list(columns))
        return {c.index: self.answers[normalise(c.header)] for c in columns if normalise(c.header) in self.answers}


def apply_ai(suggestions: list[Suggestion], answer: dict[int, str], free_fields: list[str]) -> list[Suggestion]:
    """Merge the model's answer: only into columns the rules left alone, only a known field nobody else holds, each field once."""
    free = set(free_fields)
    out = list(suggestions)
    for ci, f in sorted(answer.items()):
        if not 0 <= ci < len(out) or out[ci].field is not None or f not in free or f not in FIELDS:
            continue
        out[ci] = Suggestion(ci, out[ci].header, f, "ai")
        free.discard(f)
    return out
