"""The reading call of "What you sell" (28 Nov 2026; contract docs/contracts/what-you-sell.md "The reading call"): a sheet, a photo or the owner's own words become DRAFT entries the owner checks and saves one by one. NOTHING is saved here.

All CODE, no model decides a number: the file is read by the assistant's own file reader (a sheet's cells; a picture by local OCR, and by the AI model's vision only when that found nothing and only under the owner's rules: never a school's), a
table of item and price is found by its heading, and each price is the digits the file holds, turned into whole paise. A price that is not clearly one is NOT guessed: the draft carries `price_paise: null` and the note `price_missing` with its row.
At most 20 drafts come back (`too_many` says there were more). The closed notes the web has a sentence for: price_missing, unit_missing, too_many, unreadable."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, cast

MAX_DRAFTS = 20
MAX_PAISE = 1_000_000_000          # Rs 1 crore
UNITS = {"piece": "piece", "pcs": "piece", "pc": "piece", "nos": "piece", "no": "piece", "saree": "piece", "metre": "metre", "meter": "metre", "mtr": "metre", "m": "metre", "kg": "kg", "set": "set", "dozen": "dozen", "doz": "dozen"}
_NAME_HEAD = re.compile(r"(?i)\b(item|item name|name|product|description|particulars|design|article|saree|service|course|property)\b|పేరు|नाम|ಹೆಸರು")
_PRICE_HEAD = re.compile(r"(?i)\b(price|rate|mrp|cost|amount|fee|fees|charge|rs\.?)\b|₹|ధర|రేటు|कीमत|दाम|रेट|ಬೆಲೆ")
_MOQ_HEAD = re.compile(r"(?i)\b(moq|min(imum)?\.? ?(qty|quantity|order)?)\b")
_UNIT_HEAD = re.compile(r"(?i)\b(unit|per|uom)\b")
_MONEY = re.compile(r"^(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\s*(?:/-|/|only)?$", re.IGNORECASE)


@dataclass
class Reading:
    drafts: list[dict[str, Any]] = field(default_factory=list)
    notes: list[dict[str, Any]] = field(default_factory=list)
    unclear: bool = False


def paise_of(cell: str) -> int | None:
    """"₹1,250", "Rs 1250.50", "1250/-" -> whole paise; anything else (a range, "call us", words around the number) is not a price."""
    m = _MONEY.match((cell or "").strip().replace(" ", " "))
    if not m:
        return None
    try:
        rupees = Decimal(m.group(1).replace(",", "")) + (Decimal(m.group(2)) / (10 ** len(m.group(2))) if m.group(2) else Decimal(0))
    except InvalidOperation:
        return None
    paise = int(rupees * 100)
    return paise if 100 <= paise <= MAX_PAISE else None


def _split_line(ln: str) -> tuple[str, str] | None:
    """"Haircut: Rs 300/-" -> ("Haircut", "300"). Linear: the amount is the digits, commas and dots at the END of the line (no pattern with a lazy name in front of it, which could backtrack on a long hostile line)."""
    ln = ln[:200].strip()
    for tail in ("/-", " only", "/"):
        if ln.lower().endswith(tail):
            ln = ln[: -len(tail)].rstrip()
            break
    i = len(ln)
    while i > 0 and (ln[i - 1].isdigit() or ln[i - 1] in ",."):
        i -= 1
    token = ln[i:]
    if not token or not token[0].isdigit() or paise_of(token) is None:
        return None
    name = ln[:i].rstrip(" :-–—=")
    for cur in ("₹", "rs.", "rs", "inr"):
        if name.lower().endswith(cur):
            name = name[: -len(cur)].rstrip(" :-–—=")
            break
    return (name, token) if len(name) >= 2 else None


def table_from_text(text: str) -> list[list[str]]:
    """The owner's words or a printed list, one item and its price a line ("Fall and pico 150", "Haircut: Rs 300/-"): a two-column table with a heading, or [] when most lines are not that."""
    lines = [ln for ln in (raw.strip() for raw in text.splitlines()) if ln]
    rows = []
    for ln in lines[:200]:
        got = _split_line(ln)
        if got is not None:
            rows.append([got[0], got[1]])
    return [["Item", "Price"], *rows] if rows and len(rows) * 2 >= len(lines) else []


def _col(header: list[str], rx: re.Pattern[str], taken: set[int]) -> int | None:
    for k, h in enumerate(header):
        if k not in taken and rx.search(h or ""):
            return k
    return None


