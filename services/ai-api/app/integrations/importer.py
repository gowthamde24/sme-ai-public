"""Turn a mapped grid into import rows, with a per-row verdict and a CLOSED reason code for every refusal (an issue is a line number, a code and a field name; it never echoes a cell).

CUSTOMERS become the rows `POST /leads/import` already takes, so the existing rules apply unchanged: duplicates are found by the same match keys and SKIPPED (an existing customer is never changed by an
import), a contact needs an e-mail address, the real-data gate decides what a workspace may hold. A row that has contact details but no e-mail keeps its company and its lead; the contact details are left
out and the row says so (`contact_needs_email`), so nothing is lost silently.

STOCK rows change the stock status of catalogue items found BY NAME (same match key as the leads: case, spaces and joiners ignored). Nothing is created or deleted. The status comes from a status
column (English, Telugu, Hindi words) or from a quantity column (3 or more: in stock; 1 or 2: few left; 0: made to order, the closest status the catalogue has to "none on the shelf")."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.integrations.mapping import normalise
from app.integrations.sheet import MAX_CELL, Grid
from app.leads.csv_rows import _formula_like
from app.leads.keys import match_key
from app.text_rules import has_hidden_characters

ISSUE_CODES = (
    "formula_cell", "formula_like", "hidden_characters", "cell_too_long", "company_name_missing", "item_name_missing", "duplicate_in_file", "quantity_invalid", "status_unknown", "no_status_or_quantity",
)  # fmt: skip
_NUMBER = re.compile(r"^-?[0-9]+([.,][0-9]+)?$")  # a plain number (even a negative one) is a number to a spreadsheet, not a formula
OUT_OF_STOCK = frozenset(normalise(w) for w in ("out of stock", "sold out", "no stock", "nil", "none", "స్టాక్ లేదు", "అయిపోయింది", "खत्म", "स्टॉक नहीं"))
FEW_LEFT_MAX = 2  # a quantity of 1 or 2 is "few left"; 3 or more "in stock"; 0 "made to order"


@dataclass(frozen=True)
class Issue:
    line: int
    code: str
    field: str | None = None


@dataclass
class Prepared:
    rows: list[dict[str, Any]] = field(default_factory=list)  # import rows (customers) or {"name", "stock_status"} (stock), only the usable ones
    lines: list[int] = field(default_factory=list)  # the file line of each usable row
    notes: list[str | None] = field(default_factory=list)  # a closed note per usable row, or None
    issues: list[Issue] = field(default_factory=list)
    blank: int = 0


def _check_cell(grid: Grid, ri: int, ci: int, name: str, line: int) -> tuple[str, Issue | None]:
    cell = grid.rows[ri][ci]
    if (ri, ci) in grid.formulas:
        return "", Issue(line, "formula_cell", name)
    if len(cell) >= MAX_CELL:
        return "", Issue(line, "cell_too_long", name)
    if has_hidden_characters(cell):
        return "", Issue(line, "hidden_characters", name)
    if cell and not _NUMBER.fullmatch(cell) and _formula_like(cell):
        return "", Issue(line, "formula_like", name)
    return cell, None


def prepare_customers(grid: Grid, mapping: dict[str, int]) -> Prepared:
    out = Prepared()
    for ri, row in enumerate(grid.rows):
        line = grid.lines[ri]
        if not any(row[ci].strip() for ci in mapping.values()) and not any((ri, ci) in grid.formulas for ci in mapping.values()):
            out.blank += 1
            continue
        item: dict[str, Any] = {}
        issue: Issue | None = None
        for fname, ci in mapping.items():
            cell, issue = _check_cell(grid, ri, ci, fname, line)
            if issue:
                break
            if cell:
                item[fname] = cell
        if issue is None and not item.get("company_name"):
            issue = Issue(line, "company_name_missing", "company_name")
        if issue:
            out.issues.append(issue)
            continue
        note = None
        if not item.get("contact_email") and any(item.get(k) for k in ("contact_name", "contact_phone", "contact_job_title")):
            for k in ("contact_name", "contact_phone", "contact_job_title"):
                item.pop(k, None)
            note = "contact_needs_email"
        item.setdefault("source", "Spreadsheet import")
        out.rows.append(item)
        out.lines.append(line)
        out.notes.append(note)
    return out


# ------------------------------------------------------------------------------------------------------------------------------- stock
_STATUS_WORDS: dict[str, tuple[str, ...]] = {
    "in_stock": ("in stock", "instock", "available", "yes", "y", "ok", "full", "స్టాక్ ఉంది", "ఉంది", "లభ్యం", "అందుబాటులో ఉంది", "उपलब्ध", "स्टॉक में", "है", "हाँ", "हां"),
    "few_left": ("few left", "few", "low", "low stock", "limited", "last pieces", "కొన్ని మిగిలాయి", "తక్కువ", "తక్కువ స్టాక్", "कम", "थोड़ा", "थोड़े बचे", "कम स्टॉक", "सीमित"),
    "made_to_order": ("made to order", "made to orders", "to order", "on order", "order", "out of stock", "sold out", "no stock", "nil", "none", "no", "n", "ఆర్డర్ మీద", "ఆర్డర్‌పై", "స్టాక్ లేదు", "అయిపోయింది",
                      "ऑर्डर पर", "ऑर्डर पर बनेगा", "खत्म", "स्टॉक नहीं", "नहीं है", "नहीं"),
}  # fmt: skip
_WORD_TO_STATUS = {normalise(w): status for status, words in _STATUS_WORDS.items() for w in words}


def status_from_word(text: str) -> str | None:
    return _WORD_TO_STATUS.get(normalise(text))


def status_from_quantity(text: str) -> str | None:
    t = text.strip().replace(",", "")
    if not re.fullmatch(r"\d{1,6}(\.0+)?", t):
        return None
    n = int(float(t))
    return "made_to_order" if n == 0 else "few_left" if n <= FEW_LEFT_MAX else "in_stock"


def prepare_stock(grid: Grid, mapping: dict[str, int]) -> Prepared:
    out = Prepared()
    if "stock_status" not in mapping and "quantity" not in mapping:
        out.issues.append(Issue(1, "no_status_or_quantity", None))
        return out
    seen: set[str] = set()
    for ri, row in enumerate(grid.rows):
        line = grid.lines[ri]
        if not any(row[ci].strip() for ci in mapping.values()):
            out.blank += 1
            continue
        cells: dict[str, str] = {}
        issue: Issue | None = None
        for fname, ci in mapping.items():
            cells[fname], issue = _check_cell(grid, ri, ci, fname, line)
            if issue:
                break
        if issue is None and not cells.get("item_name"):
            issue = Issue(line, "item_name_missing", "item_name")
        status = None
        if issue is None:
            if cells.get("stock_status"):
                status = status_from_word(cells["stock_status"])
                if status is None:
                    issue = Issue(line, "status_unknown", "stock_status")
            elif cells.get("quantity"):
                status = status_from_quantity(cells["quantity"])
                if status is None:
                    issue = Issue(line, "quantity_invalid", "quantity")
            elif "quantity" in mapping:
                issue = Issue(line, "quantity_invalid", "quantity")
            else:
                issue = Issue(line, "status_unknown", "stock_status")
        if issue is None:
            key = match_key(cells["item_name"])
            if key in seen:
                issue = Issue(line, "duplicate_in_file", "item_name")
            seen.add(key)
        if issue:
            out.issues.append(issue)
            continue
        out.rows.append({"name": cells["item_name"], "stock_status": status})
        out.lines.append(line)
        out.notes.append("out_of_stock_is_made_to_order" if normalise(cells.get("stock_status", "")) in OUT_OF_STOCK else None)
    return out


def match_catalogue(prepared: Prepared, catalogue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """For each usable stock row: what would happen to which catalogue item. `action`: will_change | unchanged | not_found | ambiguous."""
    by_key: dict[str, list[dict[str, Any]]] = {}
    for item in catalogue:
        by_key.setdefault(match_key(str(item["name"])), []).append(item)
    results: list[dict[str, Any]] = []
    for row, line, note in zip(prepared.rows, prepared.lines, prepared.notes, strict=True):
        found = by_key.get(match_key(row["name"]), [])
        base = {"line": line, "name": row["name"], "new_status": row["stock_status"], "note": note}
        if not found:
            results.append({**base, "action": "not_found", "item_id": None, "old_status": None})
        elif len(found) > 1:
            results.append({**base, "action": "ambiguous", "item_id": None, "old_status": None})
        else:
            item = found[0]
            same = item["stock_status"] == row["stock_status"]
            results.append({**base, "action": "unchanged" if same else "will_change", "item_id": item["id"], "old_status": item["stock_status"]})
    return results
