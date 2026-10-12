"""What may be put in a web query (job BP, ADR 0078). A query leaves the building: it goes to a search provider. It must never carry a customer's phone number or e-mail address, a link, or text that is not
a plain question. (A customer's NAME is refused by the database, which knows the contacts: public.web_query_check.)"""

from __future__ import annotations

import re
import unicodedata

MIN_LEN, MAX_LEN = 3, 200
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+")
_LONG_DIGITS = re.compile(r"\d{7,}")
_PHONE_SHAPE = re.compile(r"\+?\d{2,4}[\s().-]{1,2}\d{3,5}[\s().-]{1,2}\d{3,5}")
_URLISH = re.compile(r"(?:https?|ftp|file)\s*:|//|www\.", re.IGNORECASE)


def clean_query(query: str) -> str:
    """NFKC, control and zero-width characters out, white space collapsed."""
    text = unicodedata.normalize("NFKC", query)
    text = "".join(ch for ch in text if ch.isprintable() or ch in " \t")
    return " ".join(text.split())


def query_problem(query: str) -> str | None:
    """None when the query may go; else a closed word: too_short, too_long, email, phone, link."""
    text = clean_query(query)
    if len(text) < MIN_LEN:
        return "too_short"
    if len(text) > MAX_LEN:
        return "too_long"
    if _EMAIL.search(text):
        return "email"
    digits_only = re.sub(r"[\s().+-]", "", text)
    if _LONG_DIGITS.search(text) or _PHONE_SHAPE.search(text) or (digits_only.isdigit() and len(digits_only) >= 6):
        return "phone"
    if _URLISH.search(text):
        return "link"
    return None
