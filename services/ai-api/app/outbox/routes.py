"""The outbox and call requests under /v1/tenants/{tenant_id}/... (job AT, ADR 0066).

Authorization, in order, for every endpoint: a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform the action (403: a Viewer reads no message and no call
request; only Owner and Admin edit, approve, reject and dispatch; only the Owner changes the settings and decides a call); a second factor where the action needs one (403 mfa_required:
approving a message, the settings, deciding a call); then the database decides again (RLS, the policy, the blocks, the state machine).

There is NO field that names a phone number, a contact, a status, a reason or an approver: the contact is the lead's, the status and reason are the policy's, the approver is the person the
token proved. Nothing here dials a number. A message leaves only through the channel adapter, and the only adapter that exists is a local fake.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.catalogue import service as catalogue_service
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.outbox import service
from app.outbox.models import (
    CallRequestOut,
    CallRequestPageOut,
    CallRequestResultOut,
    CreateCallRequestIn,
    DecideCallIn,
    DecisionOut,
    DispatchOut,
    EditMessageIn,
    OutboxMessageOut,
    OutboxPageOut,
    OutboxSettingsIn,
    OutboxSettingsOut,
    SubmitMessageIn,
    SubmitResultOut,
)
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["outbox"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))
]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))
]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
MessageStatus = Literal["queued", "needs_approval", "sent", "blocked", "failed"]
CallStatus = Literal["requested", "approved", "rejected"]
Limit = Annotated[int, Query(ge=1, le=100)]


def _repo(runtime: Runtime) -> Any:
    if runtime.outbox is None or runtime.outbox_adapter is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    return runtime.outbox


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _urls(runtime: Runtime, ctx: TenantContext, rows: list[dict[str, Any]]) -> dict[str, str]:
    """Signed thumbnail URLs for the photos the messages carry (one batch)."""
    return catalogue_service.sign_urls(
        runtime.catalogue_storage, ctx.principal.token, service.media_photos(rows), thumbs_only=True
    )


def _message(runtime: Runtime, ctx: TenantContext, message_id: uuid.UUID) -> OutboxMessageOut:
    row = _repo(runtime).get_message(ctx.principal.token, ctx.tenant.id, message_id)
    if row is None:
        raise not_found()
    return service.message_out(row, _urls(runtime, ctx, [row]))


def _dispatch(runtime: Runtime, ctx: TenantContext) -> DispatchOut | None:
    """Owner and Admin hand due messages to the channel right after they act; anyone else leaves them for the next dispatch."""
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        return None
    repository = _repo(runtime)  # also proves the adapter exists
    adapter = runtime.outbox_adapter
    if adapter is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    return service.dispatch_due(repository, adapter, ctx.principal.token, ctx.tenant.id)


# ------------------------------------------------------------------------------------------------ messages
@router.post("/outbox/messages", response_model=SubmitResultOut)
def submit_message(body: SubmitMessageIn, ctx: SalesPlus, runtime: RuntimeDep) -> SubmitResultOut:
    """Make one message and let the policy decide: queued (goes by itself), needs_approval (a person decides) or blocked. Retrying with the same message_id replays."""
    repository = _repo(runtime)
    result = repository.submit(
        ctx.principal.token,
        {
            "p_message_id": str(body.message_id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_lead_id": str(body.lead_id),
            "p_channel": "whatsapp",
            "p_body": body.text,
            "p_language": body.language,
            "p_category": body.category,
            "p_source": body.source,
            "p_model_flagged": body.model_flagged,
            "p_uncertain": body.uncertain,
            "p_media": [str(p) for p in body.photo_ids],
            "p_keep_record": body.keep_record,
        },
    )
    replayed = result.get("replayed") is True
    dispatched = None if replayed else _dispatch(runtime, ctx)
    return SubmitResultOut(
        message=_message(runtime, ctx, body.message_id), replayed=replayed, dispatched=dispatched
    )


@router.get("/outbox/messages", response_model=OutboxPageOut)
def list_messages(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    status: MessageStatus | None = None,
    lead_id: str | None = None,
    after: str | None = None,
    limit: Limit = 30,
) -> OutboxPageOut:
    """The outbox log, newest first."""
    lead = _row_id(lead_id) if lead_id is not None else None
    rows = _repo(runtime).list_messages(
        ctx.principal.token,
        ctx.tenant.id,
        status=status,
        lead_id=lead,
        after=service.decode_cursor(after),
        limit=limit,
    )
    urls = _urls(runtime, ctx, rows)
    return OutboxPageOut(
        items=[service.message_out(r, urls) for r in rows],
        next_cursor=service.next_cursor(rows, limit),
    )


@router.get("/outbox/approvals", response_model=OutboxPageOut)
def list_approvals(
    ctx: OwnerAdmin, runtime: RuntimeDep, after: str | None = None, limit: Limit = 30
) -> OutboxPageOut:
    """The needs-approval queue, newest first (the same messages Today lists for the Owner and Admin)."""
    rows = _repo(runtime).list_messages(
        ctx.principal.token,
        ctx.tenant.id,
        status="needs_approval",
        lead_id=None,
        after=service.decode_cursor(after),
        limit=limit,
    )
    urls = _urls(runtime, ctx, rows)
    return OutboxPageOut(
        items=[service.message_out(r, urls) for r in rows],
        next_cursor=service.next_cursor(rows, limit),
    )


@router.get("/outbox/messages/{message_id}", response_model=OutboxMessageOut)
def get_message(message_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> OutboxMessageOut:
    return _message(runtime, ctx, _row_id(message_id))


@router.post("/outbox/messages/{message_id}/edit", response_model=OutboxMessageOut)
def edit_message(
    message_id: str, body: EditMessageIn, ctx: OwnerAdmin, runtime: RuntimeDep
) -> OutboxMessageOut:
    """Change the words of a message that waits for approval. It keeps waiting; the first-message disclosure line stays."""
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).edit(ctx.principal.token, ctx.tenant.id, row_id, body.text)
    return _message(runtime, ctx, row_id)


@router.post("/outbox/messages/{message_id}/approve", response_model=DecisionOut)
def approve_message(message_id: str, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> DecisionOut:
    """A person approves: the message is queued (the blocks are checked again; the policy is NOT, a person decided) and, if due, handed to the channel."""
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide(ctx.principal.token, ctx.tenant.id, row_id, "approve")
    dispatched = _dispatch(runtime, ctx)
    return DecisionOut(message=_message(runtime, ctx, row_id), dispatched=dispatched)


@router.post("/outbox/messages/{message_id}/reject", response_model=DecisionOut)
def reject_message(message_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> DecisionOut:
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide(ctx.principal.token, ctx.tenant.id, row_id, "reject")
    return DecisionOut(message=_message(runtime, ctx, row_id), dispatched=None)


@router.post("/outbox/dispatch", response_model=DispatchOut)
def dispatch(ctx: OwnerAdmin, runtime: RuntimeDep) -> DispatchOut:
    """Hand every due message to the channel (the database re-checks every block first; while the kill switch is off nothing goes)."""
    return _dispatch(runtime, ctx) or DispatchOut(sent=0, failed=0)


# ------------------------------------------------------------------------------------------------ settings
@router.get("/outbox/settings", response_model=OutboxSettingsOut)
def get_settings(ctx: OwnerAdmin, runtime: RuntimeDep) -> OutboxSettingsOut:
    return OutboxSettingsOut.model_validate(
        _repo(runtime).get_settings(ctx.principal.token, ctx.tenant.id)
    )


@router.put("/outbox/settings", response_model=OutboxSettingsOut)
def put_settings(
    body: OutboxSettingsIn, ctx: OwnerStrong, runtime: RuntimeDep
) -> OutboxSettingsOut:
    """Automatic sending on or off (off by default) and the per-customer daily limit. Owner, with a second factor."""
    repository = _repo(runtime)
    repository.set_settings(
        ctx.principal.token, ctx.tenant.id, body.auto_send_enabled, body.per_customer_daily_limit
    )
    return OutboxSettingsOut.model_validate(
        repository.get_settings(ctx.principal.token, ctx.tenant.id)
    )


# ------------------------------------------------------------------------------------------------ call requests (nothing dials)
def _call(runtime: Runtime, ctx: TenantContext, request_id: uuid.UUID) -> CallRequestOut:
    row = _repo(runtime).get_call(ctx.principal.token, ctx.tenant.id, request_id)
    if row is None:
        raise not_found()
    return service.call_out(row)


@router.post("/call-requests", response_model=CallRequestResultOut)
def create_call_request(
    body: CreateCallRequestIn, ctx: SalesPlus, runtime: RuntimeDep
) -> CallRequestResultOut:
    """Ask to phone a customer: a reason and a script draft. It is only a request until the Owner approves it; approving records the decision and dials nobody."""
    result = _repo(runtime).create_call(
        ctx.principal.token,
        {
            "p_request_id": str(body.request_id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_lead_id": str(body.lead_id),
            "p_reason": body.reason,
            "p_script_draft": body.script_draft,
            "p_language": body.language,
        },
    )
    return CallRequestResultOut(
        request=_call(runtime, ctx, body.request_id), replayed=result.get("replayed") is True
    )


@router.get("/call-requests", response_model=CallRequestPageOut)
def list_call_requests(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    status: CallStatus | None = None,
    after: str | None = None,
    limit: Limit = 30,
) -> CallRequestPageOut:
    rows = _repo(runtime).list_calls(
        ctx.principal.token,
        ctx.tenant.id,
        status=status,
        after=service.decode_cursor(after),
        limit=limit,
    )
    return CallRequestPageOut(
        items=[service.call_out(r) for r in rows], next_cursor=service.next_cursor(rows, limit)
    )


@router.get("/call-requests/{request_id}", response_model=CallRequestOut)
def get_call_request(request_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> CallRequestOut:
    return _call(runtime, ctx, _row_id(request_id))


@router.post("/call-requests/{request_id}/approve", response_model=CallRequestOut)
def approve_call_request(
    request_id: str, ctx: OwnerStrong, runtime: RuntimeDep, body: DecideCallIn | None = None
) -> CallRequestOut:
    """Only the Owner, with a second factor. The approval is recorded (who, when, the note); no call is made."""
    row_id = _row_id(request_id)
    _call(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide_call(
        ctx.principal.token, ctx.tenant.id, row_id, "approve", body.note if body else None
    )
    return _call(runtime, ctx, row_id)


@router.post("/call-requests/{request_id}/reject", response_model=CallRequestOut)
def reject_call_request(
    request_id: str, ctx: OwnerStrong, runtime: RuntimeDep, body: DecideCallIn | None = None
) -> CallRequestOut:
    row_id = _row_id(request_id)
    _call(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide_call(
        ctx.principal.token, ctx.tenant.id, row_id, "reject", body.note if body else None
    )
    return _call(runtime, ctx, row_id)
