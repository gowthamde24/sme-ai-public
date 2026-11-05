"""The assistant does the work, over HTTP (docs/contracts/assistant-tools.md sections 1 and 2; job assistant-does-the-work A2):

  POST /assistant/files                     Owner, Admin, Sales   a file dropped in the chat -> {file_id, name, size_bytes, kind, expires_at}; kept at most 24 h, read back only by whoever dropped it
  GET  /assistant/plans/{plan_id}           Owner, Admin, Sales   a plan card in its state now (the requester's; the Owner and an Admin see every plan)
  POST /assistant/plans/{plan_id}/decide    Owner, Admin, Sales   {decision: do | cancel, confirmed} -> the plan. A sensitive plan needs confirmed=true and the Owner
  POST /assistant/plans/{plan_id}/undo      Owner, Admin, Sales   the done steps that declare an undo, newest first -> the plan (the database decides who: the Owner, or whoever said "Do it")
  GET  /assistant/actions                   Owner, Admin          Settings -> Activity: the action log, newest first ({items, next_before}); never the stored undo, only its state
  POST /assistant/actions/{action_id}/undo  Owner, Admin          undo ONE logged step (its route's undo), offered for 7 days -> the entry
  POST /assistant/secrets/{request_id}      Owner                 the secure card's key -> Secret Manager ({value} -> {saved, last4}); the request is good for 15 minutes and once
  POST /assistant/setups/{setup_id}/test   Owner, Admin          a guided setup's test ({test: pull_now | send_test_mail | send_test_lead} -> {ok, reason, detail, at}); read-only or passive: nothing is sent
The files and the plans are screen-only for the assistant itself (app/assistant_tools/catalog.py: `assistant_itself`): it never calls its own doors.

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import base64
import binascii
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.assistant_work.enabled import enabled
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
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


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


def _store(runtime: Runtime, ctx: TenantContext) -> WorkStore:
    if not enabled(runtime, ctx.tenant.id):   # not this workspace's (ASSISTANT_WORK_TENANTS): as if it were not there
        raise not_found()
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
    store = _store(runtime, ctx)
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
    out = store.file_put(ctx.principal.token, ctx.tenant.id, name, content_type, kind, base64.b64encode(data).decode("ascii"))
    return {"file_id": out["file_id"], "name": out["name"], "size_bytes": out["size_bytes"], "kind": out["kind"], "expires_at": str(out["expires_at"])}


@router.get("/assistant/plans/{plan_id}")
def get_plan(plan_id: str, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    return _card(_store(runtime, ctx).plan_get(ctx.principal.token, ctx.tenant.id, _plan_id(plan_id)))


@router.post("/assistant/plans/{plan_id}/decide")
async def decide_plan(plan_id: str, body: DecideIn, request: Request, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    """The card's "Do it" or "Cancel". The steps run through the application's own routes with the caller's token (each refuses what the caller may not do: that step fails `forbidden`)."""
    runner = PlanRunner(_store(runtime, ctx), Tools(request.app))
    plan = await runner.decide(ctx.principal.token, ctx.tenant.id, _plan_id(plan_id), decision=body.decision, confirmed=body.confirmed, is_owner=ctx.role == Role.OWNER)
    return _card(plan)


@router.post("/assistant/plans/{plan_id}/undo")
async def undo_plan(plan_id: str, request: Request, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    runner = PlanRunner(_store(runtime, ctx), Tools(request.app))
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
    items = _store(runtime, ctx).actions_list(ctx.principal.token, ctx.tenant.id, since, before, limit)
    return {"items": items, "next_before": items[-1]["at"] if len(items) == limit else None}


@router.post("/assistant/actions/{action_id}/undo")
async def undo_one_action(action_id: str, request: Request, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return await undo_action(_store(runtime, ctx), Tools(request.app), ctx.principal.token, ctx.tenant.id, _plan_id(action_id))


@router.post("/assistant/secrets/{request_id}")
async def save_secret(request_id: str, request: Request, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    """The secure card's key (docs/contracts/assistant-tools.md section 2, `secret`). The body is read by hand, so a refused value is never echoed back in a validation error; the key is never
    logged, stored in the database, put in a turn or shown again (only its last four characters)."""
    from app.assistant_work.store import PlanExpiredError, PlanStateError
    from app.crm.repository import NotFoundError
    from app.workspace_secrets import SecretStoreError, clean_value

    secrets = getattr(runtime, "workspace_secrets", None)
    if secrets is None:
        raise ApiError(503, "secrets_unavailable", "Keys can't be saved here yet.")
    try:
        body = await request.json()
    except ValueError:
        body = None
    value = clean_value(body.get("value") if isinstance(body, dict) and set(body) == {"value"} else None)
    if value is None:
        raise ApiError(422, "secret_invalid", "That doesn't look like a key: 8 to 200 letters, digits and . _ - + / = : ~, without spaces.")
    try:
        return dict(await asyncio.to_thread(secrets.save, ctx.principal.token, ctx.tenant.id, _plan_id(request_id), value))
    except NotFoundError:
        raise not_found() from None
    except PlanStateError:
        raise ApiError(409, "secret_request_used", "This card was already used. Ask me again for a new one.") from None
    except PlanExpiredError:
        raise ApiError(410, "secret_request_expired", "This card is older than 15 minutes. Ask me again for a new one.") from None
    except SecretStoreError:
        raise ApiError(503, "secret_not_saved", "The key could not be saved right now. Nothing was kept; ask me again for a new card.") from None


class SetupTestIn(_Strict):
    test: Literal["pull_now", "send_test_mail", "send_test_lead"]


_TEST_OF = {"indiamart": "pull_now", "email_forward": "send_test_mail", "website_form": "send_test_lead"}


@router.post("/assistant/setups/{setup_id}/test")
async def run_setup_test(setup_id: str, body: SetupTestIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    """A guided setup's test (docs/contracts/assistant-tools.md section 2, `setup`). The setup id is the workspace's own (made from the workspace and the kind), so another workspace's id is
    not found. pull_now: IndiaMART with the workspace's own key (a check only while the workspace takes example data); the other two look at what has arrived: nothing is sent to anyone."""
    from app.assistant_work import setups
    from app.lead_sources import indiamart
    from app.lead_sources.routes import _service

    _store(runtime, ctx)   # the workspace switch: not this workspace's, not found
    kind = setups.kind_of(ctx.tenant.id, _plan_id(setup_id))
    if kind is None or _TEST_OF.get(kind) != body.test:
        raise not_found()
    service = _service(runtime)
    if body.test == "pull_now":
        got = await asyncio.to_thread(indiamart.check, runtime, service, ctx)
        return setups.result(bool(got["ok"]), got.get("reason"), str(got["detail"]))
    sources = await asyncio.to_thread(service.sources, ctx.principal.token, ctx.tenant.id)
    if body.test == "send_test_mail":
        return setups.received_test(sources, "email_forward", "forwarding address")
    return setups.received_test(sources, "website_form", "website form")
