"""GSTIN, the GST registration number (job CA, ADR 0081). Pure and offline: it says a number is WELL FORMED, never that the business exists or is active (only the GST portal's taxpayer search says
that; there is no public API for it, see ADR 0078).

The 15 characters: a state code (01 to 38, 97 or 99), the holder's PAN (five letters, four digits, one letter), an entity number for the PAN's registrations in that state (1 to 9, then A to Z), the
letter Z, and a check character: Luhn mod 36 over the first 14 (from the right, every second character is doubled, each product's digits in base 36 are added, and the check character brings the total
to a multiple of 36). Checked against three published example numbers (27AAPFU0939F1ZV, 29AAGCB7383J1Z4, 24AAACC1206D1ZM). The database holds the same rule (app.gstin_is_valid) and a test proves the two
agree. The state names are the GST portal's state codes."""

from __future__ import annotations

import re

_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_SHAPE = re.compile(r"^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

STATE_NAMES: dict[str, str] = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
    "28": "Andhra Pradesh (before 2014)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
    "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
}  # fmt: skip


def normalise(raw: object) -> str | None:
    """The text with spaces and dashes removed and capitals, or None when it is not text or is empty. Not a validity check."""
    if not isinstance(raw, str):
        return None
    text = re.sub(r"[\s-]", "", raw).upper()
    return text or None


def check_character(first14: str) -> str:
    """The 15th character for the first 14 (which must be alphanumeric capitals)."""
    total, factor = 0, 2
    for ch in reversed(first14):
        product = _ALPHABET.index(ch) * factor
        total += product // 36 + product % 36
        factor = 3 - factor
    return _ALPHABET[(36 - total % 36) % 36]


def is_valid(gstin: object) -> bool:
    return isinstance(gstin, str) and _SHAPE.fullmatch(gstin) is not None and check_character(gstin[:14]) == gstin[14]


def parse(raw: object) -> str | None:
    """A valid GSTIN in its plain form from what a person typed, or None when it is not one."""
    text = normalise(raw)
    return text if text is not None and is_valid(text) else None


def state_of(gstin: str) -> str:
    """The state or territory named by a valid GSTIN's first two digits."""
    return STATE_NAMES[gstin[:2]]
