"""Reminder campaigns and the call list under /v1/tenants/{tenant_id} (job CP, ADR 0086; modules `campaigns`, `call_list`).

  GET    /campaigns?status=&after=&limit                         Owner, Admin, Sales: the campaigns, newest first.
  PUT    /campaigns/{id}                                         Owner, Admin, Sales: make or change a campaign (the id is the caller's, so a retry is safe). A change after approval sends it back to draft.
  GET    /campaigns/{id}                                         one campaign, with what still stands between a draft and its approval.
  POST   /campaigns/{id}/recipients                              add people by import (contact id or phone number), up to 5,000 rows, in parts of 500; a row that cannot be added is reported, never fatal.
  POST   /campaigns/{id}/recipients/from-ledger                  build the list from the ledger: everyone with money open on claims due in a date range.
  GET    /campaigns/{id}/recipients?after=&limit                 the list in the order it was made, with each person's own steps.
  POST   /campaigns/{id}/recipients/clear                        empty the list.      POST /campaigns/{id}/recipients/{rid}/remove   take one person off. (The API has no DELETE.)
  GET    /campaigns/{id}/preview                                 the count, the total, the dates and the RENDERED SAMPLES (first, longest, highest amount, three at random) with their hash.
  POST   /campaigns/{id}/approve                                 ONLY the Owner, with a second factor, for the samples they saw (their hash): planned steps are created; nothing is sent here.
  POST   /campaigns/{id}/pause | resume | cancel                 Owner, Admin.
  GET    /campaigns/{id}/results                                 counts by state, reason and day; replied; paid after a reminder; the call list.
  GET    /call-list?status=&after=&limit                         Owner, Admin, Sales: the people to call (never their number: the call goes through the bridge).
  POST   /call-list/{id}/outcome                                 paid | promised (a date) | call_later (a time) | wrong_number | stop.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.campaigns.errors import NOT_READY_TEXT
from app.campaigns.models import (
    PART,
    ApprovedOut,
    ApproveIn,
    CallItemOut,
    CallListOut,
    CampaignDetailOut,
    CampaignIn,
    CampaignListOut,
    CampaignOut,
    CampaignSavedOut,
    LedgerFilterIn,
    OutcomeIn,
    OutcomeRecordedOut,
    PreviewOut,
    RecipientOut,
    RecipientsAddedOut,
    RecipientsIn,
    RemovedOut,
    ResultsOut,
    SkippedOut,
)
from app.campaigns.repository import CampaignsRepository
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["campaigns"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Limit = Annotated[int, Query(ge=1, le=100)]


def _repo(runtime: Runtime) -> CampaignsRepository:
    if runtime.campaigns is None:
        raise ApiError(503, "campaigns_unavailable", "Campaigns are not available right now.")
    return runtime.campaigns


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def encode_cursor(at: datetime, row_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{at.isoformat()}|{row_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str | None) -> tuple[datetime, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        at, row_id = text.split("|", 1)
        return datetime.fromisoformat(at), uuid.UUID(row_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


def _issue_text(issues: list[str]) -> dict[str, str]:
    return {i: NOT_READY_TEXT.get(i, "Something is not ready.") for i in issues}


# ------------------------------------------------------------------------------------------------------------------------------------------------------ campaigns
@router.get("/campaigns", response_model=CampaignListOut)
def list_campaigns(
    ctx: Reader,
    runtime: RuntimeDep,
    status: Literal["draft", "approved", "running", "paused", "done", "cancelled"] | None = None,
    after: str | None = None,
    limit: Limit = 50,
) -> CampaignListOut:
    rows = _repo(runtime).list_campaigns(ctx.principal.token, ctx.tenant.id, status, limit, decode_cursor(after))
    items = [CampaignOut.model_validate(r) for r in rows]
    cursor = encode_cursor(items[-1].created_at, items[-1].id) if len(items) >= limit else None
    return CampaignListOut(items=items, next_cursor=cursor)


@router.put("/campaigns/{campaign_id}", response_model=CampaignSavedOut)
def put_campaign(campaign_id: str, body: CampaignIn, ctx: Reader, runtime: RuntimeDep) -> CampaignSavedOut:
    cid = _row_id(campaign_id)
    row = _repo(runtime).save(
        ctx.principal.token,
        {
            "p_campaign_id": str(cid),
            "p_tenant_id": str(ctx.tenant.id),
            "p_name": body.name,
            "p_kind": body.kind,
            "p_language": body.language,
            "p_wa_template_id": str(body.wa_template_id) if body.wa_template_id else None,
            "p_message_text": body.message_text,
            "p_steps": [s.model_dump() for s in body.steps],
            "p_call_after_step": body.call_after_step,
            "p_call_wait_hours": body.call_wait_hours,
        },
    )
    return CampaignSavedOut(campaign=CampaignOut.model_validate(row["campaign"]), created=row.get("created") is True, back_to_draft=row.get("back_to_draft") is True)


@router.get("/campaigns/{campaign_id}", response_model=CampaignDetailOut)
def get_campaign(campaign_id: str, ctx: Reader, runtime: RuntimeDep) -> CampaignDetailOut:
    row = _repo(runtime).get(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id))
    issues = [str(i) for i in row.get("issues") or []]
    return CampaignDetailOut.model_validate({**row, "issues": issues, "issue_text": _issue_text(issues)})


@router.post("/campaigns/{campaign_id}/recipients", response_model=RecipientsAddedOut)
def add_recipients(campaign_id: str, body: RecipientsIn, ctx: Reader, runtime: RuntimeDep) -> RecipientsAddedOut:
    """Up to 5,000 rows, run in parts of 500. The row numbers in `skipped` are the file's (1 = the first row). Adding to an approved campaign sends it back to draft."""
    repo = _repo(runtime)
    cid = _row_id(campaign_id)
    rows = [r.model_dump(mode="json", exclude_none=True) for r in body.rows]
    added = 0
    skipped: list[SkippedOut] = []
    total = 0
    for start in range(0, len(rows), PART):
        out = repo.recipients_add(ctx.principal.token, ctx.tenant.id, cid, rows[start : start + PART])
        added += int(out.get("added") or 0)
        total = int(out.get("recipients") or 0)
        for s in out.get("skipped") or []:
            skipped.append(SkippedOut(row=start + int(s["row"]), reason=str(s["reason"])))
    return RecipientsAddedOut(added=added, skipped=skipped, recipients=total)


