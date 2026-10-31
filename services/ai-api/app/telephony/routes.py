"""The Calls page under /v1/tenants/{tenant_id}/calls (job phone-calls part 6). The contract is docs/contracts/calls.md.

  GET  /calls?state=live|finished|all&limit&cursor   Owner, Admin, Sales: live calls first, then finished, newest first; poll every `poll_after_s`
  GET  /calls/{id}                                    the call; the transcript (turn by turn) for Owner and Admin only
  POST /calls/{id}/hang-up                            Owner, Admin: end a live call

Sandbox calls say `sandbox: true`; no audio is ever kept (`recorded` is always false). The transcript and the summary are never logged.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.telephony.models import CallDetailOut, CallsOut
from app.telephony.repository import CallStateError
from app.telephony.service import CallsService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/calls", tags=["calls"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


def _service(runtime: Runtime) -> CallsService:
    if runtime.calls is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    return runtime.calls


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.get("", response_model=CallsOut)
def list_calls(ctx: Reader, runtime: RuntimeDep, response: Response, state: Literal["live", "finished", "all"] = "all", limit: Annotated[int, Query(ge=1, le=100)] = 50, cursor: str | None = None) -> CallsOut:
    response.headers["Cache-Control"] = "no-store"
    before: datetime | None = None
    if cursor:
        try:
            before = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(422, "validation_error", "That page marker is not valid.") from None
    return _service(runtime).list(ctx.principal.token, ctx.tenant.id, state, limit, before)


@router.get("/{call_id}", response_model=CallDetailOut)
def get_call(call_id: str, ctx: Reader, runtime: RuntimeDep, response: Response) -> CallDetailOut:
    response.headers["Cache-Control"] = "no-store"
    out = _service(runtime).get(ctx.principal.token, ctx.tenant.id, _id(call_id))
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        out.transcript = None   # the database already withholds it from Sales; this is the second lock
    return out


@router.post("/{call_id}/hang-up", status_code=202)
async def hang_up(call_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, str]:
    cid = _id(call_id)
    live = runtime.live_calls
    if live is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    try:
        _service(runtime).get(ctx.principal.token, ctx.tenant.id, cid)   # proves the call is this workspace's (the database raises "not found" for any other)
    except CallStateError:
        raise not_found() from None
    if not await live.hang_up(ctx.tenant.id, cid):
        raise ApiError(409, "call_not_here", "That call is not on this server, or it has already ended.")
    return {"status": "ending"}
