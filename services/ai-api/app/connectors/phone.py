"""Phone numbers as the connectors meet them: IndiaMART's "+91-98765 43210", Exotel's "09876543210". One plain form for the application (+91 and ten digits for an Indian mobile), or None when the text is not
a number worth keeping."""

from __future__ import annotations

import re

_NON_DIGIT = re.compile(r"[^0-9]")


def normalise(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    digits = _NON_DIGIT.sub("", text)
    if len(digits) == 10 and digits[0] in "6789":
        return f"+91{digits}"
    if len(digits) == 11 and digits[0] == "0" and digits[1] in "6789":
        return f"+91{digits[1:]}"
    if len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        return f"+{digits}"
    if text.startswith("+") and 10 <= len(digits) <= 15:
        return f"+{digits}"
    return None


def last4(raw: object) -> str:
    digits = _NON_DIGIT.sub("", raw) if isinstance(raw, str) else ""
    return digits[-4:] if len(digits) >= 4 else ""
