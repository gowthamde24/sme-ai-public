"""Custom fields in the spreadsheet import (job CK, ADR 0084 part 2): a customers file may map a column to `custom:<code>` for any ACTIVE contact field. Deterministic; no model; a cell value is never
echoed (an issue is a line number, a closed code and the field's code).

Closed issue codes: `bad_number`, `bad_date`, `bad_yes_no`, `not_a_choice` (an unknown choice is an issue, NEVER a new choice), `too_long` (a text over 100 characters), `contains_contact` (a text field of class
`none` must not hold a phone number or an e-mail address), `required_missing` (a required field with an empty cell). The database checks every value again when it is written (SM711)."""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.integrations.mapping import normalise
from app.requirements.scrub import has_contact

PREFIX = "custom:"
ISSUE_CODES = ("bad_number", "bad_date", "bad_yes_no", "not_a_choice", "too_long", "contains_contact", "required_missing")
_YES = frozenset(normalise(w) for w in ("yes", "y", "true", "1", "haan", "హా", "అవును", "हाँ", "हां", "ಹೌದು"))
_NO = frozenset(normalise(w) for w in ("no", "n", "false", "0", "లేదు", "नहीं", "ಇಲ್ಲ"))
_THOUSANDS = re.compile(r"^-?\d{1,3}(,\d{2,3})+(\.\d+)?$")
_PLAIN = re.compile(r"^-?\d+(\.\d+)?$")
_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y")


def target(code: str) -> str:
    return PREFIX + code


def code_of(field: str) -> str | None:
    return field[len(PREFIX) :] if field.startswith(PREFIX) else None


def active_contact_defs(defs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {d["code"]: d for d in defs if d.get("entity") == "contact" and d.get("active")}


def import_fields(defs: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """What `inspect` lists next to the built-in fields: one target per active contact field."""
    return [{"field": target(c), "label": str(d["label"].get("en") or c), "required": bool(d["required"]), "kind": d["kind"]} for c, d in defs.items()]


def suggest(headers: list[str], defs: dict[str, dict[str, Any]], taken: set[int]) -> dict[str, int]:
    """A column whose header IS a field's label (any language) or code is suggested for that field. Each column and each field at most once."""
    out: dict[str, int] = {}
    used = set(taken)
    for code, d in defs.items():
        wanted = {normalise(code.replace("_", " "))} | {normalise(str(v)) for v in d["label"].values()}
        for ci, header in enumerate(headers):
            if ci not in used and normalise(header) in wanted:
                out[target(code)] = ci
                used.add(ci)
                break
    return out


def _choice_code(d: dict[str, Any], cell: str) -> str | None:
    wanted = normalise(cell)
    for c in d.get("choices") or []:
        if wanted == normalise(c["code"].replace("_", " ")) or wanted == normalise(c["code"]) or wanted in {normalise(str(v)) for v in c["label"].values()}:
            return str(c["code"])
    return None


def parse_cell(d: dict[str, Any], cell: str) -> tuple[Any, str | None]:
    """(value, None) or (None, issue code). An empty cell is no value and no issue (the caller checks `required`)."""
    text = cell.strip()
    if not text:
        return None, None
    kind = d["kind"]
    if kind == "text":
        if len(text) > 100:
            return None, "too_long"
        if d["pii_class"] == "none" and has_contact(text):
            return None, "contains_contact"
        return text, None
    if kind == "number":
        if _THOUSANDS.match(text):
            text = text.replace(",", "")
        if not _PLAIN.match(text):
            return None, "bad_number"
        try:
            number = Decimal(text)
        except InvalidOperation:
            return None, "bad_number"
        if abs(number) >= Decimal(10) ** 12:
            return None, "bad_number"
        return (int(number) if number == number.to_integral_value() else float(number)), None
    if kind == "date":
        for fmt in _DATE_FORMATS:
            try:
                parsed = datetime.strptime(text, fmt)  # noqa: DTZ007 - a calendar date, no time zone
            except ValueError:
                continue
            if 1900 <= parsed.year <= 2200:
                return parsed.date().isoformat(), None
        return None, "bad_date"
    if kind == "yes_no":
        word = normalise(text)
        if word in _YES:
            return True, None
        if word in _NO:
            return False, None
        return None, "bad_yes_no"
    if kind == "choice":
        code = _choice_code(d, text)
        return (code, None) if code else (None, "not_a_choice")
    # multi_choice: several choices separated by ; | or ,
    parts = [p.strip() for p in re.split(r"[;|,]", text) if p.strip()]
    codes: list[str] = []
    for part in parts:
        code = _choice_code(d, part)
        if code is None:
            return None, "not_a_choice"
        if code not in codes:
            codes.append(code)
    return (codes, None) if codes else (None, None)
