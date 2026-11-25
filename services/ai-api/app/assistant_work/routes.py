"""The assistant does the work, over HTTP (docs/contracts/assistant-tools.md sections 1 and 2; job assistant-does-the-work A2):

  POST /assistant/files                     Owner, Admin, Sales   a file dropped in the chat -> {file_id, name, size_bytes, kind, expires_at}; kept at most 24 h, read back only by whoever dropped it
  GET  /assistant/imports/{id}              Owner, Admin, Sales   the editable import preview (file import v2, docs/contracts/file-import.md): the card with a page of rows
  PATCH /assistant/imports/{id}/rows        Owner, Admin, Sales   cell edits and include choices -> {counts}
  PATCH /assistant/imports/{id}             Owner, Admin, Sales   {destination: leads | catalogue | prices} -> the card again
  POST /assistant/imports/{id}/confirm      Owner, Admin, Sales   {consent_source?, exclude_row_ids?} -> {plan: <plan card>}; nothing is written until its "Do it"
  POST /assistant/imports/{id}/cancel       Owner, Admin, Sales   cancels and deletes the rows and the original at once -> {state: cancelled}
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

from app.assistant.language import Language
from app.assistant_work import imports as imp
from app.assistant_work.enabled import enabled
from app.assistant_work.files import (
    MAX_FILE_BYTES,
    clean_name,
    content_type_of,
    kind_of,
    looks_unsafe,
)
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
        raise ApiError(413, "file_too_large", "That file is too big (at most 15 MB).")
    name = clean_name(body.name)
    content_type = content_type_of(body.content_type)
    kind = kind_of(name, content_type, data[:64])
    if kind is None:
        raise ApiError(415, "file_type", "That kind of file is not taken here. A sheet (.xlsx, .csv), a contacts file (.vcf), a PDF, a picture, a document or a text file works.")
    if looks_unsafe(kind, data):
        raise ApiError(422, "file_unsafe", "That file looks unsafe (it carries a program or macros), so it was not kept.")
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
        return setups.received_test(sources, "email_forward", "lead e-mail address")
    return setups.received_test(sources, "website_form", "website form")


# ---------------------------------------------------------------------------------------------------------------------------------- the editable import preview (file import v2)
class CellEdit(_Strict):
    row_id: Annotated[str, StringConstraints(min_length=1, max_length=20)]
    cell: Annotated[str, StringConstraints(min_length=1, max_length=20)]
    value: Annotated[str, StringConstraints(max_length=imp.MAX_CELL)]


class IncludeChoice(_Strict):
    row_id: Annotated[str, StringConstraints(min_length=1, max_length=20)]
    include: bool


class RowsIn(_Strict):
    edits: Annotated[list[CellEdit], Field(max_length=500)] = Field(default_factory=list)
    include: Annotated[list[IncludeChoice], Field(max_length=imp.MAX_ROWS)] = Field(default_factory=list)


class DestinationIn(_Strict):
    destination: Literal["leads", "catalogue", "prices"]


class ConfirmIn(_Strict):
    consent_source: Literal["walk_in", "asked_us", "existing_customer"] | None = None
    exclude_row_ids: Annotated[list[Annotated[str, StringConstraints(max_length=20)]], Field(max_length=imp.MAX_ROWS)] = Field(default_factory=list)


def _language_of(value: object) -> Language:
    return value if value in ("en", "te", "hi", "kn", "ta", "ml", "mr") else "en"


def _nothing(card: dict[str, Any] | None, language: Language, name: str) -> ApiError:
    """Why "Add" has nothing to add, in plain words: the import itself refused the numbers (a workspace that does not take real numbers yet), or they are all in the leads already."""
    from app.assistant_work.service import words

    facts = {str(f.get("code")): int(f.get("n") or 0) for f in ((card or {}).get("facts") or [])}
    if facts.get("unreadable") and not facts.get("found"):
        return ApiError(422, "real_data_not_open", words("not_open", language))
    if facts.get("existing") and facts.get("existing") == facts.get("found"):
        return ApiError(422, "nothing_to_add", words("nothing_new", language, name=name, found=facts["existing"]))
    return ApiError(422, "nothing_to_add", words("nobody", language, name=name))


def _imports(runtime: Runtime, ctx: TenantContext) -> imp.Imports:
    return imp.Imports(_store(runtime, ctx))


def _import_id(raw: str) -> uuid.UUID:
    return _plan_id(raw)


def _refused(exc: Exception) -> ApiError:
    if isinstance(exc, imp.ImportGone):
        return not_found()
    if isinstance(exc, imp.ImportState):
        return ApiError(409, "import_state", "That import is not in a state that allows this (it was added or cancelled already).")
    if isinstance(exc, imp.ConsentNeeded):
        return ApiError(422, "consent_source_required", "Say how these people agreed to be contacted (they walked in, they asked us, or they are existing customers).")
    return ApiError(422, "validation_error", "That edit cannot be applied.")


@router.get("/assistant/imports/{import_id}")
def get_import(import_id: str, ctx: Worker, runtime: RuntimeDep, cursor: Annotated[str | None, Query(max_length=10)] = None, limit: Annotated[int, Query(ge=1, le=200)] = imp.PAGE) -> dict[str, Any]:
    try:
        state = _imports(runtime, ctx).get(ctx.principal.token, ctx.tenant.id, _import_id(import_id))
    except (imp.ImportGone, imp.ImportState, imp.BadEdit) as exc:
        raise _refused(exc) from None
    return imp.Imports.card(state, cursor, limit)


@router.patch("/assistant/imports/{import_id}/rows")
def patch_import_rows(import_id: str, body: RowsIn, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    try:
        counts = _imports(runtime, ctx).patch_rows(ctx.principal.token, ctx.tenant.id, _import_id(import_id), [e.model_dump() for e in body.edits], [i.model_dump() for i in body.include])
    except (imp.ImportGone, imp.ImportState, imp.BadEdit) as exc:
        raise _refused(exc) from None
    return {"counts": counts}


@router.patch("/assistant/imports/{import_id}")
def patch_import(import_id: str, body: DestinationIn, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    try:
        state = _imports(runtime, ctx).set_destination(ctx.principal.token, ctx.tenant.id, _import_id(import_id), body.destination)
    except (imp.ImportGone, imp.ImportState, imp.BadEdit) as exc:
        raise _refused(exc) from None
    return imp.Imports.card(state)


@router.post("/assistant/imports/{import_id}/cancel")
def cancel_import(import_id: str, ctx: Worker, runtime: RuntimeDep) -> dict[str, str]:
    """Cancels the import and deletes its rows and the original at once. (A POST: the API has no HTTP DELETE anywhere, a rule of the project.)"""
    _imports(runtime, ctx).cancel(ctx.principal.token, ctx.tenant.id, _import_id(import_id))
    return {"state": "cancelled"}


@router.post("/assistant/imports/{import_id}/confirm")
def confirm_import(import_id: str, body: ConfirmIn, request: Request, ctx: Worker, runtime: RuntimeDep) -> dict[str, Any]:
    """The edited rows become the usual plan card ("Add 23 leads"); the plan's "Do it" writes them. Leads need the consent source; the people already in the leads are never doubled."""
    from app.assistant_work.service import FileTurn, words
    from app.assistant_work.understand import Understanding

    imports = _imports(runtime, ctx)
    token, tenant, iid = ctx.principal.token, ctx.tenant.id, _import_id(import_id)
    try:
        state = imports.get(token, tenant, iid)
        if state["state"] != "ready":
            raise imp.ImportState
        excluded = set(body.exclude_row_ids)
        for row in state["rows"]:
            if row["row_id"] in excluded:
                row["include"] = False
        language = _language_of(state.get("language"))
        store = _store(runtime, ctx)
        turn = FileTurn(store, Tools(request.app), runtime.lead_sources, reader=getattr(runtime, "assistant_file_reader", None))
        message_id = uuid.uuid4()
        if state["destination"] == "leads":
            if body.consent_source is None:
                raise imp.ConsentNeeded
            consent = imp.consent_for(body.consent_source, state["file_name"])
            sheet = imp.included_leads(state)
            if len(sheet) < 2:
                raise ApiError(422, "nothing_to_add", words("nobody", language, name=state["file_name"]))
            blob = base64.b64encode("\n".join(",".join('"' + c.replace('"', '""') + '"' for c in r) for r in sheet).encode("utf-8")).decode("ascii")
            derived = store.file_put(token, tenant, state["file_name"].rsplit(".", 1)[0][:190] + ".csv", "text/csv", "sheet", blob)
            _sentence, card = turn._lead_list(token, tenant, uuid.UUID(str(derived["file_id"])), state["file_name"], "sheet", blob, message_id=message_id, conversation_id=None, language=language,
                                              read_by=state["read_by"], consent=consent)
            if card is None or not isinstance(card.get("plan"), dict):
                raise _nothing(card, language, state["file_name"])
        elif state["destination"] == "prices":
            rows = [[r["cells"]["item"]["value"], r["cells"]["price"]["value"]] for r in state["rows"] if r["include"] and not r["flags"]["missing_required"]]
            if not rows:
                raise ApiError(422, "nothing_to_add", words("nobody", language, name=state["file_name"]))
            understood = Understanding(file_name=state["file_name"], read_by=state["read_by"], kind="price_list", text="", tables=[[["Item", "Price"], *rows]])
            _sentence, card = turn._prices(token, tenant, uuid.uuid4(), state["file_name"], "doc", understood, uuid.uuid4(), message_id=message_id, conversation_id=None, language=language)   # (a made-up file id: the price plan drops the file it was read from, and that must not be the import's own state)
            if card is None or not isinstance(card.get("plan"), dict):
                raise ApiError(422, "nothing_to_add", _sentence)
        else:
            raise ApiError(422, "not_yet", "New catalogue items cannot be added from a file here yet. Choose Prices to change the prices of items you already have.")
        plan_card = card["plan"]
        imports.mark(token, tenant, iid, state, status="importing", plan_id=uuid.UUID(str(plan_card["plan_id"])) if plan_card.get("plan_id") else None, consent=body.consent_source)
    except (imp.ImportGone, imp.ImportState, imp.ConsentNeeded, imp.BadEdit) as exc:
        raise _refused(exc) from None
    return {"plan": plan_card}