@router.post("/campaigns/{campaign_id}/recipients/from-ledger", response_model=RecipientsAddedOut)
def add_recipients_from_ledger(campaign_id: str, body: LedgerFilterIn, ctx: Reader, runtime: RuntimeDep) -> RecipientsAddedOut:
    out = _repo(runtime).recipients_from_ledger(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id), body.model_dump(mode="json", exclude_none=True))
    return RecipientsAddedOut(
        added=int(out.get("added") or 0),
        skipped=[SkippedOut(row=int(s["row"]), reason=str(s["reason"])) for s in out.get("skipped") or []],
        recipients=int(out.get("recipients") or 0),
    )


@router.get("/campaigns/{campaign_id}/recipients", response_model=list[RecipientOut])
def list_recipients(campaign_id: str, ctx: Reader, runtime: RuntimeDep, after: Annotated[int | None, Query(ge=0)] = None, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> list[RecipientOut]:
    rows = _repo(runtime).list_recipients(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id), limit, after)
    return [RecipientOut.model_validate(r) for r in rows]


@router.post("/campaigns/{campaign_id}/recipients/clear", response_model=RemovedOut)
def clear_recipients(campaign_id: str, ctx: Reader, runtime: RuntimeDep) -> RemovedOut:
    """Empty the list (an approved campaign goes back to draft). The API has no DELETE: taking people off a draft list is an action."""
    return RemovedOut.model_validate(_repo(runtime).recipient_remove(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id), None))


@router.post("/campaigns/{campaign_id}/recipients/{recipient_id}/remove", response_model=RemovedOut)
def remove_recipient(campaign_id: str, recipient_id: str, ctx: Reader, runtime: RuntimeDep) -> RemovedOut:
    return RemovedOut.model_validate(_repo(runtime).recipient_remove(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id), _row_id(recipient_id)))


@router.get("/campaigns/{campaign_id}/preview", response_model=PreviewOut)
def preview(campaign_id: str, ctx: Reader, runtime: RuntimeDep) -> PreviewOut:
    row = _repo(runtime).preview(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id))
    issues = [str(i) for i in row.get("issues") or []]
    return PreviewOut.model_validate({**row, "issues": issues, "issue_text": _issue_text(issues)})


@router.post("/campaigns/{campaign_id}/approve", response_model=ApprovedOut)
def approve(campaign_id: str, body: ApproveIn, ctx: OwnerStrong, runtime: RuntimeDep) -> ApprovedOut:
    row = _repo(runtime).approve(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id), body.samples_sha256)
    return ApprovedOut(
        campaign=CampaignOut.model_validate(row["campaign"]),
        planned_steps=int(row.get("planned_steps") or 0),
        past_steps=int(row.get("past_steps") or 0),
        sending_on=row.get("sending_on") is True,
    )


def _state(campaign_id: str, ctx: TenantContext, runtime: Runtime, action: str) -> CampaignOut:
    return CampaignOut.model_validate(_repo(runtime).set_state(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id), action))


@router.post("/campaigns/{campaign_id}/pause", response_model=CampaignOut)
def pause(campaign_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> CampaignOut:
    return _state(campaign_id, ctx, runtime, "pause")


@router.post("/campaigns/{campaign_id}/resume", response_model=CampaignOut)
def resume(campaign_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> CampaignOut:
    return _state(campaign_id, ctx, runtime, "resume")


@router.post("/campaigns/{campaign_id}/cancel", response_model=CampaignOut)
def cancel(campaign_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> CampaignOut:
    return _state(campaign_id, ctx, runtime, "cancel")


@router.get("/campaigns/{campaign_id}/results", response_model=ResultsOut)
def results(campaign_id: str, ctx: Reader, runtime: RuntimeDep) -> ResultsOut:
    return ResultsOut.model_validate(_repo(runtime).results(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id)))


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the call list
@router.get("/call-list", response_model=CallListOut)
def call_list(ctx: Reader, runtime: RuntimeDep, status: Literal["open", "done"] = "open", after: str | None = None, limit: Limit = 50) -> CallListOut:
    rows = _repo(runtime).call_list(ctx.principal.token, ctx.tenant.id, status, limit, decode_cursor(after))
    items = [CallItemOut.model_validate(r) for r in rows]
    cursor = encode_cursor(items[-1].sort_at, items[-1].id) if len(items) >= limit else None
    return CallListOut(items=items, next_cursor=cursor)


@router.post("/call-list/{item_id}/outcome", response_model=OutcomeRecordedOut)
def record_outcome(item_id: str, body: OutcomeIn, ctx: Reader, runtime: RuntimeDep) -> OutcomeRecordedOut:
    iid = _row_id(item_id)
    row: dict[str, Any] = _repo(runtime).call_outcome(ctx.principal.token, ctx.tenant.id, iid, body.outcome, body.promised_on, body.call_after)
    return OutcomeRecordedOut.model_validate(row)
