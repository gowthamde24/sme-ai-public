"""The assistant's tools. READ tools return what the caller may already see (row-level security does that, with the caller's own token); ACTION tools leave DRAFTS
only. There is no tool that sends, approves, prices, deletes or reads another business, and none takes a tenant, a user, a role or a table: those are never the
model's to name. A tool call is looked up by exact name and its arguments are parsed with a CLOSED schema (an extra field, such as a price, is a refusal).

Every read returns ITEMS. An item has a short handle (s1, s2, ...), a type, an id and a plain label; the model cites handles, and the code turns the cited handles
into sources (so a source can only be something a tool really returned in this run). Money in an item is given as integer paise and as rupee text; the model repeats
those words and never adds, multiplies or converts them (the code checks every rupee amount in an answer against what the tools returned)."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.assistant.db import AssistantDb
from app.assistant.language import Language
from app.assistant.models import DraftCardOut, OpenTarget, draft_summary
from app.auth.deps import Runtime
from app.catalogue.vocab import (
    BAND_LABEL,
    COLOURS,
    FABRIC_ALIASES,
    FABRIC_LABEL,
    STOCK_LABEL,
    Occasion,
    PriceBand,
)
from app.requirements.capture_text import prepare_body, prepare_subject
from app.suppression.keys import normalise_phone
from app.tenancy.repository import RepositoryError
from app.today.service import format_rupees, shape_today

IST = timezone(timedelta(hours=5, minutes=30))
MAX_ITEMS = 12


class _Args(BaseModel):
    """Closed: a field the schema does not name (a price, a tenant id, a role) is a refusal."""

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True)
class Item:
    handle: str
    type: str
    id: uuid.UUID
    label: str
    fields: dict[str, str | int | None]
    open: tuple[str, uuid.UUID] | None = None


@dataclass
class State:
    """What this run has seen and made. Sources can only come from here."""

    items: dict[str, Item] = field(default_factory=dict)
    by_id: dict[tuple[str, uuid.UUID], str] = field(default_factory=dict)
    drafts: list[DraftCardOut] = field(default_factory=list)
    allowed_paise: set[int] = field(default_factory=set)
    counter: int = 0
    # the handles get_today showed: what is WAITING for the owner (every one must be in an answer about it) and the recent order steps (job AO)
    waiting: list[str] = field(default_factory=list)
    today_recent: list[str] = field(default_factory=list)
    # job BP: web calls made in this run by kind, and the web addresses the owner typed in the question
    web_calls: dict[str, int] = field(default_factory=dict)
    question_urls: frozenset[str] = frozenset()

    def add(
        self,
        type_: str,
        id_: uuid.UUID,
        label: str,
        fields: dict[str, str | int | None],
        open_: tuple[str, uuid.UUID] | None = None,
        *,
        money: tuple[int, ...] = (),
    ) -> Item:
        for paise in money:
            self.allowed_paise.add(paise)
        known = self.by_id.get((type_, id_))
        if known is not None:  # the same record seen again keeps its handle
            return self.items[known]
        self.counter += 1
        item = Item(f"s{self.counter}", type_, id_, label, fields, open_)
        self.items[item.handle] = item
        self.by_id[(type_, id_)] = item.handle
        return item


@dataclass(frozen=True)
class Ctx:
    db: AssistantDb
    runtime: Runtime
    token: str
    tenant: uuid.UUID
    run_id: uuid.UUID
    state: State


@dataclass(frozen=True)
class Output:
    """What a tool hands back: the items it found or made, and a closed note when it could not do the thing."""

    items: tuple[Item, ...] = ()
    note: str = "ok"
    # figures that belong to no single record (today's totals): shown to the model, never citable as a source
    facts: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args: type[_Args]
    handler: Callable[[Ctx, Any], Output]
    action: bool = False


def _money(paise: int) -> str:
    return format_rupees(paise)


def _name(row: dict[str, Any] | None) -> tuple[str, str | None]:
    company = ((row or {}).get("lead") or {}).get("company") or {}
    return (company.get("name") or "A customer", company.get("city"))


def _derived(*parts: object) -> uuid.UUID:
    """A stable id for a draft the assistant makes in this run: the same ask twice makes ONE draft (an exact retry replays)."""
    return uuid.uuid5(uuid.NAMESPACE_URL, "sme-ai-assistant:" + ":".join(str(p) for p in parts))


_SAFE_QUERY = re.compile(r"[^\w .\-'&]", re.UNICODE)


def _like(text: str) -> str:
    return _SAFE_QUERY.sub("", text).strip()[:60]


# ==================================================================================================== read tools
class NoArgs(_Args):
    pass


def get_today(ctx: Ctx, _: NoArgs) -> Output:
    """EVERY item that waits for the owner (the same list as GET /today), then the last order steps. The handles of the waiting ones are kept so the runner can see whether an answer left one out."""
    raw = ctx.runtime.today.today_summary(ctx.token, ctx.tenant) if ctx.runtime.today else None
    if raw is None:
        return Output(note="unavailable")
    today = shape_today(raw)
    items: list[Item] = []
    ctx.state.waiting.clear()
    ctx.state.today_recent.clear()
    for entry in today.needs_you:
        paise = (entry.amount_paise,) if entry.amount_paise is not None else ()
        kind = entry.target.type
        item = ctx.state.add(
            kind,
            entry.target.id,
            f"{entry.customer}: {entry.summary}"[:160],
            {
                "waiting_for_you": entry.kind,
                "city": entry.city,
                "amount": _money(entry.amount_paise) if entry.amount_paise is not None else None,
            },
            (kind, entry.target.id),
            money=paise,
        )
        items.append(item)
        if item.handle not in ctx.state.waiting:
            ctx.state.waiting.append(item.handle)
    for step in today.recent:
        item = ctx.state.add(
            "order",
            step.target.id,
            f"{step.order_ref}: {step.text} ({step.customer})"[:160],
            {"recent_step": step.text},
            ("order", step.target.id),
        )
        items.append(item)
        ctx.state.today_recent.append(item.handle)
    ctx.state.allowed_paise.add(today.cards.money_held_paise)
    facts = (
        ("waiting_for_you", str(today.cards.waiting)),
        ("money_held_on_closed_orders", _money(today.cards.money_held_paise)),
        ("open_orders", str(today.cards.orders_open)),
    )
    return Output(items=tuple(items), facts=facts)


class ListQuotesArgs(_Args):
    limit: Annotated[int, Field(ge=1, le=MAX_ITEMS)] = 8
    status: Literal["draft", "approved", "rejected", "superseded"] | None = None


def list_quotes(ctx: Ctx, args: ListQuotesArgs) -> Output:
    from app.quotes import service as quote_service

    if ctx.runtime.quotes is None:
        return Output(note="unavailable")
    rows = ctx.runtime.quotes.list_quotes(ctx.token, ctx.tenant, enquiry_id=None, limit=50)
    items: list[Item] = []
    for row in rows:
        quote = quote_service.summary_out(row)
        if args.status and quote.status != args.status:
            continue
        items.append(
            ctx.state.add(
                "quote",
                quote.id,
                f"Quote {quote.quote_no} for {quote.customer or 'a customer'}",
                {
                    "status": quote.status,
                    "outcome": quote.outcome,
                    "city": quote.city,
                    "total": _money(quote.total_paise),
                    "valid_until": quote.valid_until.isoformat(),
                    "enquiry_id": str(quote.enquiry_id),
                    "typed_by_a_person": quote.pricing_kind == "manual",
                },
                ("quote", quote.id),
                money=(quote.total_paise,),
            )
        )
        if len(items) >= args.limit:
            break
    return Output(items=tuple(items))


class ListOrdersArgs(_Args):
    limit: Annotated[int, Field(ge=1, le=MAX_ITEMS)] = 8


def list_orders(ctx: Ctx, args: ListOrdersArgs) -> Output:
    rows = ctx.db.rest_rows(
        "assistant_orders",
        "/orders",
        {
            "select": "id,order_no,state,order_total_paise,advance_paise,lead:leads(company:companies(name,city))",
            "order": "created_at.desc,id.desc",
            "limit": str(args.limit),
        },
    )
    ledger: dict[str, dict[str, Any]] = {}
    if rows:
        ids = ",".join(str(r["id"]) for r in rows)
        for entry in ctx.db.rest_rows(
            "assistant_ledger",
            "/order_ledger",
            {"select": "order_id,paid_paise,refunded_paise,net_paise", "order_id": f"in.({ids})"},
        ):
            ledger[str(entry["order_id"])] = entry
    items: list[Item] = []
    for row in rows:
        customer, city = _name(row)
        led = ledger.get(str(row["id"]), {})
        paid, refunded, net = (
            int(led.get("paid_paise") or 0),
            int(led.get("refunded_paise") or 0),
            int(led.get("net_paise") or 0),
        )
        closed_lost = row["state"] in ("declined", "expired", "cancelled")
        items.append(
            ctx.state.add(
                "order",
                uuid.UUID(str(row["id"])),
                f"Order {row['order_no']} for {customer}",
                {
                    "state": row["state"],
                    "city": city,
                    "total": _money(int(row["order_total_paise"])),
                    "paid": _money(paid),
                    "refunded": _money(refunded),
                    "money_held": _money(net) if closed_lost and net > 0 else None,
                },
                ("order", uuid.UUID(str(row["id"]))),
                money=(
                    int(row["order_total_paise"]),
                    paid,
                    refunded,
                    net,
                    int(row["advance_paise"]),
                ),
            )
        )
    return Output(items=tuple(items))


class FindCustomersArgs(_Args):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]


_PHONE_QUERY = re.compile(r"^[+\d\s().\-]{6,40}$")


def _company_of_phone(ctx: Ctx, query: str) -> list[dict[str, Any]]:
    """A question that is a phone number (any way of writing it: +91, spaces, a leading 0): the company of the contact who holds it (job BO). Nothing about the number goes back to the model."""
    if not _PHONE_QUERY.fullmatch(query) or ctx.runtime.integrations is None:
        return []
    digits = normalise_phone(query)
    if digits is None or len(digits) < 6:
        return []
    try:
        hit = ctx.runtime.integrations.contact_by_phone(ctx.token, ctx.tenant, query)
    except RepositoryError:
        return []
    if not hit.get("found") or hit.get("company_id") is None:
        return []
    return ctx.db.rest_rows(
        "assistant_companies",
        "/companies",
        {"select": "id,name,city", "id": f"eq.{hit['company_id']}", "archived_at": "is.null", "limit": "1"},
    )


def find_customers(ctx: Ctx, args: FindCustomersArgs) -> Output:
    q = _like(args.query)
    if len(q) < 2:
        return Output(note="empty_query")
    companies = _company_of_phone(ctx, args.query)
    if not companies:
        companies = ctx.db.rest_rows(
            "assistant_companies",
            "/companies",
            {
                "select": "id,name,city",
                "name": f"ilike.*{q}*",
                "archived_at": "is.null",
                "order": "name.asc",
                "limit": "5",
            },
        )
    items: list[Item] = []
    if companies:
        ids = ",".join(str(c["id"]) for c in companies)
        leads = ctx.db.rest_rows(
            "assistant_leads",
            "/leads",
            {
                "select": "id,company_id,status",
                "company_id": f"in.({ids})",
                "archived_at": "is.null",
                "order": "created_at.desc",
                "limit": "10",
            },
        )
        by_company: dict[str, list[dict[str, Any]]] = {}
        for lead in leads:
            by_company.setdefault(str(lead["company_id"]), []).append(lead)
        for company in companies:
            cid = uuid.UUID(str(company["id"]))
            items.append(
                ctx.state.add(
                    "company", cid, str(company["name"])[:120], {"city": company.get("city")}
                )
            )
            for lead in by_company.get(str(company["id"]), [])[:2]:
                lid = uuid.UUID(str(lead["id"]))
                items.append(
                    ctx.state.add(
                        "lead",
                        lid,
                        f"{str(company['name'])[:100]} (lead)",
                        {"company": company["name"], "status": lead.get("status")},
                        ("lead", lid),
                    )
                )
    return Output(items=tuple(items))


class ListEnquiriesArgs(_Args):
    lead_id: uuid.UUID | None = None
    limit: Annotated[int, Field(ge=1, le=MAX_ITEMS)] = 5


def list_enquiries(ctx: Ctx, args: ListEnquiriesArgs) -> Output:
    params = {
        "select": "id,lead_id,channel,received_at,subject,body,lead:leads(company:companies(name,city))",
        "archived_at": "is.null",
        "order": "received_at.desc,id.desc",
        "limit": str(args.limit),
    }
    if args.lead_id is not None:
        params["lead_id"] = f"eq.{args.lead_id}"
    items: list[Item] = []
    for row in ctx.db.rest_rows("assistant_enquiries", "/enquiries", params):
        customer, city = _name(row)
        eid = uuid.UUID(str(row["id"]))
        items.append(
            ctx.state.add(
                "enquiry",
                eid,
                f"Enquiry from {customer} on {str(row['received_at'])[:10]}",
                {
                    "customer": customer,
                    "city": city,
                    "channel": row["channel"],
                    "lead_id": str(row["lead_id"]),
                    "subject": row.get("subject"),
                    "customer_wrote": str(row.get("body") or "")[:400],
                },
                ("enquiry", eid),
            )
        )
    return Output(items=tuple(items))


class FindPriceArgs(_Args):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]
    limit: Annotated[int, Field(ge=1, le=MAX_ITEMS)] = 6


def find_price(ctx: Ctx, args: FindPriceArgs) -> Output:
    q = _like(args.query)
    if len(q) < 2:
        return Output(note="empty_query")
    today = datetime.now(IST).date().isoformat()
    versions = ctx.db.rest_rows(
        "assistant_price_version",
        "/price_list_versions",
        {
            "select": "id",
            "effective_from": f"lte.{today}",
            "order": "effective_from.desc,version_no.desc",
            "limit": "1",
        },
    )
    if not versions:
        return Output(note="no_price_list")
    rows = ctx.db.rest_rows(
        "assistant_price_items",
        "/price_list_items",
        {
            "select": "id,sku,name,unit_price_paise,minimum_order_quantity",
            "version_id": f"eq.{versions[0]['id']}",
            "or": f"(name.ilike.*{q}*,sku.ilike.*{q}*)",
            "order": "name.asc",
            "limit": str(args.limit),
        },
    )
    items = [
        ctx.state.add(
            "price_item",
            uuid.UUID(str(r["id"])),
            f"{str(r['name'])[:100]} ({str(r['sku'])[:40]})",
            {
                "price_each": _money(int(r["unit_price_paise"])),
                "minimum_order_quantity": int(r["minimum_order_quantity"]),
            },
            money=(int(r["unit_price_paise"]),),
        )
        for r in rows
    ]
    return Output(items=tuple(items))


class ListFollowupsArgs(_Args):
    limit: Annotated[int, Field(ge=1, le=MAX_ITEMS)] = 8


def list_followups(ctx: Ctx, args: ListFollowupsArgs) -> Output:
    rows = ctx.db.rest_rows(
        "assistant_followups",
        "/followup_drafts",
        {
            "select": "id,touch_number,status,channel,lead_id,lead:leads(company:companies(name,city))",
            "status": "in.(draft,approved)",
            "order": "created_at.desc,id.desc",
            "limit": str(args.limit),
        },
    )
    items: list[Item] = []
    for row in rows:
        customer, city = _name(row)
        did = uuid.UUID(str(row["id"]))
        lid = uuid.UUID(str(row["lead_id"]))
        items.append(
            ctx.state.add(
                "followup_draft",
                did,
                f"Follow-up {row['touch_number']} for {customer}",
                {
                    "customer": customer,
                    "city": city,
                    "status": row["status"],
                    "channel": row["channel"],
                },
                ("lead", lid),
            )
        )
    return Output(items=tuple(items))


# ==================================================================================================== action tools (drafts only)
def _card(ctx: Ctx, card: DraftCardOut) -> None:
    ctx.state.drafts.append(card)


class DraftQuoteArgs(_Args):
    """No price, no line, no amount: the quote engine prices from the confirmed requirement and the owner's own price list."""

    enquiry_id: uuid.UUID
    customer_kind: Literal["new", "repeat"]
    delivery_state: Annotated[
        str, StringConstraints(min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")
    ]


def draft_quote(ctx: Ctx, args: DraftQuoteArgs) -> Output:
    from app.quotes import service as quote_service

    if ctx.runtime.quotes is None or ctx.runtime.enquiries is None:
        return Output(note="unavailable")
    enquiry = ctx.runtime.enquiries.get(ctx.token, ctx.tenant, args.enquiry_id)
    if enquiry is None:
        return Output(note="not_found")
    quote_id, _replayed = quote_service.create_draft(
        ctx.runtime.quotes,
        ctx.runtime.enquiries,
        ctx.token,
        ctx.tenant,
        enquiry,
        _derived(ctx.run_id, "quote", args.enquiry_id),
        args.customer_kind,
        args.delivery_state,
    )
    loaded = quote_service.load_quote(
        ctx.runtime.quotes, ctx.runtime.enquiries, ctx.token, ctx.tenant, quote_id
    )
    label = f"Draft quote {loaded.quote_no}" if loaded else "Draft quote"
    paise = loaded.total_paise if loaded else 0
    item = ctx.state.add(
        "quote",
        quote_id,
        label,
        {
            "status": "draft",
            "total": _money(paise),
            "priced_by": "the quote engine",
        },
        ("quote", quote_id),
        money=(paise,),
    )
    _card(
        ctx,
        DraftCardOut(
            id=quote_id,
            kind="quote",
            title=item.label,
            summary=draft_summary("quote"),
            target=OpenTarget(type="quote", id=quote_id),
        ),
    )
    return Output(items=(item,))


class DraftFollowupArgs(_Args):
    lead_id: uuid.UUID
    channel: Literal["email", "whatsapp"]


def draft_followup(ctx: Ctx, args: DraftFollowupArgs) -> Output:
    from app.followups import service as followup_service
    from app.followups.models import CreateDraftIn

    if ctx.runtime.followups is None:
        return Output(note="unavailable")
    done = followup_service.create_draft(
        ctx.runtime.followups,
        ctx.token,
        ctx.tenant,
        args.lead_id,
        CreateDraftIn(
            id=_derived(ctx.run_id, "followup", args.lead_id, args.channel), channel=args.channel
        ),
    )
    item = ctx.state.add(
        "followup_draft",
        done.draft_id,
        f"Follow-up {done.touch_number} draft",
        {"status": "draft", "channel": args.channel},
        ("lead", args.lead_id),
    )
    _card(
        ctx,
        DraftCardOut(
            id=done.draft_id,
            kind="followup_draft",
            title=item.label,
            summary=draft_summary("followup_draft"),
            target=OpenTarget(type="lead", id=args.lead_id),
        ),
    )
    return Output(items=(item,))


class DraftReplyArgs(_Args):
    """A reply to a customer, WRITTEN in the customer's language, with an English gloss for the owner. It states no price (the database refuses one)."""

    lead_id: uuid.UUID | None = None
    enquiry_id: uuid.UUID | None = None
    language: Language
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1500)]
    gloss_en: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1500)
    ]


