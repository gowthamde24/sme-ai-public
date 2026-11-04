"""A qualified call's quote suggestion -> a DRAFT quote for the Owner's OK (ADR 0119 decision 8; owner, 4 Nov 2026, day 2: "call's quote suggestion -> real Quote writer draft for the owner's OK").

  GET  /prospects/{id}/quote-draft   the PREVIEW (Owner, Admin, Sales): the lines the draft would have and every suggestion left out, with the reason. Nothing is stored.
  POST /prospects/{id}/quote-draft   the Owner's (or an Admin's) button, with the second factor: one enquiry on the Lead Desk lead the call made, then a MANUAL-PRICE draft through the quotes' own path
                                     (`app.quotes.service.create_manual_draft`: the pinned engine, the database's recomputation, SM216). The quote is a draft: it is approved on the quote page, as any other.

What a line is, and nothing else (no model, no guess):
  * an item the call PITCHED (in stock when it was pitched), found again by name in the catalogue NOW, still in stock or few left;
  * at the Owner's own EXACT catalogue price (`price_paise`, set by the Owner with the second factor). An item with no exact price is left out ("no_price"): a price is never made up, never a band;
  * for the quantity the buyer SAID on the call (the first number in what they said, 1 to 10,000). No number said: left out ("no_quantity"); a quantity is never made up either;
  * at most five lines (the manual quote's own limit); the rest are left out ("too_many_lines").
Each item gets an item type of its own on first use (code `LF-` and eight letters of a digest of its name; the name is the item's): a manual quote's line is labelled by its item type. The ids are derived
from the prospect, so the same button again replays (the same enquiry, the same draft) and never makes a second quote. Nothing is sent; the Owner approves the quote on the quote page."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import ConflictError
from app.errors import ApiError
from app.lead_finder.models import (
    QuoteDraftIn,
    QuoteDraftOut,
    QuoteDraftPreviewOut,
    QuoteLeftOutOut,
    QuoteLineOut,
)
from app.lead_finder.service import LeadFinderService
from app.quotes import service as quote_service
from app.quotes.models import ManualLineIn
from app.requirements.capture_text import prepare_body, prepare_subject

NS = uuid.UUID("6b1f3a52-0c8e-4d6a-9f21-7e5a4c3b2d10")
MAX_LINES = 5
_NUMBER = re.compile(r"(?<![\d.])(\d{1,5})(?![\d.])")
_DIGITS = str.maketrans("౦౧౨౩౪౫౬౭౮౯०१२३४५६७८९೦೧೨೩೪೫೬೭೮೯", "012345678901234567890123456789")


def quote_id_for(prospect_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(NS, f"lead-finder-quote:{prospect_id}")


def enquiry_id_for(prospect_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(NS, f"lead-finder-enquiry:{prospect_id}")


def item_type_code(name: str) -> str:
    return "LF-" + hashlib.sha256(name.strip().casefold().encode("utf-8")).hexdigest()[:8].upper()


_EN_UNITS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
             "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
             "eighty": 80, "ninety": 90, "dozen": 12}
_EN_SCALES = {"hundred": 100, "thousand": 1000}
# Telugu, matched at the start of a word (the endings vary: వందల, వందలు): longest first, so పదిహేను is not read as పది
_TE_UNITS = sorted({"ఒకటి": 1, "ఒక": 1, "రెండు": 2, "మూడు": 3, "నాలుగు": 4, "ఐదు": 5, "అయిదు": 5, "ఆరు": 6, "ఏడు": 7, "ఎనిమిది": 8, "తొమ్మిది": 9, "పదిహేను": 15, "పది": 10,
                    "ఇరవై": 20, "ముప్పై": 30, "నలభై": 40, "యాభై": 50, "అరవై": 60, "డెబ్భై": 70, "ఎనభై": 80, "తొంభై": 90}.items(), key=lambda kv: -len(kv[0]))
_TE_SCALES = (("వంద", 100), ("వెయ్యి", 1000), ("వేల", 1000))


def _words_number(tokens: list[str], units: Any, scales: Any, match: Any) -> int | None:
    total, cur, started = 0, 0, False
    for tok in tokens:
        unit, scale = match(tok, units), match(tok, scales)
        if unit is not None:
            cur += unit
            started = True
        elif scale is not None:
            total += (cur or 1) * scale
            cur, started = 0, True
        elif tok in ("and", "a", "an") and (started or tok != "and"):
            continue   # "two hundred and fifty"; "a hundred" (the scale alone counts once)
        elif started:
            break
    n = total + cur
    return n if started and n > 0 else None


def _en_match(tok: str, table: dict[str, int]) -> int | None:
    return table.get(tok)


def _te_match(tok: str, table: Any) -> int | None:
    return next((n for word, n in table if tok.startswith(word)), None)


def quantity_of(said: str) -> int | None:
    """The first quantity in what the buyer said: digits ("40 pieces", Indian digits too), or English or Telugu number words ("about forty pieces a month" -> 40, "two hundred bags" -> 200,
    "నెలకి సుమారు నలభై pieces" -> 40, "రెండు వందల bags" -> 200). None when no number was said: a quantity is never made up."""
    text = (said or "").translate(_DIGITS)
    m = _NUMBER.search(text)
    n: int | None = int(m.group(1)) if m else None
    if n is None:
        tokens = [t for t in re.split(r"[\s,.;:!?()-]+", text.casefold()) if t]
        n = _words_number(tokens, _EN_UNITS, _EN_SCALES, _en_match)
        if n is None:
            n = _words_number(tokens, _TE_UNITS, _TE_SCALES, _te_match)
    return n if n is not None and 1 <= n <= 10_000 else None


def _qualified(service: LeadFinderService, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> dict[str, Any]:
    service.data_for(token, tenant_id)   # a school: 403, like every Lead Finder route
    row = service.repo.prospect_get(token, tenant_id, prospect_id)
    qualification = row.get("qualification") if isinstance(row.get("qualification"), dict) else None
    if row.get("status") != "qualified" or not row.get("lead_id") or qualification is None:
        raise ApiError(409, "not_qualified", "Only a qualified call has a quote suggestion. Run the call first.")
    return row


def lines_for(service: LeadFinderService, token: str, tenant_id: uuid.UUID, row: dict[str, Any]) -> tuple[list[QuoteLineOut], list[QuoteLeftOutOut]]:
    suggestion = [s for s in (row["qualification"].get("quote_suggestion") or []) if isinstance(s, dict) and s.get("item")]
    catalogue = {str(r.get("name") or "").strip().casefold(): r for r in service.repo.stock(token, tenant_id) if r.get("name")}
    lines: list[QuoteLineOut] = []
    left: list[QuoteLeftOutOut] = []
    for s in suggestion:
        name = str(s["item"]).strip()[:200]
        said = str(s.get("quantity_said") or "")[:120]
        item = catalogue.get(name.casefold())
        if item is None:
            left.append(QuoteLeftOutOut(item=name, reason="not_in_catalogue"))
            continue
        if item.get("stock_status") not in ("in_stock", "few_left"):
            left.append(QuoteLeftOutOut(item=name, reason="not_in_stock"))
            continue
        price = item.get("price_paise")
        if not isinstance(price, int) or price < 1:
            left.append(QuoteLeftOutOut(item=name, reason="no_price"))
            continue
        qty = quantity_of(said)
        if qty is None:
            left.append(QuoteLeftOutOut(item=name, reason="no_quantity"))
            continue
        if len(lines) >= MAX_LINES:
            left.append(QuoteLeftOutOut(item=name, reason="too_many_lines"))
            continue
        lines.append(QuoteLineOut(item=name, item_type_code=item_type_code(name), qty=qty, unit_price_paise=price, quantity_said=said))
    return lines, left


def preview(service: LeadFinderService, quotes: Any, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> QuoteDraftPreviewOut:
    row = _qualified(service, token, tenant_id, prospect_id)
    lines, left = lines_for(service, token, tenant_id, row)
    qid = quote_id_for(prospect_id)
    made = False
    if quotes is not None:
        try:
            made = quotes.get_quote(token, tenant_id, qid) is not None
        except Exception:   # the preview still says what the draft would be
            made = False
    return QuoteDraftPreviewOut(prospect_id=prospect_id, lead_id=uuid.UUID(str(row["lead_id"])), ready=bool(lines), lines=lines, left_out=left, quote_id=qid, made=made)


def _enquiry_text(row: dict[str, Any], lines: list[QuoteLineOut]) -> tuple[str, str | None]:
    q = row["qualification"]
    summary = str(q.get("summary") or "").strip()
    asked = "; ".join(f"{line.item}: {line.quantity_said}" for line in lines)
    body = (f"Practice call (simulated) by the Lead Finder with {row.get('name') or 'a new business'}. Nothing was dialled. "
            f"{summary} What they said they buy: {asked}. The draft quote uses our catalogue prices only.").strip()
    return prepare_body(body).text, prepare_subject(f"Lead Finder call: {row.get('name') or 'new business'}")


def make(service: LeadFinderService, quotes: Any, enquiries: Any, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, body: QuoteDraftIn) -> QuoteDraftOut:
    if quotes is None or enquiries is None:
        raise ApiError(503, "quotes_unavailable", "Quotes are not available right now.")
    row = _qualified(service, token, tenant_id, prospect_id)
    lines, left = lines_for(service, token, tenant_id, row)
    if not lines:
        raise ApiError(422, "nothing_to_quote", "None of the suggested items has an exact price, a quantity the buyer said and stock: there is nothing to put in a draft.")
    # the item types, made on first use (the database asks for the second factor; the route already did)
    known = {str(t["code"]): t for t in quotes.list_item_types(token, tenant_id)}
    usable: list[QuoteLineOut] = []
    for i, line in enumerate(lines):
        have = known.get(line.item_type_code)
        if have is None:
            quotes.save_item_type(token, {"p_tenant_id": str(tenant_id), "p_code": line.item_type_code, "p_name": line.item, "p_position": 900 + i, "p_active": True,
                                          "p_min_price_paise": None, "p_max_price_paise": None})
        elif not have.get("active", True):
            left.append(QuoteLeftOutOut(item=line.item, reason="item_type_off"))
            continue
        usable.append(line)
    if not usable:
        raise ApiError(422, "nothing_to_quote", "The suggested items' item types are switched off: there is nothing to put in a draft.")
    text, subject = _enquiry_text(row, usable)
    received = row.get("last_contacted_at") or datetime.now(UTC).isoformat()
    try:
        enquiry, _ = enquiries.create(token, tenant_id, {"id": str(enquiry_id_for(prospect_id)), "lead_id": str(row["lead_id"]), "channel": "other",
                                                         "received_at": datetime.fromisoformat(str(received).replace("Z", "+00:00")).astimezone(UTC).isoformat(),
                                                         "subject": subject, "body": text, "truncated_from": None})
    except ConflictError:
        raise ApiError(409, "quote_draft_exists", "A draft from this call already exists. Open it on the quotes page.") from None
    qid = quote_id_for(prospect_id)
    try:
        quote_id, replayed = quote_service.create_manual_draft(quotes, token, tenant_id, enquiry, qid, body.customer_kind, body.delivery_state,
                                                               [ManualLineIn(item_type_code=line.item_type_code, qty=line.qty, unit_price_paise=line.unit_price_paise) for line in usable])
    except ConflictError:
        raise ApiError(409, "quote_draft_exists", "A draft from this call already exists, made with other prices. Open it on the quotes page.") from None
    loaded = quote_service.load_quote(quotes, enquiries, token, tenant_id, quote_id)
    return QuoteDraftOut(quote_id=quote_id, quote_no=loaded.quote_no if loaded else None, enquiry_id=enquiry.id, status="draft", total_paise=loaded.total_paise if loaded else None,
                         needs_owner_approval=bool(loaded.needs_owner_approval) if loaded else True, lines=usable, left_out=left, replayed=replayed)
