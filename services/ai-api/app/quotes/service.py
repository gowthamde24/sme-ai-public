"""The quote flow, step by step, with no HTTP in it: read the sources the caller may see, build the engine's request (builder.py), run the PINNED engine (engine_port), and let
the DATABASE verify the result against its own recomputation and store it. Nothing here computes a price, sends anything, or decides an approval.

Every read and write carries the CALLER's token. The two pure packages are reached only through their adapters (engine_port, mapper_port, text_port)."""

from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any

from app.enquiries.models import EnquiryOut
from app.enquiries.service import value_of
from app.errors import ApiError
from app.quotes import engine_port, mapper_port, text_port
from app.quotes.builder import (
    SETTLED,
    MissingInput,
    Pick,
    Policy,
    PriceItem,
    RequirementFacts,
    build_request,
    requirement_facts,
    today_ist,
)
from app.quotes.models import (
    PickedOut,
    PriceItemOut,
    QuoteLineOut,
    QuoteOut,
    QuoteSetupOut,
    QuoteSummaryOut,
    SetupLineOut,
    SuggestionOut,
    UnquotedLineOut,
)
from app.quotes.repository import QuotesRepository
from app.quotes.states import ALL_CODES
from app.requirements.display import display

NOTES = (
    "Prices are in Indian rupees (INR).",
    "GST is shown separately as a line.",
    "This is a quote, not an invoice.",
)


def payment_terms_text(advance_paise: int, balance_paise: int) -> str:
    """The payment wording of the customer text, chosen from the AMOUNTS the quote already carries (never typed by a person, never a model's): everything in
    advance, everything by the due date, or an advance and a balance. The figures themselves are printed by the renderer from the engine's result."""
    if advance_paise < 0 or balance_paise < 0:
        raise ValueError("amounts are never negative")
    if advance_paise == 0 and balance_paise == 0:
        return "No payment is due."
    if balance_paise == 0:
        return "The whole amount is payable in advance, before dispatch."
    if advance_paise == 0:
        return "The whole amount is payable by the due date."
    return "An advance is payable before dispatch; the balance by the due date."


_LINE_ORDER = {"saree_type": 0, "quantity": 1, "fabric": 2, "colour": 3}


def not_computable() -> ApiError:
    return ApiError(
        422,
        "quote_not_computable",
        "A quote cannot be computed from these inputs. Check every line has a confirmed saree type, a quantity and a product.",
    )


def stale() -> ApiError:
    return ApiError(
        409,
        "quote_stale",
        "The inputs of this quote have changed since the draft: make a new draft.",
    )


# ----------------------------------------------------------------------------- reading the sources
def to_policy(row: dict[str, Any]) -> Policy:
    return Policy(
        discount_ceiling_bps=int(row["discount_ceiling_bps"]),
        shipping_flat_fee_paise=int(row["shipping_flat_fee_paise"]),
        shipping_free_above_paise=(
            None
            if row["shipping_free_above_paise"] is None
            else int(row["shipping_free_above_paise"])
        ),
        shipping_tax_bps=int(row["shipping_tax_bps"]),
        validity_days=int(row["validity_days"]),
        new_advance_bps=int(row["new_advance_bps"]),
        repeat_advance_bps=int(row["repeat_advance_bps"]),
        net_days=int(row["net_days"]),
        rounding_mode=str(row["rounding_mode"]),
        repeat_credit_limit_paise=int(row["repeat_credit_limit_paise"]),
        seller_state=str(row["seller_state"]),
        required_inputs=tuple(str(x) for x in row["required_inputs"]),
    )


def to_items(rows: list[dict[str, Any]]) -> dict[str, PriceItem]:
    items: dict[str, PriceItem] = {}
    for row in rows:
        breaks = tuple(
            sorted((int(b["min_qty"]), int(b["unit_price_paise"])) for b in row.get("breaks") or [])
        )
        items[str(row["product_id"])] = PriceItem(
            product_id=str(row["product_id"]),
            sku=str(row["sku"]),
            name=str(row["name"]),
            sale_unit=str(row["sale_unit"]),
            unit_price_paise=int(row["unit_price_paise"]),
            minimum_order_quantity=int(row["minimum_order_quantity"]),
            tax_bps=int(row["tax_bps"]),
            breaks=breaks,
        )
    return items


