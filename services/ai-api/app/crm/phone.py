"""The stored form of an Indian phone number (job BO). A shop is reached on WhatsApp by a phone number, so the number is kept in ONE form: `+91` and the ten digits, no spaces or hyphens
(`+919876543210`). Whatever the person typed (`98765 43210`, `098765-43210`, `+91 98765 43210`, `91-9876543210`, digits in Telugu or Devanagari) becomes that. A number that is not clearly an Indian
mobile (a landline with an STD code, a number of another country, the reserved synthetic `+00 ...` numbers of the demo) is kept exactly as typed, trimmed. The comparison form used to find a duplicate
is a different thing (`normalise_phone`, `app.phone_norm`); this one is only what is stored and shown."""

from __future__ import annotations

import unicodedata

from app.suppression.keys import normalise_phone

_MOBILE_FIRST = "6789"


def canonical_phone(raw: str) -> str:
    text = raw.strip()
    if normalise_phone(text) is None:
        return text
    digits = "".join(str(unicodedata.decimal(ch)) for ch in unicodedata.normalize("NFKC", text) if ch.isdecimal())
    international = unicodedata.normalize("NFKC", text).startswith("+") or digits.startswith("00")
    if digits.startswith("00"):
        digits = digits[2:]
    if international:
        if len(digits) == 12 and digits.startswith("91") and digits[2] in _MOBILE_FIRST:
            return "+" + digits
        return text
    if len(digits) == 10 and digits[0] in _MOBILE_FIRST:
        return "+91" + digits
    if len(digits) == 11 and digits[0] == "0" and digits[1] in _MOBILE_FIRST:
        return "+91" + digits[1:]
    if len(digits) == 12 and digits.startswith("91") and digits[2] in _MOBILE_FIRST:
        return "+" + digits
    return text
