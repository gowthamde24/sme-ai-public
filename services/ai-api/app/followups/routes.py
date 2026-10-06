"""Follow-up endpoints under /v1/tenants/{tenant_id}/... (ADR 0022; T010 part 2).

Authorization, in order, for every endpoint (as for the order routes): a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform the action (403: a Viewer reads no
touch, no draft and no policy); a second factor where the action needs one (403 mfa_required: publishing a policy, approving a draft); the lead / draft must exist FOR THIS CALLER (404
otherwise); then the database decides again (RLS, the gate, the stops, the definer functions).

There is NO endpoint that sends anything and none that takes wording, a contact, a status, a tenant or an approver from a body: the wording is the closed template the database copies, the contact
is the lead's, the approver is the person the token proved. A touch is a PERSON's record ("I sent it", "they replied"); `occurred_at` null means "now" (the database clock).

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.followups import service
from app.followups.models import (
    ApproveDraftIn,
    CreateDraftIn,
    CreatePolicyIn,
    DraftChannel,
    DraftOut,
    DraftResultOut,
    DraftStatusOut,
    DueItemOut,
    LeadFollowupOut,
    PolicyResultOut,
    PolicyVersionOut,
    QuestionDecisionOut,
    QuestionDraftOut,
    QuestionSyncOut,
    RecordSentIn,
    RecordTouchIn,
    SentResultOut,
    TouchResultOut,
)
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
OwnerAdminStrong = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))
]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
StatusFilter = Literal["draft", "approved", "discarded", "recorded_sent", "active"]


def _repo(runtime: Runtime) -> Any:
    if runtime.followups is None:
        raise ApiError(503, "followups_unavailable", "Follow-ups are not available right now.")
    return runtime.followups


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _visible_lead(runtime: Runtime, ctx: TenantContext, raw_id: str) -> uuid.UUID:
    lead = _row_id(raw_id)
    if runtime.crm.get_row(ctx.principal.token, "leads", ctx.tenant.id, lead) is None:
        raise not_found()
    return lead


def _visible_draft(runtime: Runtime, ctx: TenantContext, raw_id: str) -> uuid.UUID:
    draft = _row_id(raw_id)
    if _repo(runtime).get_draft(ctx.principal.token, ctx.tenant.id, draft) is None:
        raise not_found()
    return draft


def _visible_question(runtime: Runtime, ctx: TenantContext, raw_id: str) -> uuid.UUID:
    draft = _row_id(raw_id)
    if _repo(runtime).get_question_draft(ctx.principal.token, ctx.tenant.id, draft) is None:
        raise not_found()
    return draft


# ----------------------------------------------------------------------------- the cadence policy
@router.get("/followup-policy-versions", response_model=list[PolicyVersionOut])
def list_policies(ctx: SalesPlus, runtime: RuntimeDep) -> list[PolicyVersionOut]:
    return service.list_policies(_repo(runtime), ctx.principal.token, ctx.tenant.id)


@router.post("/followup-policy-versions", response_model=PolicyResultOut, status_code=201)
def create_policy(
    body: CreatePolicyIn, ctx: OwnerStrong, runtime: RuntimeDep, response: Response
) -> PolicyResultOut:
    """The Owner (with a second factor) publishes a cadence policy version: gaps, touch limit, quiet hours, weekdays, holidays, minimum gap and the recipient's UTC offset."""
    done = service.create_policy(_repo(runtime), ctx.principal.token, ctx.tenant.id, body)
    response.status_code = 200 if done.replayed else 201
    return done


# ----------------------------------------------------------------------------- a lead's follow-up
@router.get("/leads/{lead_id}/followup", response_model=LeadFollowupOut)
def lead_followup(
    lead_id: str,
    ctx: SalesPlus,
    runtime: RuntimeDep,
    channel: Annotated[DraftChannel, Query()] = "email",
) -> LeadFollowupOut:
    """Why the lead's follow-up is blocked or stopped (closed words), what the pinned engine says now (guidance, never approval), the touches and the drafts."""
    found = service.lead_followup(
        _repo(runtime), ctx.principal.token, ctx.tenant.id, _row_id(lead_id), channel
    )
    if found is None:
        raise not_found()
    return found


@router.post("/leads/{lead_id}/touches", response_model=TouchResultOut, status_code=201)
def record_touch(
    lead_id: str, body: RecordTouchIn, ctx: SalesPlus, runtime: RuntimeDep, response: Response
) -> TouchResultOut:
    """A person records "I sent it" (out) or "they replied" (in). Nothing is sent. An outbound touch obeys the suppression and consent gate; a reply is always recordable (except for an erased contact)."""
    lead = _visible_lead(runtime, ctx, lead_id)
    done = service.record_touch(_repo(runtime), ctx.principal.token, lead, body)
    response.status_code = 200 if done.replayed else 201
    return done


