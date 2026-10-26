"""Lead rows out of a file's grid, a pasted list or a vCard (job DR / A2). Everything here is untrusted text: nothing is evaluated, every value is cut to a sane length, a formula cell is
blank. A row is a plain dict {name, phone, email, city, message, external_id, received_at, line}; the phone is NOT checked here (the service checks it, the database checks it again)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from app.integrations.sheet import Grid

MAX_ROWS = 5_000
IST = timezone(timedelta(hours=5, minutes=30))
LIMITS = {"name": 200, "phone": 32, "email": 254, "city": 100, "message": 1000, "external_id": 100, "source_note": 100}
_EMAIL = re.compile(r"[^\s@,;|<>()]+@[^\s@,;|<>()]+\.[^\s@,;|<>()]+")
_PHONE = re.compile(r"\+?[0-9०-९౦-౯೦-೯௦-௯൦-൯][0-9०-९౦-౯೦-೯௦-௯൦-൯ ().-]{5,20}[0-9०-९౦-౯೦-೯௦-௯൦-൯]")
_BULLET = re.compile(r"^\s*(?:[-*•]|\(?\d{1,4}[.)])\s+")
_TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%d-%m-%Y", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%d.%m.%Y")


def _cut(value: str, limit: int) -> str:
    return re.sub(r"\s+", " ", "".join(ch if ch.isprintable() or ch in "\t\n" else " " for ch in value)).strip()[:limit]


def parse_time(raw: str) -> str | None:
    """A time as written in a lead file (assumed India time) to an ISO instant, or None."""
    text = raw.strip()
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IST).astimezone(UTC).isoformat()
        except ValueError:
            continue
    return None


def rows_from_grid(grid: Grid, mapping: dict[str, int]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i, cells in enumerate(grid.rows[:MAX_ROWS]):
        row: dict[str, Any] = {"line": grid.lines[i]}
        for field, ci in mapping.items():
            if (i, ci) in grid.formulas:
                continue   # a formula is never read as a value
            raw = cells[ci] if ci < len(cells) else ""
            if field == "received_at":
                when = parse_time(raw) if raw.strip() else None
                if when:
                    row["received_at"] = when
            elif raw.strip():
                row[field] = _cut(raw, LIMITS.get(field, 200))
        rows.append(row)
    return rows


def parse_paste(text: str) -> list[dict[str, Any]]:
    """One lead per line: `name, phone`, `phone`, `name<TAB>phone<TAB>email`, `1. Ravi - 98765 43210`. A line with neither a number nor an address is kept as a row without a way to reach them (it will be reported)."""
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        line = _BULLET.sub("", line).strip()
        if not line:
            continue
        if len(rows) >= MAX_ROWS:
            break
        email_m = _EMAIL.search(line)
        email = email_m.group(0) if email_m else None
        rest = line.replace(email, " ") if email else line
        phone_m = max(_PHONE.finditer(rest), key=lambda m: len(re.sub(r"\D", "", m.group(0))), default=None)
        phone = phone_m.group(0).strip() if phone_m else None
        if phone_m:
            rest = rest.replace(phone_m.group(0), "\t", 1)
        parts = [p.strip(" -:") for p in re.split(r"[\t,;|]+", rest) if p.strip(" -:")]
        row: dict[str, Any] = {"line": lineno}
        if parts:
            row["name"] = _cut(parts[0], LIMITS["name"])
        if len(parts) > 1:
            row["city"] = _cut(parts[1], LIMITS["city"])
        if phone:
            row["phone"] = _cut(phone, LIMITS["phone"])
        if email:
            row["email"] = _cut(email, LIMITS["email"])
        rows.append(row)
    return rows


def decode_text(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def parse_vcard(text: str) -> list[dict[str, Any]]:
    """Many cards in one .vcf. A card's FN (else N), its first TEL that looks like a number (else the first TEL), its first EMAIL, the city of its ADR, its NOTE."""
    unfolded = re.sub(r"\r?\n[ \t]", "", text)
    cards = re.findall(r"BEGIN:VCARD(.*?)END:VCARD", unfolded, flags=re.S | re.I)
    rows: list[dict[str, Any]] = []
    for ci, card in enumerate(cards[:MAX_ROWS], start=1):
        name = email = city = note = None
        tels: list[str] = []
        for raw in card.splitlines():
            if ":" not in raw:
                continue
            key, _, value = raw.partition(":")
            prop = key.split(";", 1)[0].split(".")[-1].upper()
            value = value.strip()
            if not value:
                continue
            if prop == "FN" and not name:
                name = value
            elif prop == "N" and not name:
                family, _, given = value.partition(";")
                name = " ".join(p for p in (given.split(";")[0], family) if p).strip() or None
            elif prop == "TEL":
                tels.append(value)
            elif prop == "EMAIL" and not email:
                email = value
            elif prop == "ADR" and not city:
                bits = value.split(";")
                city = bits[3].strip() if len(bits) > 3 and bits[3].strip() else None
            elif prop == "NOTE" and not note:
                note = value.replace("\\n", " ").replace("\\,", ",")
        row: dict[str, Any] = {"line": ci}
        if name:
            row["name"] = _cut(name, LIMITS["name"])
        phone = next((t for t in tels if _PHONE.fullmatch(t.strip())), tels[0] if tels else None)
        if phone:
            row["phone"] = _cut(phone, LIMITS["phone"])
        if email:
            row["email"] = _cut(email, LIMITS["email"])
        if city:
            row["city"] = _cut(city, LIMITS["city"])
        if note:
            row["message"] = _cut(note, LIMITS["message"])
        rows.append(row)
    return rows


def header_sha(header: list[str]) -> str:
    """The identity of a sheet's columns: a changed header row stops a kept-in-sync sheet instead of guessing."""
    import hashlib

    from app.lead_sources.mapping import normalise

    return hashlib.sha256("|".join(normalise(h) for h in header).encode("utf-8")).hexdigest()
