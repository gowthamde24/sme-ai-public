"""The editable import preview (file import v2, owner 14 Nov 2026; docs/contracts/file-import.md): a file is read once (by the readers in extract.py), its rows are shown as a table the owner can correct, and only
"Add N" (the plan card's "Do it") writes anything.

State: ONE small JSON file in the same private file store as the upload (the same 24 hour rule, the same owner-only read, the same erasure); its id is the `import_id`. Nothing else is stored. Every edit
replaces that file. The rows hold names and numbers, so they are never logged and never leave the owner's own requests.

What the code decides (never the model): the columns by their headings, a phone as +91 and valid or not, a duplicate by phone (a person already in the leads, or the same number earlier in the file), and
which cells are `unsure` (a photo or scan read by OCR or by the AI reader: a number with the wrong digit count, a name with digits, every cell of a handwritten page)."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import logging
import re
import uuid
from typing import Any

from app.assistant_work.store import WorkStore
from app.connectors.phone import normalise
from app.crm.repository import NotFoundError

logger = logging.getLogger("app.assistant_work.imports")

STATE_NAME = "import-state.json"
MAX_ROWS = 5000
PAGE = 50
MAX_CELL = 200
DESTINATIONS = ("leads", "catalogue", "prices")
CONSENT_OPTIONS = ("walk_in", "asked_us", "existing_customer")
COLUMNS: dict[str, list[dict[str, str]]] = {
    "leads": [{"key": "name", "label": "Name"}, {"key": "phone", "label": "Phone"}, {"key": "interest", "label": "Interested in"}, {"key": "source", "label": "Source"}],
    "catalogue": [{"key": "item", "label": "Item"}, {"key": "price", "label": "Price"}, {"key": "stock", "label": "Stock"}, {"key": "unit", "label": "Unit"}],
    "prices": [{"key": "item", "label": "Item"}, {"key": "price", "label": "Price"}, {"key": "stock", "label": "Stock"}, {"key": "unit", "label": "Unit"}],
}
_HEAD = {
    "name": re.compile(r"name|party|customer|contact person|పేరు|नाम|ಹೆಸರು", re.IGNORECASE),
    "phone": re.compile(r"phone|mobile|mob\b|whats ?app|number|cell|contact no|ఫోన్|మొబైల్|फोन|मोबाइल|ಫೋನ್|ಮೊಬೈಲ್", re.IGNORECASE),
    "interest": re.compile(r"interest|product|requirement|enquiry|inquiry|need|notes?|remarks?|city|place|ఆసక్తి|ఏం కావాలి|रुचि|जरूरत", re.IGNORECASE),
    "source": re.compile(r"source|from|via|referr", re.IGNORECASE),
    "item": re.compile(r"item|product|name|description|saree|design|వస్తువు|సరుకు|वस्तु|उत्पाद", re.IGNORECASE),
    "price": re.compile(r"price|rate|mrp|cost|amount|₹|rs\b|ధర|రేటు|कीमत|दाम|भाव|ಬೆಲೆ|ದರ", re.IGNORECASE),
    "stock": re.compile(r"stock|qty|quantity|available|pcs|pieces|స్టాక్|సంఖ్య|स्टॉक|मात्रा|ಸ್ಟಾಕ್", re.IGNORECASE),
    "unit": re.compile(r"unit|per\b|uom|యూనిట్|इकाई|ಯೂನಿಟ್", re.IGNORECASE),
}
_DIGITS = re.compile(r"\d")
_LETTERS = re.compile(r"[^\W\d_]", re.UNICODE)


class ImportGone(Exception):
    """The import is not there (someone else's, expired, deleted)."""


class ImportState(Exception):
    """The import is not in a state that allows this (`import_state`)."""


class ConsentNeeded(Exception):
    """Leads need the consent source (`consent_source_required`)."""


class BadEdit(Exception):
    """An edit that cannot be applied (`validation_error`)."""


def _clean(value: Any) -> str:
    return " ".join(str(value if value is not None else "").replace("\x00", " ").split())[:MAX_CELL]


def _column_map(header: list[str], destination: str) -> dict[str, int]:
    """Which grid column holds which key, by the heading words; each column is used once, the best-known keys first."""
    keys = [c["key"] for c in COLUMNS[destination]]
    order = ("phone", "name", "interest", "source") if destination == "leads" else ("price", "stock", "unit", "item")
    found: dict[str, int] = {}
    used: set[int] = set()
    for key in order:
        if key not in keys:
            continue
        for i, h in enumerate(header):
            if i not in used and _HEAD[key].search(h or ""):
                found[key] = i
                used.add(i)
                break
    return found


def _has_header(grid: list[list[str]], destination: str) -> bool:
    first = grid[0] if grid else []
    hits = _column_map([_clean(c) for c in first], destination)
    if destination == "leads":
        return "phone" in hits and not any(_DIGITS.search(_clean(c)) and len(_DIGITS.findall(_clean(c))) >= 7 for c in first)
    return "price" in hits and not any(_DIGITS.search(_clean(c)) for c in first)


def _unsure(key: str, value: str, valid: bool | None, read_by: str) -> bool:
    if read_by == "ai_handwriting":
        return True
    if read_by not in ("local_ocr", "ai", "ai_vision"):
        return False
    if not value:
        return key in ("name", "phone", "item", "price")
    if key == "phone":
        return not valid
    if key in ("name", "item"):
        letters = len(_LETTERS.findall(value))
        return letters < 2 or bool(_DIGITS.search(value)) or letters / max(1, len(value.replace(" ", ""))) < 0.7
    if key == "price":
        return not re.fullmatch(r"[\d,.\s₹rsRs/-]+", value)
    return len(_LETTERS.findall(value)) / max(1, len(value.replace(" ", ""))) < 0.5


def _row(row_id: str, destination: str, cells: dict[str, str], read_by: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in cells.items():
        value = _clean(value)
        if key == "phone":
            phone = normalise(value)
            out[key] = {"value": phone or value, "unsure": _unsure(key, value, phone is not None, read_by), "valid": phone is not None}
        else:
            out[key] = {"value": value, "unsure": _unsure(key, value, None, read_by)}
    return {"row_id": row_id, "include": True, "cells": out, "flags": {"duplicate_of": None, "invalid_phone": False, "missing_required": False}}


def rows_from_grid(grid: list[list[str]], destination: str, read_by: str) -> list[dict[str, Any]]:
    """The rows of a table read from a file, for `destination`. The first row is a heading when it names the columns; otherwise the columns are taken in the order of the keys."""
    grid = [[_clean(c) for c in r] for r in grid if any(_clean(c) for c in r)]
    if not grid:
        return []
    keys = [c["key"] for c in COLUMNS[destination]]
    if _has_header(grid, destination):
        mapping = _column_map(grid[0], destination)
        body = grid[1:]
    else:
        mapping = {k: i for i, k in enumerate(keys)}
        body = grid
    rows: list[dict[str, Any]] = []
    for n, r in enumerate(body[:MAX_ROWS], start=1):
        cells = {k: (r[i] if i < len(r) else "") for k, i in mapping.items()}
        for k in keys:
            cells.setdefault(k, "")
        rows.append(_row(f"r{n}", destination, cells, read_by))
    return rows


def revalidate(rows: list[dict[str, Any]], destination: str, known: dict[str, dict[str, Any]]) -> None:
    """Flags and the default `include` after a read or an edit: an invalid phone, a missing required cell, a person already in the leads, the same number earlier in the file. `include` is only changed by the
    rule when the row was never touched by the owner (`touched`)."""
    seen: dict[str, str] = {}
    for row in rows:
        cells, flags = row["cells"], row["flags"]
        if destination == "leads":
            phone = cells.get("phone", {})
            raw = str(phone.get("value") or "")
            normal = normalise(raw)
            phone["valid"] = normal is not None
            if normal is not None:
                phone["value"] = normal
            flags["invalid_phone"] = normal is None
            flags["missing_required"] = not str(cells.get("name", {}).get("value") or "").strip() or normal is None
            tail = (normal or "")[-10:]
            dup = known.get(tail)
            if dup is not None:
                flags["duplicate_of"] = {"lead_id": dup.get("lead_id"), "name": dup.get("name")}
            elif tail and tail in seen:
                flags["duplicate_of"] = {"lead_id": None, "name": seen[tail]}
            else:
                flags["duplicate_of"] = None
            if tail and tail not in seen:
                seen[tail] = str(cells.get("name", {}).get("value") or "")
            blocked = flags["invalid_phone"] or flags["duplicate_of"] is not None or not str(cells.get("name", {}).get("value") or "").strip()
        else:
            price = str(cells.get("price", {}).get("value") or "")
            flags["invalid_phone"] = False
            flags["missing_required"] = not str(cells.get("item", {}).get("value") or "").strip() or not re.search(r"\d", price)
            flags["duplicate_of"] = None
            blocked = flags["missing_required"]
        if not row.get("touched"):
            row["include"] = not blocked


def counts_of(rows: list[dict[str, Any]], destination: str) -> dict[str, int]:
    out = {"rows": len(rows), "new": 0, "existing": 0, "invalid_phone": 0, "unsure": 0, "included": 0}
    for row in rows:
        flags = row["flags"]
        if flags["duplicate_of"] is not None:
            out["existing"] += 1
        elif not flags["missing_required"]:
            out["new"] += 1
        if flags["invalid_phone"]:
            out["invalid_phone"] += 1
        if any(c.get("unsure") for c in row["cells"].values()):
            out["unsure"] += 1
        if row["include"] and not flags["missing_required"]:
            out["included"] += 1
    return out


class Imports:
    """The operations of the routes and of the file turn, over the private file store."""

    def __init__(self, store: WorkStore) -> None:
        self.store = store

    # ---- the state file
    def _load(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID) -> dict[str, Any]:
        try:
            got = self.store.file_get(token, tenant_id, import_id)
            state = json.loads(base64.b64decode(str(got.get("data_base64") or "")).decode("utf-8"))
        except NotFoundError:
            raise ImportGone from None
        except (ValueError, KeyError, TypeError):
            raise ImportGone from None
        if not isinstance(state, dict) or state.get("v") != 2:
            raise ImportGone
        return state

    def _save(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID, state: dict[str, Any]) -> None:
        blob = base64.b64encode(json.dumps(state, ensure_ascii=False).encode("utf-8")).decode("ascii")
        self.store.file_replace(token, tenant_id, import_id, blob)

    def _known(self, token: str, tenant_id: uuid.UUID, rows: list[dict[str, Any]], destination: str) -> dict[str, dict[str, Any]]:
        if destination != "leads":
            return {}
        phones = sorted({str(r["cells"].get("phone", {}).get("value") or "") for r in rows if normalise(str(r["cells"].get("phone", {}).get("value") or ""))})
        if not phones:
            return {}
        try:
            return {str(k["phone"])[-10:]: k for k in self.store.phones_known(token, tenant_id, phones)}
        except Exception as exc:   # an unreadable answer is "none known": the lead import itself merges a known number, never doubles it
            logger.warning("import duplicates not read: %s", exc.__class__.__name__)
            return {}

    # ---- create / read
    def create(self, token: str, tenant_id: uuid.UUID, *, file_name: str, destination: str, grid: list[list[str]], read_by: str, language: str) -> dict[str, Any]:
        rows = rows_from_grid(grid, destination, read_by)
        revalidate(rows, destination, self._known(token, tenant_id, rows, destination))
        state: dict[str, Any] = {"v": 2, "file_name": file_name[:200], "destination": destination, "read_by": read_by, "language": language, "state": "ready", "source_grid": grid[: MAX_ROWS + 1],
                                 "rows": rows, "consent_chosen": None, "plan_id": None}
        blob = base64.b64encode(json.dumps(state, ensure_ascii=False).encode("utf-8")).decode("ascii")
        kept = self.store.file_put(token, tenant_id, STATE_NAME, "application/json", "text", blob)
        state["import_id"] = str(kept["file_id"])
        return state

    def get(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID) -> dict[str, Any]:
        state = self._load(token, tenant_id, import_id)
        state["import_id"] = str(import_id)
        return state

    @staticmethod
    def card(state: dict[str, Any], cursor: str | None = None, limit: int = PAGE) -> dict[str, Any]:
        """`file_preview` v2 (docs/contracts/file-import.md section 3): the card with a page of rows."""
        rows = state["rows"]
        try:
            start = max(0, int(cursor or 0))
        except ValueError:
            start = 0
        limit = max(1, min(int(limit), 200))
        page = rows[start : start + limit]
        nxt = str(start + limit) if start + limit < len(rows) else None
        destination = state["destination"]
        return {
            "kind": "file_preview", "version": 2, "id": state["import_id"], "import_id": state["import_id"], "file_name": state["file_name"], "destination": destination,
            "read_by": state["read_by"], "language": state["language"], "state": state["state"], "columns": COLUMNS[destination], "counts": counts_of(rows, destination),
            "rows": [{"row_id": r["row_id"], "include": r["include"], "cells": r["cells"], "flags": r["flags"]} for r in page], "next_cursor": nxt,
            "consent": {"required": destination == "leads", "options": list(CONSENT_OPTIONS), "chosen": state.get("consent_chosen")} if destination == "leads" else {"required": False, "options": [], "chosen": None},
            "plan": None,
        }

    # ---- edit
    def patch_rows(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID, edits: list[dict[str, Any]], include: list[dict[str, Any]]) -> dict[str, int]:
        state = self.get(token, tenant_id, import_id)
        if state["state"] != "ready":
            raise ImportState
        by_id = {r["row_id"]: r for r in state["rows"]}
        keys = {c["key"] for c in COLUMNS[state["destination"]]}
        for e in edits:
            row, cell = by_id.get(str(e.get("row_id"))), str(e.get("cell"))
            if row is None or cell not in keys:
                raise BadEdit
            value = _clean(e.get("value"))
            if cell == "phone":
                row["cells"][cell] = {"value": normalise(value) or value, "unsure": False, "valid": normalise(value) is not None}
            else:
                row["cells"][cell] = {"value": value, "unsure": False}
        for i in include:
            row = by_id.get(str(i.get("row_id")))
            if row is None:
                raise BadEdit
            row["include"] = bool(i.get("include"))
            row["touched"] = True
        revalidate(state["rows"], state["destination"], self._known(token, tenant_id, state["rows"], state["destination"]))
        self._save(token, tenant_id, import_id, state)
        return counts_of(state["rows"], state["destination"])

    def set_destination(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID, destination: str) -> dict[str, Any]:
        state = self.get(token, tenant_id, import_id)
        if state["state"] != "ready":
            raise ImportState
        if destination not in DESTINATIONS:
            raise BadEdit
        if destination != state["destination"]:
            rows = rows_from_grid(state["source_grid"], destination, state["read_by"])
            revalidate(rows, destination, self._known(token, tenant_id, rows, destination))
            state.update(destination=destination, rows=rows, consent_chosen=None)
            self._save(token, tenant_id, import_id, state)
        return state

    def cancel(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID) -> None:
        try:
            self.store.file_drop(token, tenant_id, import_id)
        except Exception as exc:   # the sweep deletes it at the latest after a day
            logger.warning("import state not deleted: %s", exc.__class__.__name__)

    def mark(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID, state: dict[str, Any], *, status: str, plan_id: uuid.UUID | None = None, consent: str | None = None) -> None:
        state.update(state=status, plan_id=str(plan_id) if plan_id else None, consent_chosen=consent or state.get("consent_chosen"))
        self._save(token, tenant_id, import_id, state)


def included_leads(state: dict[str, Any]) -> list[list[str]]:
    """The rows the owner is adding, as a small table (Name, Phone, Interested in, Source) for the lead import."""
    out = [["Name", "Phone", "Interested in", "Source"]]
    for r in state["rows"]:
        if r["include"] and not r["flags"]["missing_required"] and r["flags"]["duplicate_of"] is None:
            c = r["cells"]
            out.append([str(c["name"]["value"]), str(c["phone"]["value"]), str(c.get("interest", {}).get("value") or ""), str(c.get("source", {}).get("value") or "")])
    return out


CONSENT_BODY: dict[str, dict[str, str]] = {
    "walk_in": {"basis": "explicit_consent", "purpose": "To contact them about what they asked for in the shop", "how_collected": "They walked in and gave their number"},
    "asked_us": {"basis": "explicit_consent", "purpose": "To reply to what they asked us", "how_collected": "They asked us to contact them"},
    "existing_customer": {"basis": "contractual", "purpose": "To serve an existing customer", "how_collected": "They are an existing customer of the business"},
}


def consent_for(source: str, list_name: str) -> dict[str, Any]:
    """The lead import's own consent record for the owner's choice (the plan's step carries it; the import writes it for everyone added)."""
    if source not in CONSENT_BODY:
        raise ConsentNeeded
    return {"confirmed": True, "list_name": list_name[:100] or "Imported list", **CONSENT_BODY[source]}