@router.post("/leads/{lead_id}/followup-drafts", response_model=DraftResultOut, status_code=201)
def create_draft(
    lead_id: str, body: CreateDraftIn, ctx: SalesPlus, runtime: RuntimeDep, response: Response
) -> DraftResultOut:
    """Ask for a follow-up DRAFT for a lead. The API runs the pinned engine on the lead's recorded state and hands the database the request and the result; the database runs the gate and the stops,
    decides itself whether a follow-up is due and copies a closed template. A person must approve it; nothing is sent."""
    done = service.create_draft(
        _repo(runtime), ctx.principal.token, ctx.tenant.id, _row_id(lead_id), body
    )
    response.status_code = 200 if done.replayed else 201
    return done


@router.get("/followups/due", response_model=list[DueItemOut])
def due(ctx: SalesPlus, runtime: RuntimeDep) -> list[DueItemOut]:
    """The leads with an outbound touch, each put to the pinned engine NOW (computed when the page is opened: there is no scheduler)."""
    return service.due_list(_repo(runtime), ctx.principal.token, ctx.tenant.id)


# ----------------------------------------------------------------------------- drafts
@router.get("/followup-drafts", response_model=list[DraftOut])
def list_drafts(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    status: Annotated[StatusFilter | None, Query()] = None,
    lead_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[DraftOut]:
    rows = _repo(runtime).list_drafts(
        ctx.principal.token, ctx.tenant.id, lead_id=lead_id, status=status, limit=limit
    )
    return [service.draft_out(r) for r in rows]


@router.get("/followup-drafts/{draft_id}", response_model=DraftOut)
def get_draft(draft_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> DraftOut:
    row = _repo(runtime).get_draft(ctx.principal.token, ctx.tenant.id, _row_id(draft_id))
    if row is None:
        raise not_found()
    return service.draft_out(row)


@router.post("/followup-drafts/{draft_id}/approve", response_model=DraftStatusOut)
def approve_draft(
    draft_id: str, body: ApproveDraftIn, ctx: OwnerAdminStrong, runtime: RuntimeDep
) -> DraftStatusOut:
    """The Owner or an Admin (with a second factor) approves the draft they reviewed (`state_hash`). The database re-checks the gate, the stops and the state."""
    draft = _visible_draft(runtime, ctx, draft_id)
    return service.approve_draft(_repo(runtime), ctx.principal.token, draft, body)


@router.post("/followup-drafts/{draft_id}/discard", response_model=DraftStatusOut)
def discard_draft(draft_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> DraftStatusOut:
    """Owner and Admin discard any draft; Sales only their own (the database says which)."""
    draft = _visible_draft(runtime, ctx, draft_id)
    return service.discard_draft(_repo(runtime), ctx.principal.token, draft)


@router.post("/followup-drafts/{draft_id}/sent", response_model=SentResultOut)
def record_sent(
    draft_id: str, body: RecordSentIn, ctx: SalesPlus, runtime: RuntimeDep, response: Response
) -> SentResultOut:
    """ "I sent it" for an APPROVED draft: a person's word, recorded as an outbound touch. The system sends nothing."""
    draft = _visible_draft(runtime, ctx, draft_id)
    done = service.record_sent(_repo(runtime), ctx.principal.token, draft, body)
    response.status_code = 200 if done.replayed else 201
    return done


# ----------------------------------------------------------------------------- question drafts
@router.get("/requirements/{requirement_id}/question-drafts", response_model=list[QuestionDraftOut])
def list_question_drafts(
    requirement_id: str,
    ctx: SalesPlus,
    runtime: RuntimeDep,
    active_only: Annotated[bool, Query()] = True,
) -> list[QuestionDraftOut]:
    rid = _row_id(requirement_id)
    if _repo(runtime).requirement_enquiry(ctx.principal.token, ctx.tenant.id, rid) is None:
        raise not_found()
    return service.question_drafts(
        _repo(runtime), ctx.principal.token, ctx.tenant.id, rid, active_only=active_only
    )


@router.post("/requirements/{requirement_id}/question-drafts/sync", response_model=QuestionSyncOut)
def sync_question_drafts(
    requirement_id: str, ctx: SalesPlus, runtime: RuntimeDep
) -> QuestionSyncOut:
    """Store the clarifying questions the closed templates derive from the requirement NOW, and resolve those no longer derived. Nothing is sent: a person approves a question, then copies it."""
    if runtime.enquiries is None:
        raise ApiError(503, "enquiries_unavailable", "Enquiries are not available right now.")
    return service.sync_questions(
        _repo(runtime),
        runtime.enquiries,
        ctx.principal.token,
        ctx.tenant.id,
        _row_id(requirement_id),
    )


@router.post("/question-drafts/{draft_id}/approve", response_model=QuestionDecisionOut)
def approve_question(draft_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QuestionDecisionOut:
    draft = _visible_question(runtime, ctx, draft_id)
    return service.decide_question(_repo(runtime), ctx.principal.token, draft, "approve")


@router.post("/question-drafts/{draft_id}/discard", response_model=QuestionDecisionOut)
def discard_question(draft_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QuestionDecisionOut:
    draft = _visible_question(runtime, ctx, draft_id)
    return service.decide_question(_repo(runtime), ctx.principal.token, draft, "discard")