def draft_reply(ctx: Ctx, args: DraftReplyArgs) -> Output:
    from app.assistant.language import reply_matches

    if args.lead_id is None and args.enquiry_id is None:
        return Output(note="needs_a_lead_or_enquiry")
    if not reply_matches(args.text, args.language):
        return Output(note="text_not_in_the_stated_language")
    draft_id = _derived(
        ctx.run_id, "reply", args.lead_id, args.enquiry_id, args.language, args.text
    )
    ctx.db.save_reply_draft(
        draft_id=draft_id,
        lead_id=args.lead_id,
        enquiry_id=args.enquiry_id,
        language=args.language,
        body=args.text,
        gloss_en=args.gloss_en,
    )
    open_type: Literal["enquiry", "lead"]
    open_id: uuid.UUID
    if args.enquiry_id is not None:
        open_type, open_id = "enquiry", args.enquiry_id
    elif args.lead_id is not None:
        open_type, open_id = "lead", args.lead_id
    else:  # not reachable: one of the two ids was checked above
        return Output(note="needs_a_lead_or_enquiry")
    item = ctx.state.add(
        "reply_draft",
        draft_id,
        "Reply draft (machine-written)",
        {"language": args.language, "status": "draft"},
        (open_type, open_id),
    )
    _card(
        ctx,
        DraftCardOut(
            id=draft_id,
            kind="reply_draft",
            title=item.label,
            summary=draft_summary("reply_draft", args.text),
            target=OpenTarget(type=open_type, id=open_id),
            language=args.language,
            gloss_en=args.gloss_en,
            machine_draft=True,
        ),
    )
    return Output(items=(item,))


