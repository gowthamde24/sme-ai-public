"""Turn the table of a file into rows of a list (28 Nov 2026, lists slice 3). All CODE, no model: each heading of the file is matched to a column of the list (a remembered mapping first, then the column's own label, then a few plain
words for each role), each cell is converted to what its column holds, and what cannot be converted is left EMPTY with a note (never guessed). Nothing is saved here: the owner checks the proposal and sends the rows to the commit.

Notes (closed): name_missing (row), cell_unreadable (row, column), too_many (more than 1,000 rows: the first 1,000), unreadable (no usable table)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.jobs.sell_read import paise_of

MAX_ROWS = 1000
NAME_WORDS = ("name", "item", "item name", "product", "product name", "title", "description of goods", "particulars", "design", "article", "saree", "service", "course")
ROLE_WORDS: dict[str, tuple[str, ...]] = {
    "price": ("price", "rate", "mrp", "amount", "cost", "fee", "fees", "charge", "rs", "selling price", "wholesale price", "retail price"),
    "availability": ("stock", "availability", "available", "status", "in stock"),
    "quantity": ("qty", "quantity", "count", "pieces", "pcs", "units", "stock count"),
    "description": ("description", "details", "about", "notes", "remarks"),
    "how_to_buy": ("link", "url", "buy", "buy link", "booking link"),
}
_YES = {"yes", "y", "true", "1", "haan", "avunu", "ok"}
_NO = {"no", "n", "false", "0", "nahi", "kadu"}


@dataclass
class Proposal:
    mapping: dict[str, str | None] = field(default_factory=dict)   # heading -> column key, "name" or None (left out)
    rows: list[dict[str, Any]] = field(default_factory=list)
    notes: list[dict[str, Any]] = field(default_factory=list)
    unclear: bool = False


def _norm(heading: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (heading or "").lower()).strip()


def _words(text: str) -> list[str]:
    return [w for w in _norm(text).split() if w]


def auto_mapping(columns: list[dict[str, Any]], headings: list[str]) -> dict[str, str | None]:
    """Heading -> column key, "name", or None."""
    out: dict[str, str | None] = {h: None for h in headings if h.strip()}
    taken: set[str] = set()
    norm = {h: _norm(h) for h in out}
    name_h = next((h for h in out if norm[h] in NAME_WORDS), None)
    if name_h is None:
        name_h = next(iter(out), None)
    if name_h is not None:
        out[name_h] = "name"
    by_label = {_norm(c["label"]): c for c in columns}
    for h in out:   # 1. the column's own label
        if out[h] is None and norm[h] in by_label and by_label[norm[h]]["key"] not in taken:
            key = str(by_label[norm[h]]["key"])
            out[h] = key
            taken.add(key)
    price_cols = [c for c in columns if c.get("role") == "price"]
    for h in out:   # 2. a price heading: a price column whose label shares a word with it, else the default price column
        if out[h] is not None or norm[h] not in ROLE_WORDS["price"] and not any(w in ROLE_WORDS["price"] for w in _words(h)):
            continue
        shared = [c for c in price_cols if c["key"] not in taken and set(_words(c["label"])) & (set(_words(h)) - {"price", "rate", "mrp", "amount", "cost", "fee", "fees", "rs"})]
        pick = shared[0] if len(shared) == 1 else next((c for c in price_cols if c.get("quote_default") and c["key"] not in taken), None) if len(shared) == 0 else None
        if pick is not None:
            out[h] = pick["key"]
            taken.add(pick["key"])
    for role in ("availability", "quantity", "description", "how_to_buy"):   # 3. the other roles by plain words
        col = next((c for c in columns if c.get("role") == role and c["key"] not in taken), None)
        if col is None:
            continue
        found = next((x for x in out if out[x] is None and norm[x] in ROLE_WORDS[role]), None)
        if found is not None:
            out[found] = col["key"]
            taken.add(col["key"])
    return out


def _convert(column: dict[str, Any], raw: str) -> tuple[Any, bool]:
    """(value, ok). An empty cell is (None, True): nothing to say. ok False: it could not be read as what the column holds."""
    text = (raw or "").strip()
    if not text:
        return None, True
    kind = column["type"]
    if kind == "text":
        return (text[:200], True) if len(text) <= 200 else (None, False)
    if kind == "rupees":
        paise = paise_of(text)
        return (paise, True) if paise is not None else (None, False)
    if kind == "number":
        try:
            n = Decimal(text.replace(",", ""))
        except InvalidOperation:
            return None, False
        if abs(n) > 1_000_000_000:
            return None, False
        return (int(n) if n == n.to_integral_value() else float(n)), True
    if kind == "yes_no":
        low = text.lower()
        return (True, True) if low in _YES else (False, True) if low in _NO else (None, False)
    if kind == "choice":
        for word in column.get("choices") or []:
            if word.lower() == text.lower():
                return word, True
        return None, False
    if kind == "link":
        return (text, True) if re.fullmatch(r"https://\S{3,255}", text) else (None, False)
    if kind in ("date", "datetime"):
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?", text) or re.fullmatch(r"(\d{2})[/.-](\d{2})[/.-](\d{4})(?:[ T](\d{2}):(\d{2}))?", text)
        if not m:
            return None, False
        a, b, c, hh, mm = m.groups()
        y, mo, d = (int(a), int(b), int(c)) if len(a) == 4 else (int(c), int(b), int(a))
        try:
            day = date(y, mo, d)
        except ValueError:
            return None, False
        if kind == "date":
            return day.isoformat(), True
        return f"{day.isoformat()}T{hh or '00'}:{mm or '00'}:00+05:30", True
    if kind == "duration":
        low = text.lower()
        m1 = re.fullmatch(r"(\d{1,6})\s*(?:min|mins|minutes|m)?", low)
        m2 = re.fullmatch(r"(\d{1,3}(?:\.\d)?)\s*(?:h|hr|hrs|hour|hours)", low)
        m3 = re.fullmatch(r"(\d{1,3}):(\d{2})", low)
        minutes = int(m1.group(1)) if m1 else round(float(m2.group(1)) * 60) if m2 else int(m3.group(1)) * 60 + int(m3.group(2)) if m3 else None
        return (minutes, True) if minutes is not None and 1 <= minutes <= 525600 else (None, False)
    return None, False   # photo: not imported from a file


def propose(list_json: dict[str, Any], table: list[list[str]], *, mapping: dict[str, str | None] | None = None, saved: list[dict[str, Any]] | None = None) -> Proposal:
    out = Proposal()
    if len(table) < 2:
        out.unclear = True
        out.notes.append({"code": "unreadable"})
        return out
    headings = [(h or "").strip() for h in table[0]]
    columns = [c for c in list_json.get("columns", []) if isinstance(c, dict)]
    keys = {c["key"] for c in columns}
    chosen = mapping
    if chosen is None:   # a remembered mapping whose headings are (nearly) all in this file
        for s in saved or []:
            m = s.get("mapping") if isinstance(s, dict) else None
            if isinstance(m, dict) and m and sum(1 for h in m if h in headings) * 2 >= len(m):
                chosen = {h: (m.get(h) if h in m else None) for h in headings if h}
                break
    if chosen is None:
        chosen = auto_mapping(columns, headings)
    chosen = {h: (v if v == "name" or v in keys else None) for h, v in chosen.items()}
    out.mapping = chosen
    name_at = next((i for i, h in enumerate(headings) if chosen.get(h) == "name"), None)
    if name_at is None:
        out.unclear = True
        out.notes.append({"code": "unreadable"})
        return out
    by_key = {c["key"]: c for c in columns}
    body = [r for r in table[1:] if any((c or "").strip() for c in r)]
    if len(body) > MAX_ROWS:
        out.notes.append({"code": "too_many"})
    for n, r in enumerate(body[:MAX_ROWS], start=1):
        name = " ".join((r[name_at] if name_at < len(r) else "").split())[:120]
        if not name:
            out.notes.append({"code": "name_missing", "row": n})
            continue
        cells: dict[str, Any] = {}
        for i, h in enumerate(headings):
            key = chosen.get(h)
            if not key or key == "name":
                continue
            value, ok = _convert(by_key[key], r[i] if i < len(r) else "")
            if not ok:
                out.notes.append({"code": "cell_unreadable", "row": n, "column": key})
            elif value is not None:
                cells[key] = value
        out.rows.append({"name": name, "cells": cells})
    if not out.rows:
        out.unclear = True
        out.notes.append({"code": "unreadable"})
    return out
