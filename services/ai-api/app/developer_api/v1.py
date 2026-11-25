"""The developer API v1, part D2 (docs/contracts/developer-api.md): GET /me, calls (with dry_run and Idempotency-Key), campaigns and the API activity log. TEST MODE only: a call is simulated,
nobody is dialled, nothing is sent. The same key check, rate limit and Stack19-Mode headers as part D1 (routes.py), and the same activity log.

  GET  /api/v1/me                   any live key
  POST /api/v1/calls                calls:write    {lead_id, dry_run?}   Idempotency-Key required unless dry_run; dry_run checks every gate and places nothing
  GET  /api/v1/calls/{call_id}      calls:read
  GET  /api/v1/calls                calls:read     ?lead_id=&limit=&after=
  POST /api/v1/campaigns            campaigns:write  {name, language?, job: {name, goal?}, contacts: [<lead body>, ... at most 500]}   Idempotency-Key required
  GET  /api/v1/campaigns/{id}       campaigns:read
  GET  /api/v1/campaigns            campaigns:read ?limit=&after=
  GET  /api/v1/activity             usage:read     ?limit=&before=   the workspace's requests of the last 30 days

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Header, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.developer_api import gates as G
from app.developer_api import keys as K
from app.developer_api.activity import ActivityRoute
from app.developer_api.routes import (
    MODE,
    LeadIn,
    RuntimeDep,
    _authorize,
    _cursor,
    _refused,
    _service,
    next_cursor,
)
from app.developer_api.schemas import CallIn, CampaignIn
from app.errors import ApiError, not_found

v1_router = APIRouter(prefix="/api/v1", tags=["developer-api"], route_class=ActivityRoute)
Idem = Annotated[str | None, Header(alias="Idempotency-Key")]


def _reply(response: Response, payload: Any, status: int = 200, extra: dict[str, str] | None = None) -> JSONResponse:
    headers = {k: v for k, v in response.headers.items() if k.lower().startswith(("x-ratelimit", "stack19"))}
    return JSONResponse(payload, status_code=status, headers={**headers, **(extra or {})})


def _idem(raw: str | None) -> str:
    idem = (raw or "").strip()
    if not 1 <= len(idem) <= 100 or not idem.isprintable():
        raise _refused(400, "idempotency_key_required", "Send an Idempotency-Key header (1 to 100 characters), the same one when you retry.")
    return idem


def _uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise not_found() from None


def _fields(exc: ValidationError) -> list[str]:
    return sorted({".".join(str(p) for p in e["loc"]) for e in exc.errors()})[:10]


# ============================================================================ me
@v1_router.get("/me", operation_id="getMe", summary="The key and the workspace it belongs to")
async def me(request: Request, response: Response, runtime: RuntimeDep) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, None)
    got = await asyncio.to_thread(_service(runtime).repo.me, caller.worker, caller.key_hash)
    if got is None:
        raise _refused(401, "invalid_key", "This key is not valid (unknown, rotated or revoked).", {"WWW-Authenticate": "Bearer"})
    return dict(got)


# ============================================================================ calls
@v1_router.post("/calls", status_code=201, operation_id="createCall", summary="Place a simulated call to a lead (idempotent); dry_run only checks")
async def create_call(request: Request, response: Response, runtime: RuntimeDep, body: Annotated[dict[str, Any], Body()], idempotency_key: Idem = None) -> Any:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "calls:write")
    try:
        data = CallIn.model_validate(body)
        lead_id = uuid.UUID(data.lead_id)
    except (ValidationError, ValueError) as exc:
        fields = _fields(exc) if isinstance(exc, ValidationError) else ["lead_id"]
        raise ApiError(422, "invalid_call", "Send a lead_id (the id of a lead you posted) and, if you like, dry_run: true.", headers=MODE, extra={"fields": fields}) from None
    idem = "" if data.dry_run else _idem(idempotency_key)   # a dry run stores nothing, so it needs no key
    repo = _service(runtime).repo
    ctx = await asyncio.to_thread(repo.call_context, caller.worker, caller.key_hash, lead_id)
    now = datetime.now(UTC)
    plan = G.plan(ctx.get("lead"), int(ctx.get("active_calls") or 0), int(ctx.get("calls_last_minute") or 0), now)
    if ctx.get("lead") is None:
        raise not_found()
    if data.dry_run:   # every gate is shown and nobody is dialled: nothing is written
        return _reply(response, {"dry_run": True, "mode": "test", "lead_id": str(lead_id), "would_place": plan.blocked_by is None, "blocked_by": plan.blocked_by,
                                 "starts": plan.starts, "starts_at": plan.starts_at.isoformat(), "gates": plan.gates})
    if plan.refusal is not None:
        raise ApiError(plan.refusal.status, plan.refusal.code, plan.refusal.message, headers=MODE)
    got = await asyncio.to_thread(repo.call_create, caller.worker, caller.key_hash, idem, K.body_sha({"lead_id": str(lead_id)}), lead_id, plan.starts_at)
    status = got.get("status")
    if status == "conflict":
        raise _refused(409, "idempotency_conflict", "This Idempotency-Key was used with a different body. Use a new key for a new call.")
    if status == "too_many_calls":
        raise ApiError(429, "too_many_calls", "Ten calls are already open in this workspace. Wait for one to finish.", headers=MODE, retry_after=int(got.get("retry_after") or 30))
    if status == "rate_limited":
        raise ApiError(429, "rate_limited", "More than 10 calls a minute with this key. Wait and try again.", headers=MODE, retry_after=int(got.get("retry_after") or 60))
    if status == "not_found":
        raise not_found()
    if status == "refused" or "call" not in got:
        raise ApiError(422, "consent_required", "This lead cannot be called: it needs a number and the lead's consent.", headers=MODE)
    if status == "replayed":
        return _reply(response, got["call"], 200, {"Idempotent-Replayed": "true"})
    return _reply(response, got["call"], 201)


@v1_router.get("/calls/{call_id}", operation_id="getCall", summary="Get one call")
async def get_call(call_id: str, request: Request, response: Response, runtime: RuntimeDep) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "calls:read")
    got = await asyncio.to_thread(_service(runtime).repo.call_get, caller.worker, caller.key_hash, _uuid(call_id))
    if got is None:
        raise not_found()
    return dict(got)


@v1_router.get("/calls", operation_id="listCalls", summary="List calls, oldest first")
async def list_calls(request: Request, response: Response, runtime: RuntimeDep, lead_id: uuid.UUID | None = None,
                     limit: Annotated[int, Query(ge=1, le=100)] = 50, after: Annotated[str | None, Query(max_length=200)] = None) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "calls:read")
    after_at, after_id = _cursor(after)
    rows = await asyncio.to_thread(_service(runtime).repo.calls_list, caller.worker, caller.key_hash, lead_id, after_at, after_id, limit + 1)
    return {"items": rows[:limit], "next_after": next_cursor(rows, limit, "created_at")}


# ============================================================================ campaigns
@v1_router.post("/campaigns", status_code=201, operation_id="createCampaign", summary="Create a campaign: a list of consented contacts and a job (idempotent)")
async def create_campaign(request: Request, response: Response, runtime: RuntimeDep, body: Annotated[dict[str, Any], Body()], idempotency_key: Idem = None) -> Any:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "campaigns:write")
    idem = _idem(idempotency_key)
    try:
        data = CampaignIn.model_validate(body)
    except ValidationError as exc:
        raise ApiError(422, "invalid_campaign", "Some fields are missing or not valid: " + ", ".join(_fields(exc)) + ".", headers=MODE, extra={"fields": _fields(exc)}) from None
    now = datetime.now(UTC)
    usable: list[dict[str, Any]] = []
    refused: list[dict[str, Any]] = []
    for index, raw in enumerate(data.contacts):   # the same rules as POST /leads, each contact on its own: one bad contact does not sink the rest
        try:
            lead = LeadIn.model_validate(raw)
        except ValidationError:
            refused.append({"index": index, "code": "invalid_lead"})
            continue
        if not lead.phone:
            refused.append({"index": index, "code": "lead_has_no_number"})
        elif not lead.consent.given:
            refused.append({"index": index, "code": "consent_required"})
        elif K.is_dnd_test_number(lead.phone):
            refused.append({"index": index, "code": "number_on_dnd"})
        else:
            usable.append({**lead.model_dump(mode="json"), **K.first_step(lead.phone, now)})
    if not usable:
        raise ApiError(422, "no_usable_contacts", "None of the contacts could be used: each needs a valid phone number and consent. See `refused` for the reason of each.", headers=MODE,
                       extra={"refused": refused[:100]})
    campaign = {"name": data.name, "language": data.language, "job_name": data.job.name, "job_goal": data.job.goal, "contacts": usable}
    got = await asyncio.to_thread(_service(runtime).repo.campaign_create, caller.worker, caller.key_hash, idem, K.body_sha(body), campaign)
    status = got.get("status")
    if status == "conflict":
        raise _refused(409, "idempotency_conflict", "This Idempotency-Key was used with a different body. Use a new key for a new campaign.")
    if status == "rate_limited":
        raise ApiError(429, "rate_limited", "More than 5 campaigns a minute with this key. Wait and try again.", headers=MODE, retry_after=int(got.get("retry_after") or 60))
    payload = {"campaign": got["campaign"], "refused": refused}
    if status == "replayed":
        return _reply(response, payload, 200, {"Idempotent-Replayed": "true"})
    return _reply(response, payload, 201)


@v1_router.get("/campaigns/{campaign_id}", operation_id="getCampaign", summary="Get one campaign, with its lead ids")
async def get_campaign(campaign_id: str, request: Request, response: Response, runtime: RuntimeDep) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "campaigns:read")
    got = await asyncio.to_thread(_service(runtime).repo.campaign_get, caller.worker, caller.key_hash, _uuid(campaign_id))
    if got is None:
        raise not_found()
    return dict(got)


@v1_router.get("/campaigns", operation_id="listCampaigns", summary="List campaigns, oldest first")
async def list_campaigns(request: Request, response: Response, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 50,
                         after: Annotated[str | None, Query(max_length=200)] = None) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "campaigns:read")
    after_at, after_id = _cursor(after)
    rows = await asyncio.to_thread(_service(runtime).repo.campaigns_list, caller.worker, caller.key_hash, after_at, after_id, limit + 1)
    return {"items": rows[:limit], "next_after": next_cursor(rows, limit, "created_at")}


# ============================================================================ the API activity log
@v1_router.get("/activity", operation_id="listActivity", summary="The workspace's API requests of the last 30 days, newest first (no bodies)")
async def list_activity(request: Request, response: Response, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 50,
                        before: Annotated[str | None, Query(max_length=200)] = None) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "usage:read")
    before_at, before_id = _cursor(before)
    rows = await asyncio.to_thread(_service(runtime).repo.activity_list, caller.worker, caller.key_hash, before_at, before_id, limit + 1)
    return {"items": rows[:limit], "next_before": next_cursor(rows, limit, "at")}