class RecordEnquiryArgs(_Args):
    lead_id: uuid.UUID
    channel: Literal["email", "whatsapp", "phone", "walk_in", "other"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    subject: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


def record_enquiry(ctx: Ctx, args: RecordEnquiryArgs) -> Output:
    if ctx.runtime.enquiries is None or ctx.runtime.crm is None:
        return Output(note="unavailable")
    lead = ctx.runtime.crm.get_row(ctx.token, "leads", ctx.tenant, args.lead_id)
    if lead is None:
        return Output(note="not_found")
    if lead.archived_at is not None:
        return Output(note="archived")
    prepared = prepare_body(args.text)
    if not prepared.text:
        return Output(note="empty_enquiry")
    enquiry_id = _derived(ctx.run_id, "enquiry", args.lead_id, prepared.text)
    subject = prepare_subject(args.subject) if args.subject else None
    ctx.runtime.enquiries.create(
        ctx.token,
        ctx.tenant,
        {
            "id": str(enquiry_id),
            "lead_id": str(args.lead_id),
            "channel": args.channel,
            "received_at": datetime.now(UTC).isoformat(),
            "subject": subject,
            "body": prepared.text,
            "truncated_from": prepared.truncated_from,
        },
    )
    item = ctx.state.add(
        "enquiry",
        enquiry_id,
        "Enquiry recorded",
        {"channel": args.channel},
        ("enquiry", enquiry_id),
    )
    _card(
        ctx,
        DraftCardOut(
            id=enquiry_id,
            kind="enquiry",
            title=item.label,
            summary=draft_summary("enquiry"),
            target=OpenTarget(type="enquiry", id=enquiry_id),
        ),
    )
    return Output(items=(item,))


class ProposeVisitArgs(_Args):
    """A visit to the shop for a customer, as a PROPOSAL: it is booked, not confirmed, and a person confirms it. No amount, no status, no details: the person adds them on the Visits page. The shop's
    hours, slots and places are checked by the database. (Kept to three small fields: every tool is sent to the model with every question, and job AO's budget for a question is 3,400 tokens.)"""

    lead_id: uuid.UUID
    date: Annotated[str, StringConstraints(max_length=10)]
    time: Annotated[str, StringConstraints(max_length=5)]

    @field_validator("date")
    @classmethod
    def _a_calendar_date(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("date must be YYYY-MM-DD")
        return value

    @field_validator("time")
    @classmethod
    def _a_clock_time(cls, value: str) -> str:
        if not re.fullmatch(r"([01][0-9]|2[0-3]):[0-5][0-9]", value):
            raise ValueError("time must be HH:MM")
        return value


def propose_visit(ctx: Ctx, args: ProposeVisitArgs) -> Output:
    from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
    from app.tenancy.repository import Forbidden
    from app.visits import errors as visit_errors

    if ctx.runtime.visits is None:
        return Output(note="unavailable")
    try:
        datetime.strptime(args.date, "%Y-%m-%d")  # noqa: DTZ007 - a calendar date, not an instant
    except ValueError:
        return Output(note="not_a_date")
    visit_id = _derived(ctx.run_id, "visit", args.lead_id, args.date, args.time)
    try:
        ctx.runtime.visits.book(
            ctx.token,
            {
                "p_visit_id": str(visit_id),
                "p_tenant_id": str(ctx.tenant),
                "p_lead_id": str(args.lead_id),
                "p_date": args.date,
                "p_slot_start": args.time,
                "p_party_size": 1,
                "p_purpose": None,
                "p_note": None,
                "p_advance_paise": None,
                "p_source": "assistant",
            },
        )
    except visit_errors.ShopClosedError:
        return Output(note="shop_closed_that_day")
    except visit_errors.SlotInvalidError:
        return Output(note="not_a_visit_time")
    except visit_errors.SlotFullError:
        return Output(note="that_time_is_full")
    except visit_errors.PastDateError:
        return Output(note="date_has_passed")
    except visit_errors.VisitStateError:
        return Output(note="customer_already_booked_then")
    except visit_errors.CustomerErasedError:
        return Output(note="customer_erased")
    except Forbidden:
        return Output(note="not_allowed_for_this_person")
    except (InvalidReferenceError, InvalidValueError):
        return Output(note="not_found")
    except ConflictError:
        return Output(note="already_exists_with_other_details")
    item = ctx.state.add(
        "store_visit",
        visit_id,
        f"Proposed visit on {args.date} at {args.time}",
        {"status": "booked", "date": args.date, "time": args.time},
        ("store_visit", visit_id),
    )
    _card(
        ctx,
        DraftCardOut(
            id=visit_id,
            kind="store_visit",
            title=item.label,
            summary=draft_summary("store_visit"),
            target=OpenTarget(type="store_visit", id=visit_id),
        ),
    )
    return Output(items=(item,))




def _word(raw: str) -> str:
    return re.sub(r"[\s\-]+", "_", raw.strip().lower())


class FindCatalogueArgs(_Args):
    """Find the shop's sarees (fabric such as kanchi pattu or soft silk; colour; occasion; price band). Every field is optional; only active items with a photo are found. (Small on purpose: every tool is
    sent to the model with every question, so fabric and colour are plain words that the code matches to its closed lists.)"""

    fabric: Annotated[str, StringConstraints(max_length=24)] | None = None
    colour: Annotated[str, StringConstraints(max_length=12)] | None = None
    occasion: Occasion | None = None
    price_band: PriceBand | None = None
    in_stock: bool = False


def find_catalogue_items(ctx: Ctx, args: FindCatalogueArgs) -> Output:
    if ctx.runtime.catalogue is None:
        return Output(note="unavailable")
    fabric = FABRIC_ALIASES.get(_word(args.fabric)) if args.fabric else None
    if args.fabric and fabric is None:
        return Output(note="unknown_fabric")
    colour = _word(args.colour) if args.colour else None
    if colour is not None and colour not in COLOURS:
        return Output(note="unknown_colour")
    rows = ctx.runtime.catalogue.search(
        ctx.token,
        ctx.tenant,
        {
            "p_fabric": fabric,
            "p_colours": [colour] if colour else None,
            "p_occasions": [args.occasion] if args.occasion else None,
            "p_price_bands": [args.price_band] if args.price_band else None,
            "p_in_stock_only": args.in_stock,
            "p_include_inactive": False,
            "p_limit": 6,
        },
    )
    items: list[Item] = []
    for row in rows:
        item_id = uuid.UUID(str(row["id"]))
        paise = row.get("price_paise")
        exact = int(paise) if isinstance(paise, int) and not isinstance(paise, bool) else None
        fields: dict[str, str | int | None] = {
            "fabric": FABRIC_LABEL.get(str(row["fabric"]), str(row["fabric"])),
            "colours": ", ".join(row["colours"]),
            "occasions": ", ".join(row["occasions"]) or None,
            "price_band": BAND_LABEL.get(str(row["price_band"]), str(row["price_band"])),
            "price": _money(exact) if exact is not None else None,
            "stock": STOCK_LABEL.get(str(row["stock_status"]), str(row["stock_status"])),
            "photos": len(row.get("photos") or []),
        }
        items.append(
            ctx.state.add(
                "catalogue_item",
                item_id,
                str(row["name"]),
                fields,
                None,
                money=(exact,) if exact is not None else (),
            )
        )
    return Output(items=tuple(items)) if items else Output(note="no_matching_items")


class SendCatalogueArgs(_Args):
    """Queue ONE WhatsApp message to a lead with the cover photo of 1 to 4 catalogue items and a short caption in the CUSTOMER's language. The sending policy decides: a caption that mentions a price band or an
    amount waits for the owner's approval; photos without a price can go by themselves only if automatic sending is on."""

    lead_id: uuid.UUID
    item_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=4)]
    language: Language
    caption: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=300)]