def drafts_from_table(style: str, table: list[list[str]]) -> Reading:
    out = Reading()
    if len(table) < 2:
        out.unclear = True
        out.notes.append({"code": "unreadable"})
        return out
    header = [c or "" for c in table[0]]
    taken: set[int] = set()
    price_at = _col(header, _PRICE_HEAD, taken)
    if price_at is not None:
        taken.add(price_at)
    name_at = _col(header, _NAME_HEAD, taken)
    if name_at is None:
        name_at = next((k for k in range(len(header)) if k not in taken), None)
    if name_at is None or price_at is None:
        out.unclear = True
        out.notes.append({"code": "unreadable"})
        return out
    taken.add(name_at)
    moq_at = _col(header, _MOQ_HEAD, taken)
    unit_at = _col(header, _UNIT_HEAD, taken)
    rows = [r for r in table[1:] if any((c or "").strip() for c in r)]
    if len(rows) > MAX_DRAFTS:
        out.notes.append({"code": "too_many"})
    unit_noted = False
    for n, r in enumerate(rows[:MAX_DRAFTS], start=1):
        name = " ".join((r[name_at] if name_at < len(r) else "").split())[:120]
        if not name:
            continue
        price = paise_of(r[price_at]) if price_at < len(r) else None
        if price is None:
            out.notes.append({"code": "price_missing", "row": n})
        draft: dict[str, Any] = {"name": name}
        if style == "pricelist":
            moq = 1
            if moq_at is not None and moq_at < len(r) and (r[moq_at] or "").strip().isdigit():
                moq = max(1, min(int(r[moq_at].strip()), 10_000_000))
            draft["moq"] = moq
            unit = UNITS.get((r[unit_at].strip().lower() if unit_at is not None and unit_at < len(r) else ""), None)
            if unit:
                draft["unit"] = unit
            elif not unit_noted:
                out.notes.append({"code": "unit_missing", "row": n})
                unit_noted = True
            draft["rates"] = [{"from_qty": moq, "rate_paise": price}]
            draft["good_until"] = None
        elif style == "courses":
            draft["fee_paise"] = price
        else:
            draft["price_paise"] = price
        out.drafts.append(draft)
    if not out.drafts:
        out.unclear = True
        out.notes.append({"code": "unreadable"})
    return out


def read_file(runtime: Any, ctx: Any, style: str, file_id: Any) -> Reading:
    """The dropped file (assistant file route) read by the assistant's own reader, then turned into drafts. Raises ApiError with a plain word for a file that is gone or cannot be read."""
    from app.assistant_work.extract import ReadRefused
    from app.assistant_work.imports import price_table
    from app.assistant_work.service import AI_ALLOWANCE_CODES, FileTurn
    from app.assistant_work.vision import model_vision
    from app.errors import ApiError, not_found
    from app.jobs.sell_routes import READ_WORDS

    store = getattr(runtime, "assistant_work", None)
    allowed = getattr(runtime, "assistant_work_tenants", None)
    if store is None or (allowed is not None and ctx.tenant.id not in allowed):
        raise not_found()
    token, tenant = ctx.principal.token, ctx.tenant.id
    tasks = runtime.tasks
    turn = FileTurn(store, cast(Any, None), runtime.lead_sources, reader=getattr(runtime, "assistant_file_reader", None), school=(lambda: tasks is None or tasks.is_school(runtime, token, tenant)), vision=model_vision(runtime, token, tenant))
    try:
        f = store.file_get(token, tenant, file_id)
    except Exception:  # noqa: BLE001 - someone else's, expired or deleted: the database says not found
        raise ApiError(404, "file_gone", READ_WORDS["gone"]) from None
    try:
        u = turn._understand(str(f.get("name") or "file"), str(f.get("kind") or ""), str(f.get("data_base64") or ""))  # noqa: SLF001 - the same reading the chat uses
    except ReadRefused as exc:
        raise ApiError(422, "file_unreadable", READ_WORDS.get(exc.code, READ_WORDS["unreadable"]), extra={"reason": exc.code, "fields": [exc.code]}) from None
    except ApiError as exc:
        if exc.code in AI_ALLOWANCE_CODES:
            raise ApiError(429, "ai_limit", READ_WORDS["run_limit_reached"], extra={"reason": "run_limit_reached"}) from None
        raise
    if u is None:
        raise ApiError(422, "file_unreadable", READ_WORDS["unreadable"], extra={"reason": "unreadable", "fields": ["unreadable"]})
    table = next((t for t in u.tables if len(t) >= 2 and any(_PRICE_HEAD.search(h or "") for h in t[0])), None) or price_table(u.tables) or (table_from_text(u.text) or None)
    return drafts_from_table(style, table or [])