def to_picks(rows: list[dict[str, Any]]) -> list[Pick]:
    return [
        Pick(
            line_no=int(r["line_no"]),
            product_id=str(r["product_id"]),
            qty=int(r["qty"]),
            sale_unit=str(r["sale_unit"]),
        )
        for r in rows
    ]


def item_out(item: PriceItem) -> PriceItemOut:
    return PriceItemOut(
        product_id=uuid.UUID(item.product_id),
        sku=item.sku,
        name=item.name,
        sale_unit=item.sale_unit,  # type: ignore[arg-type]
        unit_price_paise=item.unit_price_paise,
        minimum_order_quantity=item.minimum_order_quantity,
        tax_bps=item.tax_bps,
    )


def _label(key: str) -> str:
    return key.replace("_", " ").capitalize()


def _line_summaries(rows: list[dict[str, Any]]) -> dict[int, list[str]]:
    """Our own wording of each requirement line (never the customer's text), settled fields plainly and the others marked."""
    by_line: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        if row["line_no"] is not None and row["field_key"] in _LINE_ORDER:
            by_line.setdefault(int(row["line_no"]), []).append(row)
    out: dict[int, list[str]] = {}
    for n, line_rows in sorted(by_line.items()):
        parts = []
        for row in sorted(line_rows, key=lambda r: _LINE_ORDER[r["field_key"]]):
            shown = display(row["field_key"], value_of(row)) or "?"
            note = "" if row["state"] in SETTLED else " (not confirmed)"
            parts.append(f"{_label(row['field_key'])}: {shown}{note}")
        out[n] = parts
    return out


# ----------------------------------------------------------------------------- the quote as the screen shows it
def outcome(row: dict[str, Any]) -> str:
    if row["status"] == "superseded" and row.get("withdrawn_at") is not None:
        return "withdrawn"
    return str(row["status"])


def unquoted_lines(rows: list[dict[str, Any]], quoted: set[int]) -> list[UnquotedLineOut]:
    summaries = _line_summaries(rows)
    return [
        UnquotedLineOut(line_no=n, summary=parts)
        for n, parts in summaries.items()
        if n not in quoted
    ]


def quote_out(
    row: dict[str, Any], lines: list[dict[str, Any]], unquoted: list[UnquotedLineOut]
) -> QuoteOut:
    return QuoteOut.model_validate(
        {
            **row,
            "outcome": outcome(row),
            "engine_flags": list(row["engine_flags"]),
            "review_flags": list(row["review_flags"]),
            "lines": [QuoteLineOut.model_validate(line) for line in lines],
            "unquoted_lines": unquoted,
        }
    )


def summary_out(row: dict[str, Any]) -> QuoteSummaryOut:
    shown = {
        k: v for k, v in row.items() if k != "withdrawn_at"
    }  # only needed to tell a withdrawal from a replacement
    return QuoteSummaryOut.model_validate({**shown, "outcome": outcome(row)})


def load_quote(
    quotes: QuotesRepository, enquiries: Any, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
) -> QuoteOut | None:
    got = quotes.get_quote(token, tenant_id, quote_id)
    if got is None:
        return None
    row, lines = got
    unquoted: list[UnquotedLineOut] = []
    if row["status"] in ("draft", "approved"):
        requirement, rows = enquiries.get_requirement(
            token, tenant_id, uuid.UUID(str(row["enquiry_id"]))
        )
        if requirement is not None and str(requirement["id"]) == str(row["requirement_id"]):
            unquoted = unquoted_lines(rows, {int(line["requirement_line_no"]) for line in lines})
    return quote_out(row, lines, unquoted)