def send_catalogue_items(ctx: Ctx, args: SendCatalogueArgs) -> Output:
    from app.assistant.language import reply_matches
    from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
    from app.tenancy.repository import Forbidden

    if ctx.runtime.catalogue is None or ctx.runtime.outbox is None:
        return Output(note="unavailable")
    if not reply_matches(args.caption, args.language):
        return Output(note="caption_not_in_the_stated_language")
    photos: list[uuid.UUID] = []
    for item_id in dict.fromkeys(args.item_ids):
        try:
            row = ctx.runtime.catalogue.get_item(ctx.token, ctx.tenant, item_id)
        except InvalidReferenceError:
            return Output(note="item_not_found")
        live = row.get("photos") or []
        if not row.get("active") or not live:
            return Output(note="item_not_available")
        photos.append(uuid.UUID(str(live[0]["id"])))
    message_id = _derived(
        ctx.run_id,
        "catalogue",
        args.lead_id,
        ",".join(str(p) for p in photos),
        args.language,
        args.caption,
    )
    try:
        ctx.runtime.outbox.submit(
            ctx.token,
            {
                "p_message_id": str(message_id),
                "p_tenant_id": str(ctx.tenant),
                "p_lead_id": str(args.lead_id),
                "p_channel": "whatsapp",
                "p_body": args.caption,
                "p_language": args.language,
                "p_category": "info",
                "p_source": "assistant",
                "p_model_flagged": False,
                "p_uncertain": False,
                "p_media": [str(p) for p in photos],
                "p_keep_record": False,
            },
        )
    except Forbidden:
        return Output(note="not_allowed_for_this_person")
    except (InvalidReferenceError, InvalidValueError):
        return Output(note="not_found")
    except ConflictError:
        return Output(note="already_exists_with_other_details")
    sent = ctx.runtime.outbox.get_message(ctx.token, ctx.tenant, message_id)
    status = str((sent or {}).get("status") or "queued").replace("_", " ")
    item = ctx.state.add(
        "outbox_message",
        message_id,
        f"WhatsApp message with {len(photos)} photo{'s' if len(photos) != 1 else ''} ({status})",
        {
            "status": str((row or {}).get("status") or "queued"),
            "reason": str((row or {}).get("reason") or ""),
        },
        ("outbox_message", message_id),
    )
    return Output(items=(item,))


