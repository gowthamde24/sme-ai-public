"""What the connectors do between the provider and our records (job BZ, ADR 0080). A person's actions run with THEIR token, so the same row-level rules and role checks apply as anywhere else; the
rules about money and calls are the database's (public.payment_link_*, public.call_bridge_*), not these functions'."""

from __future__ import annotations

import logging
import re
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.auth.deps import Runtime, TenantContext
from app.connectors import phone as phones
from app.connectors.errors import ConnectorRefused, ProviderError
from app.connectors.indiamart import ExternalLead
from app.connectors.payments import LinkRequest
from app.connectors.repository import tenant_args
from app.connectors.runtime import Connectors
from app.crm.models import CompanyCreate, ContactCreate, LeadCreate
from app.crm.repository import DuplicateValueError, RealDataGateError
from app.errors import ApiError, not_found
from app.requirements.capture_text import prepare_body
from app.suppression import service as suppression
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.connectors.service")
_NS = uuid.UUID("0d6a2f63-6f0e-4b53-9a1e-5c1d3b1f8a77")
_SPACES = re.compile(r"\s+")


def connectors_for(runtime: Runtime, tenant: uuid.UUID, need: str) -> Connectors:
    """The connectors of this installation, for THIS workspace only. 404 for any other workspace (no hint that a connector exists), 503 when the connector is not switched on."""
    c = runtime.connectors
    if c is None or c.tenant_id != tenant:
        raise not_found()
    if not c.enabled()[need]:
        raise ApiError(503, "connector_not_available", "This is not switched on.")
    return c


def clean(text: object, limit: int) -> str:
    if not isinstance(text, str):
        return ""
    kept = "".join(" " if ch in "\t\n\r" else ch for ch in text if ch in "\t\n\r" or not unicodedata.category(ch).startswith("C"))
    return _SPACES.sub(" ", kept).strip()[:limit]


def _id(tenant: uuid.UUID, source: str, external: str, what: str) -> uuid.UUID:
    return uuid.uuid5(_NS, f"{tenant}:{source}:{external}:{what}")


# ---------------------------------------------------------------------------------------------------------------------------------- IndiaMART
def ingest_lead(runtime: Runtime, ctx: TenantContext, lead: ExternalLead, now: datetime) -> str:
    """One IndiaMART buyer as a company, a contact, a lead and an enquiry, with ids derived from the tenant and IndiaMART's own query id: pulling the same lead twice changes nothing.
    Returns 'created', 'existing', 'rejected' or 'gated'. The buyer's message is stored like a pasted enquiry (invisible characters out, contact details scrubbed) and is data, never a command."""
    token, tenant = ctx.principal.token, ctx.tenant.id
    number = phones.normalise(lead.phone)
    name = clean(lead.name, 200) or "IndiaMART Buyer"
    email = clean(lead.email, 200).lower() or None
    ids = {k: _id(tenant, "indiamart", lead.external_id, k) for k in ("company", "contact", "lead", "enquiry")}
    prepared = prepare_body(lead.message) if lead.message.strip() else None
    text = prepared.text if prepared and prepared.text else "(the buyer left no message)"
    received = min(lead.received_at or now, now)
    created = False
    try:
        company = CompanyCreate(id=ids["company"], name=name, country=(lead.country or "IN")[:2].upper() if lead.country else "IN")
        _, made = runtime.crm.create_row(token, "companies", tenant, company.model_dump(mode="json"))
        created = created or made
        contact = ContactCreate(id=ids["contact"], company_id=ids["company"], full_name=name, email=email, phone=number or (lead.phone or None))
        try:
            row, made = runtime.crm.create_row(token, "contacts", tenant, contact.model_dump(mode="json"))
        except DuplicateValueError:  # the same e-mail address is already another contact of this business: keep the number
            contact = ContactCreate(id=ids["contact"], company_id=ids["company"], full_name=name, phone=number)
            row, made = runtime.crm.create_row(token, "contacts", tenant, contact.model_dump(mode="json"))
        created = created or made
        if made:
            suppression.record_for_contact(runtime.suppression, runtime.key_ring, token, row.id, row.email, row.phone)
        lead_row = LeadCreate(id=ids["lead"], company_id=ids["company"], contact_id=ids["contact"], source="IndiaMART")
        _, made = runtime.crm.create_row(token, "leads", tenant, lead_row.model_dump(mode="json"))
        created = created or made
        if runtime.enquiries is not None:
            _, replayed = runtime.enquiries.create(
                token,
                tenant,
                {
                    "id": str(ids["enquiry"]),
                    "lead_id": str(ids["lead"]),
                    "channel": "other",
                    "received_at": received.astimezone(UTC).isoformat(),
                    "subject": "IndiaMART enquiry",
                    "body": text,
                    "truncated_from": prepared.truncated_from if prepared else None,
                },
            )
            created = created or not replayed
    except RealDataGateError:
        return "gated"  # the workspace's real-data gate is closed: a real buyer's details are not accepted yet (ADR 0015)
    except RepositoryError as exc:
        logger.warning("indiamart: a lead was refused (%s)", exc.__class__.__name__)  # the class only: never the buyer's words
        return "rejected"
    except (ValueError, TypeError):
        return "rejected"
    return "created" if created else "existing"


