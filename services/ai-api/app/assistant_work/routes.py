"""The assistant does the work, over HTTP (docs/contracts/assistant-tools.md sections 1 and 2; job assistant-does-the-work A2):

  POST /assistant/files                     Owner, Admin, Sales   a file dropped in the chat -> {file_id, name, size_bytes, kind, expires_at}; kept at most 24 h, read back only by whoever dropped it
  GET  /assistant/plans/{plan_id}           Owner, Admin, Sales   a plan card in its state now (the requester's; the Owner and an Admin see every plan)
  POST /assistant/plans/{plan_id}/decide    Owner, Admin, Sales   {decision: do | cancel, confirmed} -> the plan. A sensitive plan needs confirmed=true and the Owner
  POST /assistant/plans/{plan_id}/undo      Owner, Admin, Sales   the done steps that declare an undo, newest first -> the plan (the database decides who: the Owner, or whoever said "Do it")
  GET  /assistant/actions                   Owner, Admin          Settings -> Activity: the action log, newest first ({items, next_before}); never the stored undo, only its state
  POST /assistant/actions/{action_id}/undo  Owner, Admin          undo ONE logged step (its route's undo), offered for 7 days -> the entry
The files and the plans are screen-only for the assistant itself (app/assistant_tools/catalog.py: `assistant_itself`): it never calls its own doors.

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import base64
import binascii
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.assistant_work.files import MAX_FILE_BYTES, clean_name, content_type_of, kind_of
from app.assistant_work.service import PlanRunner, Tools, public_plan, undo_action
from app.assistant_work.store import WorkStore
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Worker = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FileIn(_Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    content_type: Annotated[str, StringConstraints(max_length=200)] = "application/octet-stream"
    size_bytes: Annotated[int, Field(ge=0, le=MAX_FILE_BYTES * 2)]
    data_base64: Annotated[str, Field(max_length=MAX_FILE_BYTES * 4 // 3 + 16)]


class FileOut(_Strict):
    file_id: uuid.UUID
    name: str
    size_bytes: int
    kind: Literal["sheet", "pdf", "image", "doc", "contacts", "text"]
    expires_at: str


class DecideIn(_Strict):
    decision: Literal["do", "cancel"]
    confirmed: bool = False


def _store(runtime: Runtime) -> WorkStore:
    store: WorkStore | None = getattr(runtime, "assistant_work", None)
    if store is None:
        raise ApiError(503, "assistant_work_unavailable", "This is not available right now.")
    return store


def _plan_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _card(plan: dict[str, Any]) -> dict[str, Any]:
    return public_plan(plan)


@router.post("/assistant/files", response_model=FileOut, status_code=201)
def drop_file(body: FileIn, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    """A file dropped in the chat. Nothing is read or written anywhere else: the turn that names it decides what it is and what to propose."""
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "file_empty", "That file could not be read.") from None
    if not data:
        raise ApiError(422, "file_empty", "That file is empty.")
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(413, "file_too_large", "That file is too big (at most 10 MB).")
    name = clean_name(body.name)
    content_type = content_type_of(body.content_type)
    kind = kind_of(name, content_type, data[:64])
    if kind is None:
        raise ApiError(415, "file_type", "That kind of file is not taken here. A sheet (.xlsx, .csv), a contacts file (.vcf), a PDF, a picture, a document or a text file works.")
    out = _store(runtime).file_put(ctx.principal.token, ctx.tenant.id, name, content_type, kind, base64.b64encode(data).decode("ascii"))
    return {"file_id": out["file_id"], "name": out["name"], "size_bytes": out["size_bytes"], "kind": out["kind"], "expires_at": str(out["expires_at"])}


@router.get("/assistant/plans/{plan_id}")
def get_plan(plan_id: str, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    return _card(_store(runtime).plan_get(ctx.principal.token, ctx.tenant.id, _plan_id(plan_id)))


@router.post("/assistant/plans/{plan_id}/decide")
async def decide_plan(plan_id: str, body: DecideIn, request: Request, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    """The card's "Do it" or "Cancel". The steps run through the application's own routes with the caller's token (each refuses what the caller may not do: that step fails `forbidden`)."""
    runner = PlanRunner(_store(runtime), Tools(request.app))
    plan = await runner.decide(ctx.principal.token, ctx.tenant.id, _plan_id(plan_id), decision=body.decision, confirmed=body.confirmed, is_owner=ctx.role == Role.OWNER)
    return _card(plan)


@router.post("/assistant/plans/{plan_id}/undo")
async def undo_plan(plan_id: str, request: Request, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    runner = PlanRunner(_store(runtime), Tools(request.app))
    return _card(await runner.undo(ctx.principal.token, ctx.tenant.id, _plan_id(plan_id)))


@router.get("/assistant/actions")
def list_actions(ctx: Manager, runtime: RuntimeDep, since: Annotated[str | None, Query(max_length=40)] = None, before: Annotated[str | None, Query(max_length=40)] = None,
                 limit: Annotated[int, Query(ge=1, le=100)] = 50) -> dict[str, Any]:
    """Every entry is "by the assistant, on <requested_by>'s request", with the chat message it came from. `next_before`: pass it as `before` for the next page."""
    for value in (since, before):
        if value is not None:
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                raise ApiError(422, "validation_error", "since and before are ISO times.") from None
    items = _store(runtime).actions_list(ctx.principal.token, ctx.tenant.id, since, before, limit)
    return {"items": items, "next_before": items[-1]["at"] if len(items) == limit else None}


@router.post("/assistant/actions/{action_id}/undo")
async def undo_one_action(action_id: str, request: Request, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return await undo_action(_store(runtime), Tools(request.app), ctx.principal.token, ctx.tenant.id, _plan_id(action_id))