READ_TOOLS: tuple[Tool, ...] = (
    Tool(
        "get_today",
        "Everything waiting for the owner today, money held, open orders, last order steps.",
        NoArgs,
        get_today,
    ),
    Tool(
        "list_quotes",
        "Newest quotes: customer, status, total.",
        ListQuotesArgs,
        list_quotes,
    ),
    Tool(
        "list_orders",
        "Newest orders: totals, payments, money held.",
        ListOrdersArgs,
        list_orders,
    ),
    Tool(
        "find_customers",
        "Find customers by name (also gives lead ids).",
        FindCustomersArgs,
        find_customers,
    ),
    Tool(
        "list_enquiries",
        "Newest enquiries (optionally one lead), with what the customer wrote.",
        ListEnquiriesArgs,
        list_enquiries,
    ),
    Tool(
        "find_price",
        "A product's price in the owner's price list (the only source of a price).",
        FindPriceArgs,
        find_price,
    ),
    Tool(
        "list_followups",
        "Follow-up drafts that are waiting.",
        ListFollowupsArgs,
        list_followups,
    ),
    Tool(
        "find_catalogue_items",
        "Find sarees in the shop's catalogue (fabric, colour, occasion, price band, in stock).",
        FindCatalogueArgs,
        find_catalogue_items,
    ),
)
ACTION_TOOLS: tuple[Tool, ...] = (
    Tool(
        "draft_quote",
        "Make a DRAFT quote for an enquiry. The quote engine prices it; give no price.",
        DraftQuoteArgs,
        draft_quote,
        True,
    ),
    Tool(
        "draft_followup",
        "Make a DRAFT follow-up for a lead.",
        DraftFollowupArgs,
        draft_followup,
        True,
    ),
    Tool(
        "draft_reply",
        "Save a DRAFT reply to a customer in their language, with an English gloss. No price.",
        DraftReplyArgs,
        draft_reply,
        True,
    ),
    Tool(
        "record_enquiry",
        "Record an enquiry the owner pasted, against a lead.",
        RecordEnquiryArgs,
        record_enquiry,
        True,
    ),
    Tool(
        "propose_visit",
        "Propose a store visit (YYYY-MM-DD, HH:MM India time); a person confirms.",
        ProposeVisitArgs,
        propose_visit,
        True,
    ),
    Tool(
        "send_catalogue_items",
        "Queue a WhatsApp message with 1-4 catalogue sarees' photos and a short caption to a lead; the sending policy decides.",
        SendCatalogueArgs,
        send_catalogue_items,
        True,
    ),
)
# job BP: the web tools import this module's types, so they are added here; job DG: so is the figure tool (totals and counts of a school's fees, a construction business's dues and trips)
from app.assistant.figure_tools import FIGURE_TOOLS  # noqa: E402
from app.assistant.web_tools import WEB_TOOLS  # noqa: E402

TOOLS: tuple[Tool, ...] = (*READ_TOOLS, *FIGURE_TOOLS, *ACTION_TOOLS, *WEB_TOOLS)
