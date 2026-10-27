"""A phone number from a file or a form, in the stored form, and whether it can be called (job DR / A2). The same rule as app.lead_e164 in the database: `+91` and ten digits for an Indian mobile
(it starts with 6, 7, 8 or 9), `+` and 8 to 15 digits for another country, the reserved synthetic `+00 ...` numbers of demo data as typed. A landline or a short number is not callable."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.crm.phone import canonical_phone
from app.suppression.keys import normalise_phone

_INDIAN = re.compile(r"^\+91[6-9][0-9]{9}$")
_SYNTHETIC = re.compile(r"^\+\s*00[0-9 ()-]{5,22}$")


@dataclass(frozen=True)
class PhoneCheck:
    given: bool          # the cell had something in it
    stored: str | None   # the stored form, None when the number cannot be called
    key: str | None      # the comparison form (app.phone_norm), for de-duplication inside a file


def check_phone(raw: object) -> PhoneCheck:
    text = raw.strip() if isinstance(raw, str) else ""
    if not text:
        return PhoneCheck(False, None, None)
    if normalise_phone(text) is None:
        return PhoneCheck(True, None, None)
    canonical = canonical_phone(text)
    key = normalise_phone(canonical)
    if _INDIAN.fullmatch(canonical):
        return PhoneCheck(True, canonical, key)
    if _SYNTHETIC.fullmatch(canonical):
        return PhoneCheck(True, canonical, key)
    if canonical.startswith("+") and not re.match(r"^\+\s*91", canonical):
        digits = re.sub(r"[^0-9]", "", canonical)
        if 8 <= len(digits) <= 15 and not digits.startswith("0"):
            return PhoneCheck(True, "+" + digits, key)
    return PhoneCheck(True, None, None)
