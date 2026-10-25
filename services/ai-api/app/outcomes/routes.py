"""Outcomes under /v1/tenants/{tenant_id}/outcomes (job DM, C1 part). The contract is packages/contracts/outcomes.* and docs/contracts/outcomes.md.

  GET   /outcomes                    newest first; `contact_id` = the customer's timeline, `day` = one India day, both optional; `limit` (1 to 100) and `cursor` page it. Any member.
  GET   /outcomes/totals             per India day, zero-filled (`from`, `to`; both default to today; at most 92 days) with the total. Any member. Today's "[N] positive . [N] not interested".
  POST  /outcomes                    record one (Owner, Admin, Sales). The AI's own recording of a WhatsApp follow-up's outcome goes through the registered channel account (see app/outcomes/recorder.py).
  PATCH /outcomes/{outcome_id}       the owner (or an admin) corrects the outcome, the category or the reason; what the AI said is kept.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.outcomes.models import OutcomeCorrectionIn, OutcomeIn, OutcomeListOut, OutcomeOut, OutcomeRecordedOut, OutcomeTotalsOut
from app.outcomes.repository import OutcomesRepository
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/outcomes", tags=["outcomes"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Sales = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]


def _repo(runtime: Runtime) -> OutcomesRepository:
    if runtime.outcomes is None:
        raise ApiError(503, "outcomes_unavailable", "Outcomes are not available right now.")
    return runtime.outcomes


def encode_cursor(at: datetime, row_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{at.isoformat()}|{row_id}".encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        at, row_id = raw.split("|", 1)
        return datetime.fromisoformat(at), uuid.UUID(row_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "invalid_cursor", "That page marker is not valid.") from None


@router.get("", response_model=OutcomeListOut)
def list_outcomes(
    ctx: AnyMember,
    runtime: RuntimeDep,
    contact_id: Annotated[str | None, Query()] = None,
    day: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> OutcomeListOut:
    contact = parse_uuid(contact_id) if contact_id else None
    if contact_id and contact is None:
        raise not_found()
    answer = _repo(runtime).list(ctx.principal.token, ctx.tenant.id, contact, day, limit, decode_cursor(cursor) if cursor else None)
    items = [OutcomeOut.model_validate(r) for r in answer.get("items", [])]
    has_more = bool(answer.get("has_more"))
    return OutcomeListOut(items=items, has_more=has_more, next_cursor=encode_cursor(items[-1].occurred_at, items[-1].id) if has_more and items else None)


@router.get("/totals", response_model=OutcomeTotalsOut)
def totals(
    ctx: AnyMember,
    runtime: RuntimeDep,
    from_day: Annotated[date | None, Query(alias="from")] = None,
    to_day: Annotated[date | None, Query(alias="to")] = None,
) -> OutcomeTotalsOut:
    return OutcomeTotalsOut.model_validate(_repo(runtime).totals(ctx.principal.token, ctx.tenant.id, from_day, to_day))


@router.post("", response_model=OutcomeRecordedOut, status_code=201)
def record(body: OutcomeIn, ctx: Sales, runtime: RuntimeDep) -> OutcomeRecordedOut:
    return OutcomeRecordedOut.model_validate(_repo(runtime).record(ctx.principal.token, ctx.tenant.id, body.model_dump()))


@router.patch("/{outcome_id}", response_model=OutcomeOut)
def correct(outcome_id: str, body: OutcomeCorrectionIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> OutcomeOut:
    parsed = parse_uuid(outcome_id)
    if parsed is None:
        raise not_found()
    return OutcomeOut.model_validate(_repo(runtime).correct(ctx.principal.token, ctx.tenant.id, parsed, body.outcome, body.category, body.reason))
