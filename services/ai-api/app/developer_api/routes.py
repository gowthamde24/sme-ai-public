"""The developer API over HTTP (ADR 0121; docs/contracts/developer-api.md), part D1. TEST MODE only.

  Settings -> Developers (a signed-in Owner or Admin; the second factor for changes):
  GET  /v1/tenants/{tenant_id}/developer/keys                    the keys (never the secret or its hash)
  POST /v1/tenants/{tenant_id}/developer/keys                    {name, scopes, ip_allow?, mode?} -> 201 {key, secret}: the secret is shown THIS ONCE
  POST /v1/tenants/{tenant_id}/developer/keys/{key_id}/rotate    -> {key, secret}: the old secret stops at once
  POST /v1/tenants/{tenant_id}/developer/keys/{key_id}/revoke    -> {key}
  GET  /v1/tenants/{tenant_id}/developer/usage                   requests and leads, today and this month

  The program (`Authorization: Bearer sk_test_...`; the workspace comes from the key):
  POST /api/v1/leads            leads:write   Idempotency-Key required; the lead goes to the workspace's SANDBOX
  GET  /api/v1/leads/{lead_id}  leads:read
  GET  /api/v1/leads            leads:read    ?updated_since=&limit=&after=
  GET  /api/v1/usage            usage:read

The key is never logged, stored, echoed or put in an error. Off unless DEVELOPER_API=test (then every route answers 404).
NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import base64
import binascii
import ipaddress
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, Header, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.repository import InvalidValueError
from app.developer_api import keys as K
from app.errors import ApiError, not_found
from app.tenancy.models import Role
from app.tenancy.repository import Forbidden

logger = logging.getLogger("app.developer_api")

router = APIRouter(prefix="/v1/tenants/{tenant_id}/developer", tags=["developer"])
api_router = APIRouter(prefix="/api/v1", tags=["developer-api"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
MODE = {"Stack19-Mode": "test"}
LIMIT = 60
Text = Annotated[str, StringConstraints(strip_whitespace=True)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KeyCreateIn(_Strict):
    name: Annotated[Text, StringConstraints(min_length=1, max_length=60)]
    scopes: Annotated[list[Literal["leads:write", "leads:read", "calls:read", "campaigns:write", "webhooks", "usage:read"]], Field(min_length=1, max_length=6)]
    ip_allow: Annotated[list[Annotated[str, StringConstraints(max_length=50)]], Field(max_length=10)] = []
    mode: Literal["test", "live"] = "test"


class ConsentIn(_Strict):
    given: bool
    text: Annotated[str, StringConstraints(max_length=1000)] | None = None
    at: datetime | None = None


class LeadIn(_Strict):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: Annotated[Text, StringConstraints(min_length=1, max_length=120)]
    phone: Annotated[str, StringConstraints(pattern=r"^\+91[6-9][0-9]{9}$")] | None = None
    email: Annotated[str, StringConstraints(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")] | None = None
    source: Annotated[Text, StringConstraints(min_length=1, max_length=40)] | None = None
    language: Literal["en", "te", "hi", "kn", "ta", "ml", "mr"] | None = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None
    custom_fields: Annotated[dict[Annotated[str, StringConstraints(min_length=1, max_length=40)], Annotated[str, StringConstraints(max_length=500)]], Field(max_length=20)] = {}
    consent: ConsentIn


def _service(runtime: Runtime) -> Any:
    repo = getattr(runtime, "developer_api", None)
    if repo is None:   # DEVELOPER_API=off: as if it were not there
        raise not_found()
    return repo


def _ips(raw: list[str]) -> list[str]:
    out: list[str] = []
    for item in raw:
        try:
            net = ipaddress.ip_network(item.strip(), strict=False)
        except ValueError:
            raise ApiError(422, "invalid_ip", "Each allowed address must be an IP address or a range like 203.0.113.0/24.") from None
        out.append(str(net.network_address) if net.num_addresses == 1 else str(net))
    return out


# ============================================================================ Settings -> Developers
@router.get("/keys")
def list_keys(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return {"items": _service(runtime).repo.keys_list(ctx.principal.token, ctx.tenant.id)}


@router.post("/keys", status_code=201)
def create_key(body: KeyCreateIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    if body.mode == "live":
        raise ApiError(422, "live_not_available", "Live keys are not available yet. Test keys work with simulated calls.")
    new = K.new_key()
    key = service.repo.key_create(ctx.principal.token, ctx.tenant.id, body.name, sorted(set(body.scopes)), _ips(body.ip_allow), new.hash, new.prefix, new.last4)
    if key is None:
        raise ApiError(409, "too_many_keys", "This workspace already has 10 active keys. Revoke one first.")
    return {"key": key, "secret": new.secret}


def _key_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise not_found() from None


@router.post("/keys/{key_id}/rotate")
def rotate_key(key_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    new = K.new_key()
    key = _service(runtime).repo.key_rotate(ctx.principal.token, ctx.tenant.id, _key_id(key_id), new.hash, new.prefix, new.last4)
    if key is None:
        raise not_found()
    return {"key": key, "secret": new.secret}


@router.post("/keys/{key_id}/revoke")
def revoke_key(key_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    key = _service(runtime).repo.key_revoke(ctx.principal.token, ctx.tenant.id, _key_id(key_id))
    if key is None:
        raise not_found()
    return {"key": key}


@router.get("/usage")
def usage(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return dict(_service(runtime).repo.usage(ctx.principal.token, ctx.tenant.id))


# ============================================================================ the program's API
@dataclass(frozen=True)
class Caller:
    key_hash: str
    tenant_id: uuid.UUID
    key_id: uuid.UUID
    worker: str


def _refused(status: int, code: str, message: str, extra_headers: dict[str, str] | None = None, retry_after: int | None = None) -> ApiError:
    return ApiError(status, code, message, headers={**MODE, **(extra_headers or {})}, retry_after=retry_after)


def _authorize(request: Request, response: Response, runtime: Runtime, scope: str) -> Caller:
    service = _service(runtime)
    secret = K.bearer(request.headers.get("authorization"))
    if secret is None:
        raise _refused(401, "invalid_key", "Send a valid test key: Authorization: Bearer sk_test_...", {"WWW-Authenticate": "Bearer"})
    try:
        worker = service.worker()
    except Exception:   # noqa: BLE001 - the worker account could not sign in: unavailable, said plainly
        raise _refused(503, "developer_api_unavailable", "The API is not available right now. Try again in a minute.", retry_after=30) from None
    hashed = K.key_hash(secret)
    got = service.repo.auth(worker, hashed, scope, service.client_ip(request))
    if not got.get("ok"):
        code = str(got.get("code") or "invalid_key")
        if code == "rate_limited":
            raise _refused(429, "rate_limited", f"More than {LIMIT} requests a minute with this key. Wait and try again.", {"X-RateLimit-Limit": str(LIMIT), "X-RateLimit-Remaining": "0"},
                           retry_after=int(got.get("retry_after") or 60))
        if code == "missing_scope":
            raise _refused(403, "missing_scope", f"This key does not have the {scope} scope.")
        if code == "ip_not_allowed":
            raise _refused(403, "ip_not_allowed", "This key may not be used from this address.")
        raise _refused(401, "invalid_key", "This key is not valid (unknown, rotated or revoked).", {"WWW-Authenticate": "Bearer"})
    response.headers.update({**MODE, "X-RateLimit-Limit": str(LIMIT), "X-RateLimit-Remaining": str(int(got.get("remaining") or 0))})
    return Caller(key_hash=hashed, tenant_id=uuid.UUID(str(got["tenant_id"])), key_id=uuid.UUID(str(got["key_id"])), worker=worker)


def _lead_out(lead: dict[str, Any], duplicate: bool = False) -> dict[str, Any]:
    return {**lead, "duplicate": duplicate}


@api_router.post("/leads", status_code=201)
async def create_lead(request: Request, response: Response, runtime: RuntimeDep, body: Annotated[dict[str, Any], Body()],
                      idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> Any:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "leads:write")
    idem = (idempotency_key or "").strip()
    if not 1 <= len(idem) <= 100 or not idem.isprintable():
        raise _refused(400, "idempotency_key_required", "Send an Idempotency-Key header (1 to 100 characters), the same one when you retry.")
    try:
        lead = LeadIn.model_validate(body)
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in e["loc"]) for e in exc.errors()})[:10]
        raise ApiError(422, "invalid_lead", "Some fields are missing or not valid: " + ", ".join(fields) + ".", headers=MODE, extra={"fields": fields}) from None
    if not lead.phone and not lead.email:
        raise ApiError(422, "invalid_lead", "Send a phone number or an e-mail address.", headers=MODE, extra={"fields": ["phone", "email"]})
    if not lead.consent.given:
        raise ApiError(422, "consent_required", "The lead must have agreed to be contacted (consent.given = true). We don't call or message without consent.", headers=MODE)
    data = lead.model_dump(mode="json")
    step = K.first_step(lead.phone, datetime.now(UTC))
    service = _service(runtime)
    try:
        got = await asyncio.to_thread(service.repo.lead_create, caller.worker, caller.key_hash, idem, K.body_sha(data), {**data, **step})
    except Forbidden:
        raise _refused(401, "invalid_key", "This key is not valid (unknown, rotated or revoked).", {"WWW-Authenticate": "Bearer"}) from None
    except InvalidValueError:
        raise ApiError(422, "invalid_lead", "Some fields are not valid.", headers=MODE) from None
    status = got.get("status")
    if status == "conflict":
        raise _refused(409, "idempotency_conflict", "This Idempotency-Key was used with a different body. Use a new key for a new lead.")
    headers = {k: v for k, v in response.headers.items() if k.lower().startswith(("x-ratelimit", "stack19"))}
    if status == "replayed":
        return JSONResponse(_lead_out(got["lead"]), status_code=200, headers={**headers, "Idempotent-Replayed": "true"})
    if status == "duplicate":
        return JSONResponse(_lead_out(got["lead"], duplicate=True), status_code=200, headers=headers)
    return JSONResponse(_lead_out(got["lead"]), status_code=201, headers=headers)


@api_router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, request: Request, response: Response, runtime: RuntimeDep) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "leads:read")
    try:
        parsed = uuid.UUID(lead_id)
    except ValueError:
        raise not_found() from None
    lead = await asyncio.to_thread(_service(runtime).repo.lead_get, caller.worker, caller.key_hash, parsed)
    if lead is None:
        raise not_found()
    return _lead_out(lead)


def _cursor(raw: str | None) -> tuple[datetime | None, uuid.UUID | None]:
    if not raw:
        return None, None
    try:
        at, _, ident = base64.urlsafe_b64decode(raw.encode() + b"=" * (-len(raw) % 4)).decode().partition("|")
        return datetime.fromisoformat(at), uuid.UUID(ident)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise ApiError(400, "invalid_cursor", "This `after` value is not one we gave you.", headers=MODE) from None


@api_router.get("/leads")
async def list_leads(request: Request, response: Response, runtime: RuntimeDep, updated_since: datetime | None = None,
                     limit: Annotated[int, Query(ge=1, le=100)] = 50, after: Annotated[str | None, Query(max_length=200)] = None) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "leads:read")
    after_at, after_id = _cursor(after)
    rows = await asyncio.to_thread(_service(runtime).repo.leads_list, caller.worker, caller.key_hash, updated_since, after_at, after_id, limit + 1)
    page = rows[:limit]
    nxt = None
    if len(rows) > limit and page:
        last = page[-1]
        nxt = base64.urlsafe_b64encode(f"{last['updated_at']}|{last['id']}".encode()).decode().rstrip("=")
    return {"items": [_lead_out(r) for r in page], "next_after": nxt}


@api_router.get("/usage")
async def api_usage(request: Request, response: Response, runtime: RuntimeDep) -> dict[str, Any]:
    caller = await asyncio.to_thread(_authorize, request, response, runtime, "usage:read")
    return dict(await asyncio.to_thread(_service(runtime).repo.api_usage, caller.worker, caller.key_hash))