def pull_indiamart(runtime: Runtime, ctx: TenantContext, now: datetime | None = None) -> dict[str, Any]:
    c = connectors_for(runtime, ctx.tenant.id, "indiamart")
    token = ctx.principal.token
    window = c.repo.call(token, "indiamart_pull_begin", tenant_args(ctx.tenant.id))  # refuses a second call within five minutes
    start, end = (datetime.fromisoformat(str(window[k])) for k in ("start", "end"))
    assert c.leads is not None  # noqa: S101 - connectors_for checked it
    try:
        leads = c.leads.pull(start, end)
    except ProviderError as exc:
        raise ApiError(502, f"indiamart_{exc.code}", "IndiaMART could not be reached or refused the request.") from None
    moment = now or datetime.now(UTC)
    counts = {"created": 0, "existing": 0, "rejected": 0, "gated": 0}
    for lead in leads:
        counts[ingest_lead(runtime, ctx, lead, moment)] += 1
    if counts["gated"] == 0 and counts["rejected"] == 0:  # a window with a lead that was not taken is asked for again
        c.repo.call(token, "indiamart_pull_finish", tenant_args(ctx.tenant.id, end=end.isoformat(), count=len(leads)))
    return {"fetched": len(leads), **counts, "window_start": start, "window_end": end}


# ---------------------------------------------------------------------------------------------------------------------------------- payment links
def _provider_failure(exc: ProviderError) -> ApiError:
    if exc.code == "customer_phone_needed":
        return ApiError(422, "customer_phone_needed", "This payment service needs the customer's phone number on the contact.")
    return ApiError(502, "payment_provider_failed", "The payment service could not make the link. Nothing was sent to the customer.")


def create_payment_link(runtime: Runtime, ctx: TenantContext, order_id: uuid.UUID, link_id: uuid.UUID, amount_paise: int, hours: int, now: datetime | None = None) -> dict[str, Any]:
    c = connectors_for(runtime, ctx.tenant.id, "payments")
    assert c.payments is not None and runtime.orders is not None  # noqa: S101
    token, tenant = ctx.principal.token, ctx.tenant.id
    order = runtime.orders.get_order(token, tenant, order_id)
    if order is None:
        raise not_found()
    moment = now or datetime.now(UTC)
    expires = moment + timedelta(hours=hours)
    begun = c.repo.call(token, "payment_link_begin", tenant_args(tenant, link_id=str(link_id), order_id=str(order_id), provider=c.payments.name, amount_paise=amount_paise, expires_at=expires.isoformat()))
    link = begun["link"]
    if link["status"] != "pending":
        return dict(link)  # a replay of a link that already has its address (or has moved on)
    lead = runtime.crm.get_row(token, "leads", tenant, uuid.UUID(str(order["lead_id"])))
    contact = runtime.crm.get_row(token, "contacts", tenant, lead.contact_id) if lead is not None and lead.contact_id else None
    request = LinkRequest(
        link["reference"],
        amount_paise,
        clean(f"Order {order['order_no']} - {ctx.tenant.name}", 200),
        datetime.fromisoformat(str(link["expires_at"])),
        clean(contact.full_name, 100) if contact is not None else None,
        phones.normalise(contact.phone) if contact is not None else None,
    )
    try:
        made = c.payments.create_link(request, str(link_id))
    except ProviderError as exc:
        c.repo.call(token, "payment_link_fail", tenant_args(tenant, link_id=str(link_id)))
        raise _provider_failure(exc) from None
    attached: dict[str, Any] = c.repo.call(token, "payment_link_attach", tenant_args(tenant, link_id=str(link_id), provider_link_id=made.provider_link_id, url=made.url))
    return attached


def payment_text(language: str, amount_paise: int, order_no: int, url: str) -> str:
    from app.connectors.texts import PAY_REQUEST
    from app.today.service import format_rupees

    return PAY_REQUEST[language].format(amount=format_rupees(amount_paise), order=f"#{order_no}", url=url)


__all__ = ["ConnectorRefused", "connectors_for", "create_payment_link", "ingest_lead", "payment_text", "pull_indiamart"]
