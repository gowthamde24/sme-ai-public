"""The Connectors page over HTTP (docs/contracts/crm-push.md). Owner or Admin, signed in (the second factor for changes). Off unless CRM_PUSH=on: every route answers 404.

  GET    /v1/tenants/{tenant_id}/connectors/crm                          the cards (state Connected / Not connected / Needs setup by us), the events, the connection of each (never its keys)
  PUT    /v1/tenants/{tenant_id}/connectors/crm/{type}                   {credentials, settings?, mapping?, events?} -> {connection}: the keys go to Secret Manager and are never shown again
  PATCH  /v1/tenants/{tenant_id}/connectors/crm/{type}                   {mapping?, events?, active?} -> {connection}
  DELETE /v1/tenants/{tenant_id}/connectors/crm/{type}                   -> {deleted: true}: the connection, its log and its keys go
  POST   /v1/tenants/{tenant_id}/connectors/crm/{type}/test              -> {ok, reason}: a harmless read of the other tool (nothing is written there)
  GET    /v1/tenants/{tenant_id}/connectors/crm/{type}/deliveries        ?before=&limit= -> {items, next_before}: the last 30 days (status, tries, a closed word; never a body)
  POST   /v1/tenants/{tenant_id}/connectors/crm/{type}/retry             -> {requeued}: the dead pushes of the last 7 days are queued once more

A key is never logged, put in an error, returned or put in the database. NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import base64
import binascii
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm_push.fields import EVENTS, clean_mapping
from app.crm_push.registry import EVENT_WORDS, describe
from app.crm_push.service import CrmPush, read_creds, secret_name
from app.errors import ApiError, not_found
from app.tenancy.models import Role
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.crm_push")

router = APIRouter(prefix="/v1/tenants/{tenant_id}/connectors/crm", tags=["connectors"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
DEFAULT_EVENTS = ["call.completed", "call.missed", "lead.created", "job.outcome"]
_KEY = re.compile(r"[a-z_]{1,30}")
_SECRET = re.compile(r"[\x21-\x7e]{1,600}")
_PLAIN = re.compile(r"[A-Za-z0-9._:/@ -]{1,200}")
CHECK_WORDS = {
    "config": "One of the settings does not look right. Check it against what the other tool shows.",
}
UNAVAILABLE = "Connectors are not available right now. Try again in a minute."


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConnectIn(_Strict):
    credentials: dict[str, str] = Field(default_factory=dict, max_length=6)
    settings: dict[str, str] = Field(default_factory=dict, max_length=6)
    mapping: dict[str, str] | None = Field(default=None, max_length=20)
    events: list[str] | None = Field(default=None, max_length=5)


class ChangeIn(_Strict):
    mapping: dict[str, str] | None = Field(default=None, max_length=20)
    events: list[str] | None = Field(default=None, max_length=5)
    active: bool | None = None


def _service(runtime: Runtime) -> CrmPush:
    service = getattr(runtime, "crm_push", None)
    if service is None:   # CRM_PUSH=off: as if it were not there
        raise not_found()
    return service  # type: ignore[no-any-return]


def _store(service: CrmPush) -> Any:
    if service.store is None:
        raise ApiError(503, "crm_push_unavailable", UNAVAILABLE, retry_after=30)
    return service.store


def _adapter(service: CrmPush, type_: str) -> Any:
    adapter = service.adapters.get(type_)
    if adapter is None:
        raise not_found()
    return adapter


def _events(raw: list[str] | None) -> list[str]:
    if raw is None:
        return list(DEFAULT_EVENTS)
    out = sorted(set(raw))
    if not out or any(e not in EVENTS for e in out):
        raise ApiError(422, "validation_error", "Pick at least one of the listed events.")
    return out


def _mapping(adapter: Any, raw: dict[str, str] | None) -> dict[str, str]:
    if raw is None:
        return dict(adapter.spec.default_mapping)
    cleaned = clean_mapping(raw, adapter.spec.our_fields)
    if cleaned is None:
        raise ApiError(422, "mapping_invalid", "One of the field names does not look right. Use the name the other tool shows.")
    return cleaned


@router.get("")
def list_connectors(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    by_type = {str(c.get("type")): c for c in service.repo.connections_list(ctx.principal.token, ctx.tenant.id)}
    from app.crm_push.registry import ORDER

    cards = [describe(service.adapters[k], by_type.get(k)) for k in ORDER if k in service.adapters]
    return {"items": cards, "events": [{"event": e, "description": EVENT_WORDS[e]} for e in EVENTS], "available": service.store is not None}


@router.put("/{type_}")
def connect(type_: str, body: ConnectIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    store = _store(service)
    adapter = _adapter(service, type_)
    spec = adapter.spec
    if spec.needs_setup:
        raise ApiError(409, "needs_setup_by_us", spec.needs_setup)
    if set(body.credentials) != {s.key for s in spec.credentials} or any(not _SECRET.fullmatch(v.strip()) for v in body.credentials.values()):
        raise ApiError(422, "credentials_invalid", "Fill in every key. A key has no spaces.")
    if set(body.settings) != {s.key for s in spec.settings} or any(not _PLAIN.fullmatch(v.strip()) for v in body.settings.values()):
        raise ApiError(422, "settings_invalid", "Fill in every setting with the text the other tool shows.")
    creds = {k: v.strip() for k, v in body.credentials.items()}
    config = {k: v.strip() for k, v in body.settings.items()}
    bad = adapter.check(creds, config)
    if bad:
        raise ApiError(422, "settings_invalid", CHECK_WORDS["config"], extra={"reason": bad})
    mapping, events = _mapping(adapter, body.mapping), _events(body.events)
    existing = next((c for c in service.repo.connections_list(ctx.principal.token, ctx.tenant.id) if c.get("type") == type_), None)
    connection_id = uuid.UUID(str(existing["id"])) if existing else uuid.uuid4()
    name = secret_name(ctx.tenant.id, connection_id)
    try:
        store.put(name, json.dumps(creds, separators=(",", ":")))
    except SecretStoreError:
        raise ApiError(503, "crm_push_unavailable", UNAVAILABLE, retry_after=30) from None
    try:
        connection = service.repo.connection_save(ctx.principal.token, ctx.tenant.id, connection_id, type_, config, mapping, events)
    except Exception:
        if existing is None:
            _forget(store, name)
        raise
    return {"connection": connection}


def _forget(store: Any, name: str) -> None:
    try:
        store.delete(name)
    except SecretStoreError:
        logger.warning("a connector key was not removed")


@router.patch("/{type_}")
def change(type_: str, body: ChangeIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    adapter = _adapter(service, type_)
    mapping = _mapping(adapter, body.mapping) if body.mapping is not None else None
    events = _events(body.events) if body.events is not None else None
    connection = service.repo.connection_update(ctx.principal.token, ctx.tenant.id, type_, mapping, events, body.active)
    if connection is None:
        raise not_found()
    return {"connection": connection}


@router.delete("/{type_}")
def disconnect(type_: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    _adapter(service, type_)
    connection_id = service.repo.connection_delete(ctx.principal.token, ctx.tenant.id, type_)
    if connection_id is None:
        raise not_found()
    if service.store is not None:
        _forget(service.store, secret_name(ctx.tenant.id, connection_id))
    return {"deleted": True}


@router.post("/{type_}/test")
def test_connection(type_: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    store = _store(service)
    adapter = _adapter(service, type_)
    connection = next((c for c in service.repo.connections_list(ctx.principal.token, ctx.tenant.id) if c.get("type") == type_), None)
    if connection is None:
        raise not_found()
    reason: str | None
    creds = read_creds(store, ctx.tenant.id, uuid.UUID(str(connection["id"])))
    if creds is None:
        outcome_ok, reason = False, "no_secret"

    else:
        config = {str(k): str(v) for k, v in (connection.get("config") or {}).items()}
        mapping = {str(k): str(v) for k, v in (connection.get("mapping") or {}).items()}
        bad = adapter.check(creds, config)
        if bad:
            outcome_ok, reason = False, bad
        else:
            result = adapter.test(service.http, creds, config, mapping)
            outcome_ok, reason = result.ok, (None if result.ok else result.word)
    service.repo.connection_tested(ctx.principal.token, ctx.tenant.id, type_, outcome_ok, reason)
    return {"ok": outcome_ok, "reason": reason}


def _cursor(raw: str | None) -> tuple[datetime | None, uuid.UUID | None]:
    if not raw:
        return None, None
    try:
        at, _, ident = base64.urlsafe_b64decode(raw.encode() + b"=" * (-len(raw) % 4)).decode().partition("|")
        return datetime.fromisoformat(at), uuid.UUID(ident)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise ApiError(400, "invalid_cursor", "This `before` value is not one we gave you.") from None


@router.get("/{type_}/deliveries")
def deliveries(type_: str, ctx: Manager, runtime: RuntimeDep, before: Annotated[str | None, Query(max_length=200)] = None, limit: Annotated[int, Query(ge=1, le=100)] = 50) -> dict[str, Any]:
    service = _service(runtime)
    _adapter(service, type_)
    at, ident = _cursor(before)
    rows = service.repo.deliveries_list(ctx.principal.token, ctx.tenant.id, type_, at, ident, limit + 1)
    page = rows[:limit]
    nxt = None
    if len(rows) > limit and page:
        last = page[-1]
        nxt = base64.urlsafe_b64encode(f"{last['created_at']}|{last['id']}".encode()).decode().rstrip("=")
    return {"items": page, "next_before": nxt}


@router.post("/{type_}/retry")
def retry(type_: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    _adapter(service, type_)
    got = service.repo.deliveries_retry(ctx.principal.token, ctx.tenant.id, type_)
    if got is None:
        raise not_found()
    return {"requeued": got.get("requeued", 0)}