# ----------------------------------------------------------------------------- the request for a quote
def requirement_of(
    enquiries: Any, token: str, tenant_id: uuid.UUID, enquiry: EnquiryOut
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The enquiry's CONFIRMED requirement and its rows (409 otherwise)."""
    requirement, rows = enquiries.get_requirement(token, tenant_id, enquiry.id)
    if requirement is None or requirement["status"] != "confirmed":
        raise ApiError(
            409,
            "requirement_not_confirmed",
            "Confirm the requirement before quoting it.",
        )
    return requirement, rows


def request_for(
    quotes: QuotesRepository,
    token: str,
    tenant_id: uuid.UUID,
    *,
    requirement_id: uuid.UUID,
    rows: list[dict[str, Any]],
    kind: str,
    as_of: date,
    price_version: uuid.UUID,
    policy_version: uuid.UUID,
) -> dict[str, Any]:
    """The engine request for these sources, exactly as the database builds it (builder.py). Raises MissingInput, ApiError(not computable)."""
    policy_row = quotes.policy(token, tenant_id, policy_version)
    if policy_row is None:
        raise MissingInput([0])
    items = to_items(quotes.price_items(token, tenant_id, price_version))
    picks = to_picks(quotes.picks(token, tenant_id, requirement_id))
    return build_request(as_of, kind, requirement_facts(rows), picks, items, to_policy(policy_row))


def run_engine(request: dict[str, Any]) -> dict[str, Any]:
    """The pinned engine; a refusal or an unavailable engine is a fixed API error (and nothing is stored)."""
    try:
        result = engine_port.run_quote(request)
    except engine_port.QuoteEngineUnavailable:
        raise ApiError(
            503, "quote_computation_unavailable", "Quotes are not available right now."
        ) from None
    except (engine_port.QuoteEngineError, engine_port.QuoteInputError):
        raise ApiError(
            502, "quote_computation_failed", "The quote engine answered something unexpected."
        ) from None
    if engine_port.is_rejected(result):
        raise not_computable()
    return result


def create_draft(
    quotes: QuotesRepository,
    enquiries: Any,
    token: str,
    tenant_id: uuid.UUID,
    enquiry: EnquiryOut,
    quote_id: uuid.UUID,
    kind: str,
    delivery_state: str,
    now: date | None = None,
) -> tuple[uuid.UUID, bool]:
    """Make a draft. Returns (quote id, replayed). The database refuses (SM216) any request or figure that is not its own recomputation."""
    if delivery_state not in ALL_CODES:
        raise ApiError(
            422,
            "invalid_delivery_state",
            "The delivery state is not a state or union territory code.",
        )
    requirement, rows = requirement_of(enquiries, token, tenant_id, enquiry)
    as_of = now or today_ist()
    price = quotes.active_price_version(token, tenant_id, as_of)
    policy = quotes.active_policy(token, tenant_id, as_of)
    if price is None or policy is None:
        raise ApiError(
            422, "quote_input_missing", "The workspace has no price list or quote policy in force."
        )
    try:
        request = request_for(
            quotes,
            token,
            tenant_id,
            requirement_id=uuid.UUID(str(requirement["id"])),
            rows=rows,
            kind=kind,
            as_of=as_of,
            price_version=uuid.UUID(str(price["id"])),
            policy_version=uuid.UUID(str(policy["id"])),
        )
    except MissingInput:
        raise ApiError(
            422,
            "quote_input_missing",
            "Every confirmed line needs a product picked from the price list before a quote can be made.",
        ) from None
    result = run_engine(request)
    created = quotes.create_draft(
        token,
        {
            "p_quote_id": str(quote_id),
            "p_requirement_id": str(requirement["id"]),
            "p_customer_kind": kind,
            "p_delivery_state": delivery_state,
            "p_engine_version": engine_port.engine_version(),
            "p_request_text": engine_port.canonical_json(request),
            "p_result_text": engine_port.canonical_json(result),
        },
    )
    return uuid.UUID(str(created["quote_id"])), bool(created.get("replayed"))


def recomputed_hash(
    quotes: QuotesRepository, enquiries: Any, token: str, tenant_id: uuid.UUID, quote: QuoteOut
) -> str:
    """The approver's recomputation: rebuild the request from the quote's RECORDED versions and the CURRENT picks and requirement, run the engine, return ITS hash. The
    database compares it to the quote's own hash (SM216 when anything moved) and then rebuilds everything itself (SM215)."""
    requirement, rows = enquiries.get_requirement(token, tenant_id, quote.enquiry_id)
    if (
        requirement is None
        or requirement["status"] != "confirmed"
        or str(requirement["id"]) != str(quote.requirement_id)
    ):
        raise stale()
    try:
        request = request_for(
            quotes,
            token,
            tenant_id,
            requirement_id=quote.requirement_id,
            rows=rows,
            kind=quote.customer_kind,
            as_of=quote.as_of,
            price_version=quote.price_list_version_id,
            policy_version=quote.policy_version_id,
        )
    except MissingInput:
        raise stale() from None
    digest = run_engine(request).get("canonical_hash")
    if not isinstance(digest, str):
        raise ApiError(
            502, "quote_computation_failed", "The quote engine answered something unexpected."
        )
    return digest


# ----------------------------------------------------------------------------- the mapper's suggestions (a person picks)
def suggest(
    quotes: QuotesRepository,
    token: str,
    tenant_id: uuid.UUID,
    rows: list[dict[str, Any]],
    items: dict[str, PriceItem],
    as_of: date,
) -> tuple[dict[str, Any], dict[int, dict[str, Any]]] | None:
    """The mapper's proposals for the settled lines over the products ON THE PRICE LIST, or None if the mapper cannot run. Returns (result, by line)."""
    config = quotes.active_mapper_config(token, tenant_id, as_of)
    default_unit = str(config["default_sale_unit"]) if config else "piece"
    catalog_rows = {str(p["id"]): p for p in quotes.products(token, tenant_id)}
    catalog = [
        {
            "sku": item.sku,
            "category": product.get("category"),
            "attributes": product.get("attributes") or {},
            "active": bool(product.get("active", True)),
            "sale_unit": item.sale_unit,
        }
        for pid, item in items.items()
        if (product := catalog_rows.get(pid)) is not None
    ]
    settled = [r for r in rows if r.get("state") in SETTLED]
    try:
        request, _skipped = mapper_port.build_request(
            settled, catalog, dict(config["config"]) if config else {}, default_unit
        )
        result = mapper_port.run_mapper(request)
    except (mapper_port.MapperUnavailable, mapper_port.MapperError, mapper_port.MapperInputError):
        return None
    return result, {int(s["line_no"]): s for s in mapper_port.suggestions(result)}


def setup(
    quotes: QuotesRepository,
    enquiries: Any,
    token: str,
    tenant_id: uuid.UUID,
    enquiry: EnquiryOut,
    now: date | None = None,
) -> QuoteSetupOut:
    as_of = now or today_ist()
    requirement, rows = enquiries.get_requirement(token, tenant_id, enquiry.id)
    price = quotes.active_price_version(token, tenant_id, as_of)
    policy_row = quotes.active_policy(token, tenant_id, as_of)
    missing: list[str] = []
    if requirement is None:
        missing.append("no_requirement")
    elif requirement["status"] != "confirmed":
        missing.append("requirement_not_confirmed")
    if price is None:
        missing.append("no_price_list")
    if policy_row is None:
        missing.append("no_policy")
    items = (
        to_items(quotes.price_items(token, tenant_id, uuid.UUID(str(price["id"])))) if price else {}
    )
    facts: RequirementFacts = requirement_facts(rows)
    picks = (
        {p["line_no"]: p for p in quotes.picks(token, tenant_id, uuid.UUID(str(requirement["id"])))}
        if requirement
        else {}
    )
    mapped = suggest(quotes, token, tenant_id, rows, items, as_of) if items and rows else None
    if items and rows and mapped is None:
        missing.append("mapper_unavailable")
    by_sku = {item.sku: item for item in items.values()}
    summaries = _line_summaries(rows)
    quotable = {line.line_no: line for line in facts.lines if line.complete}
    lines: list[SetupLineOut] = []
    for n, parts in summaries.items():
        line = quotable.get(n)
        pick_row = picks.get(n)
        suggestion = None
        found = mapped[1].get(n) if mapped and line else None
        if found is not None:
            suggestion = SuggestionOut(
                status=found["status"],
                reason=found.get("reason"),
                candidates=[item_out(by_sku[s]) for s in found["candidates"] if s in by_sku],
                truncated=bool(found.get("truncated")),
            )
        lines.append(
            SetupLineOut(
                line_no=n,
                summary=parts,
                quantity=line.quantity if line else None,
                basis=line.basis if line else None,
                quotable=line is not None,
                pick=(
                    PickedOut(
                        product_id=pick_row["product_id"],
                        qty=pick_row["qty"],
                        sale_unit=pick_row["sale_unit"],
                        source=pick_row["source"],
                    )
                    if pick_row
                    else None
                ),
                suggestion=suggestion,
            )
        )
    policy = to_policy(policy_row) if policy_row else None
    return QuoteSetupOut(
        requirement_id=requirement["id"] if requirement else None,
        requirement_status=requirement["status"] if requirement else None,
        today=as_of,
        price_list_version_id=price["id"] if price else None,
        policy_version_id=policy_row["id"] if policy_row else None,
        seller_state=policy.seller_state if policy else None,
        required_inputs=list(policy.required_inputs) if policy else [],
        mapper_version=mapper_version(mapped),
        missing=missing,
        lines=lines,
        price_list=[item_out(i) for i in sorted(items.values(), key=lambda x: x.sku)],
        delivery_states=dict(ALL_CODES),
    )


def mapper_version(mapped: tuple[dict[str, Any], dict[int, dict[str, Any]]] | None) -> str | None:
    return str(mapped[0]["mapper_version"]) if mapped else None


def pick_source(
    quotes: QuotesRepository,
    token: str,
    tenant_id: uuid.UUID,
    rows: list[dict[str, Any]],
    line: int,
    product_id: uuid.UUID,
    as_of: date,
) -> str:
    """The sha256 of the mapper output a suggested product came from. 422 if the mapper no longer suggests this product for this line (nothing is guessed)."""
    price = quotes.active_price_version(token, tenant_id, as_of)
    items = (
        to_items(quotes.price_items(token, tenant_id, uuid.UUID(str(price["id"])))) if price else {}
    )
    mapped = suggest(quotes, token, tenant_id, rows, items, as_of) if items else None
    chosen = items.get(str(product_id))
    found = mapped[1].get(line) if mapped else None
    if mapped is None or chosen is None or found is None or chosen.sku not in found["candidates"]:
        raise ApiError(
            422,
            "suggestion_changed",
            "The mapper no longer suggests that product for this line: pick it by hand or refresh the suggestions.",
        )
    digest = mapped[0].get("canonical_hash")
    if not isinstance(digest, str):
        raise ApiError(422, "suggestion_changed", "The suggestion is no longer available.")
    return digest


# ----------------------------------------------------------------------------- the customer text of an APPROVED quote
def render_text(
    quotes: QuotesRepository,
    token: str,
    tenant_id: uuid.UUID,
    tenant_name: str,
    quote: QuoteOut,
) -> dict[str, Any]:
    """The plain text of an approved quote. `expected_engine_hash` is the STORED approved row's hash, never anything from the request; the engine is re-run on the stored
    request and must give the stored result (the renderer checks only that the hash it is given equals the result's own hash)."""
    stored = quotes.get_quote_texts(token, tenant_id, quote.id)
    if (
        stored is None
        or stored["status"] != "approved"
        or stored["approved_hash"] != stored["canonical_hash"]
    ):
        raise ApiError(409, "quote_not_approved", "Only an approved quote has customer text.")
    try:
        request = json.loads(stored["request_text"])
        stored_result = json.loads(stored["result_text"])
        if stored["engine_version"] != engine_port.engine_version():
            raise text_port.TextRefused("UNSUPPORTED_ENGINE")
        rerun = engine_port.run_quote(request)
        if engine_port.canonical_json(rerun) != engine_port.canonical_json(stored_result):
            raise text_port.TextRefused("DATE_MISMATCH")
    except (
        ValueError,
        text_port.TextRefused,
        engine_port.QuoteEngineError,
        engine_port.QuoteInputError,
    ):
        raise ApiError(409, "quote_text_refused", "The stored quote cannot be rendered.") from None
    except engine_port.QuoteEngineUnavailable:
        raise ApiError(
            503, "quote_text_unavailable", "Quote text is not available right now."
        ) from None
    company = quotes.company_name(token, tenant_id, quote.lead_id)
    display_block = {
        "seller_name": tenant_name,
        "customer_name": company or "Customer",
        "quote_ref": f"Q-{quote.quote_no:05d}",
        "issued_on": quote.as_of.isoformat(),
        "valid_until": quote.valid_until.isoformat(),
        "line_labels": {line.sku: line.name for line in quote.lines},
        "payment_terms_text": payment_terms_text(quote.advance_paise, quote.balance_paise),
        "notes": list(NOTES),
    }
    try:
        return text_port.render_approved(
            stored_result, str(stored["canonical_hash"]), display_block
        )
    except text_port.TextUnavailable:
        raise ApiError(
            503, "quote_text_unavailable", "Quote text is not available right now."
        ) from None
    except text_port.TextRefused:
        raise ApiError(409, "quote_text_refused", "The stored quote cannot be rendered.") from None
