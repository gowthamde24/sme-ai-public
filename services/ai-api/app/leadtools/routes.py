"""Two lead tools under /v1/tenants/{tenant_id}/leads/... (job AY).

  GET  /leads/search?q=             find a lead by the customer's (company) name, the contact's name, or the END of a phone number (4 or more digits), newest first, paged
  POST /leads/{lead_id}/draft-message   Agent OWL suggests a WhatsApp message for the lead, in the lead's language, with an English gloss

Authorization, in order: a valid JWT (401); membership of the tenant in the PATH (404); a role (403: every member may search, as every member reads leads; Owner, Admin and Sales draft a message); then
the database decides again. The search never returns a phone number, only its last four digits. The draft is a SUGGESTION: it is not saved as a draft card and not sent; the person edits it and sends it
through the outbox (POST /outbox/messages), where the send policy decides. It is a run of the assistant and counts against AI usage.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from app.assistant import draft as draft_module
from app.assistant.language import Language
from app.assistant.routes import _refusal
from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.display_name import real_name
from app.errors import ApiError, not_found
from app.outbox import service as outbox_service
from app.tenancy.models import Role
from app.tenancy.repository import UpstreamError
from app.visits.service import short_name

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["leads"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LeadHitOut(_Strict):
    lead_id: uuid.UUID
    # the customer's business name and city (null when the lead has no company)
    customer: str | None
    city: str | None
    # the contact's short name ("Priya S."); never the whole name, never an e-mail
    contact_name: str | None
    # the last four digits of the contact's phone, to tell two people apart; never the number
    phone_last4: str | None
    created_at: datetime


class LeadSearchOut(_Strict):
    items: list[LeadHitOut]
    next_cursor: str | None


class DraftMessageIn(_Strict):
    # leave out to use the language of the customer's latest message (English when there is none)
    language: Language | None = None


class DraftMessageOut(_Strict):
    lead_id: uuid.UUID
    text: str
    language: Language
    gloss_en: str
    # always true: a machine wrote it. Check and edit it, then send it through the outbox.
    machine_draft: Literal[True] = True


def _search_repo(runtime: Runtime) -> Any:
    if runtime.lead_search is None:
        raise ApiError(503, "lead_search_unavailable", "Search is not available right now.")
    return runtime.lead_search


@router.get("/leads/search", response_model=LeadSearchOut)
def search_leads(
    ctx: AnyMember,
    runtime: RuntimeDep,
    q: Annotated[str, Query(min_length=2, max_length=60)],
    after: Annotated[str | None, Query(max_length=300)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> LeadSearchOut:
    """Find a lead for the booking search: part of the company's name, part of the contact's name, or the last 4 or more digits of the phone number. Newest first; `next_cursor` continues."""
    cursor = outbox_service.decode_cursor(after)
    rows = _search_repo(runtime).search(ctx.principal.token, ctx.tenant.id, q, limit, cursor)
    try:
        items = [
            LeadHitOut(
                lead_id=r["lead_id"],
                customer=real_name(r.get("company")),
                city=r.get("city"),
                contact_name=short_name(r.get("contact_name")),
                phone_last4=r.get("phone_last4"),
                created_at=r["created_at"],
            )
            for r in rows
        ]
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected lead search row") from None
    next_cursor = (
        outbox_service.encode_cursor(
            str(rows[-1]["created_at"]), uuid.UUID(str(rows[-1]["lead_id"]))
        )
        if len(rows) >= limit
        else None
    )
    return LeadSearchOut(items=items, next_cursor=next_cursor)


@router.post("/leads/{lead_id}/draft-message", response_model=DraftMessageOut)
def draft_message(
    lead_id: str, body: DraftMessageIn, ctx: SalesPlus, runtime: RuntimeDep
) -> DraftMessageOut:
    """Agent OWL writes a suggested WhatsApp message for this lead (a suggestion only: nothing is saved or sent)."""
    parsed = parse_uuid(lead_id)
    if parsed is None:
        raise not_found()
    suggestion = draft_module.draft_for_lead(
        runtime,
        ctx.principal.token,
        ctx.tenant.id,
        parsed,
        body.language,
        lambda exc: _refusal(exc, runtime.today, ctx.principal.token, ctx.tenant.id),
    )
    return DraftMessageOut(
        lead_id=parsed,
        text=suggestion.text,
        language=suggestion.language,
        gloss_en=suggestion.gloss_en,
    )
