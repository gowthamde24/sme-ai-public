"""A price list in a file -> the catalogue's prices, shown old -> new before anything changes (job assistant-does-the-work A2b part 2; owner, 5 Nov 2026: "update catalogue prices (preview old ->
new)"; "amounts/prices always shown before writing; never invent values not in the file").

Everything here is CODE: the price table is found by its header (an item column and a price column), each price is parsed from the cell as written, and each row is matched to a catalogue item by its
name (the same words, ignoring case, spaces and punctuation; no guessing: a row whose name is not in the catalogue is counted and left out). One step per changed item: `catalogue.put_item` with the
item as it is and the new exact price; its undo is the catalogue's own snapshot (the item read before, put back). A price change is MONEY: the plan is the Owner's, needs the second factor (the route
asks for it) and the card's second tap. The model never writes a price."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.assistant_work.understand import _ITEM_HEAD, _PRICE_HEAD, Understanding

MAX_CHANGES = 20          # a plan has at most 20 steps
MIN_PAISE, MAX_PAISE = 100, 100_000_000
_NUMBER = re.compile(r"^\s*(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\s*(?:/-)?\s*$", re.IGNORECASE)
_PUT_FIELDS = ("name", "fabric", "colours", "zari", "border", "occasions", "price_band", "stock_status", "active")


@dataclass(frozen=True)
class Row:
    name: str
    paise: int


@dataclass(frozen=True)
class Change:
    item: dict[str, Any]
    old: int | None
    new: int


def paise_of(cell: str) -> int | None:
    """'12,000', 'Rs. 6500', '₹4,800.50', '1200/-' -> paise; anything else (a range, words, '12k') -> None."""
    m = _NUMBER.match(cell or "")
    if not m:
        return None
    value = int(m.group(1).replace(",", "")) * 100 + int((m.group(2) or "0").ljust(2, "0"))
    return value if MIN_PAISE <= value <= MAX_PAISE else None


def norm(name: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", (name or "").casefold()).split())


def price_rows(u: Understanding) -> list[Row]:
    """The rows of the file's price table: (the item's name as written, its price). The first table with an item column and a price column."""
    for table in u.tables:
        if len(table) < 2:
            continue
        header = table[0]
        price_col = next((i for i, h in enumerate(header) if _PRICE_HEAD.search(h or "")), None)
        item_col = next((i for i, h in enumerate(header) if _ITEM_HEAD.search(h or "") and i != price_col), None)
        if price_col is None:
            continue
        if item_col is None:   # no word for it: the first column that is mostly words
            item_col = next((i for i in range(len(header)) if i != price_col and sum(1 for r in table[1:] if i < len(r) and sum(ch.isalpha() for ch in r[i]) >= 3) * 2 >= len(table) - 1), None)
        if item_col is None:
            continue
        rows = []
        for r in table[1:]:
            if max(item_col, price_col) >= len(r):
                continue
            paise = paise_of(r[price_col])
            if paise is not None and r[item_col].strip():
                rows.append(Row(r[item_col].strip()[:200], paise))
        if rows:
            return rows
    return []


def match(rows: list[Row], items: list[dict[str, Any]]) -> tuple[list[Change], int, int]:
    """(the changes, how many rows already have that price, how many rows are not in the catalogue). An item named twice in the file: the first row counts."""
    by_name: dict[str, dict[str, Any]] = {}
    for item in items:
        by_name.setdefault(norm(str(item.get("name") or "")), item)
    changes: list[Change] = []
    unchanged = missing = 0
    seen: set[str] = set()
    for row in rows:
        key = norm(row.name)
        if key in seen:
            continue
        seen.add(key)
        found = by_name.get(key)
        if found is None:
            missing += 1
        elif found.get("price_paise") == row.paise:
            unchanged += 1
        else:
            changes.append(Change(found, found.get("price_paise"), row.paise))
    return changes, unchanged, missing


def put_body(item: dict[str, Any], paise: int) -> dict[str, Any]:
    body = {k: item.get(k) for k in _PUT_FIELDS if k in item}
    body["occasions"] = list(body.get("occasions") or [])
    body["price_paise"] = paise
    return body


def rupees(paise: int | None) -> str:
    """₹12,000 or ₹4,800.50 (Indian grouping), or a dash for no exact price."""
    if paise is None:
        return "—"
    whole, frac = divmod(paise, 100)
    digits = str(whole)
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    text = ",".join([*groups, tail]) if groups else tail
    return f"₹{text}" + (f".{frac:02d}" if frac else "")
