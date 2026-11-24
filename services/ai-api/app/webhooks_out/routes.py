"""Outbound webhooks over HTTP (docs/contracts/webhooks-out.md). Settings -> Developers -> Webhooks: Owner or Admin, signed in (the second factor for changes). Off unless WEBHOOKS_OUT=on: every
route answers 404.

  GET    /v1/tenants/{tenant_id}/developer/webhooks                       the endpoints, each with its health (never the secret)
  GET    /v1/tenants/{tenant_id}/developer/webhooks/events                the events one can ask for, in plain words
  POST   /v1/tenants/{tenant_id}/developer/webhooks                       {url, events, send_transcript?} -> 201 {webhook, secret}: the secret is shown THIS ONCE
  PATCH  /v1/tenants/{tenant_id}/developer/webhooks/{id}                  {url?, events?, active?, send_transcript?} -> {webhook}
  POST   /v1/tenants/{tenant_id}/developer/webhooks/{id}/rotate-secret    -> {webhook, secret}: the old secret stops at once
  DELETE /v1/tenants/{tenant_id}/developer/webhooks/{id}                  -> {deleted: true}
  POST   /v1/tenants/{tenant_id}/developer/webhooks/{id}/test             -> 202 {delivery_id}: a test.ping the worker sends within a minute (never retried)
  GET    /v1/tenants/{tenant_id}/developer/webhooks/{id}/deliveries       ?before=&limit= -> {items, next_before}: the last 30 days (status, attempts, response code; never a body)

The secret and the address are never logged, put in an error, or shown again (the address is shown to the Owner and Admin on the list). NOTE: no `from __future__ import annotations` here (FastAPI reads the
endpoint signatures at registration)."""

# ruff: noqa: E501

import base64
import binascii
import logging
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.repository import InvalidValueError
from app.errors import ApiError, not_found
from app.tenancy.models import Role
from app.webhooks_out import signing, ssrf
from app.webhooks_out.service import EVENT_WORDS, EVENTS, WebhooksOut, secret_name
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.webhooks_out")

router = APIRouter(prefix="/v1/tenants/{tenant_id}/developer/webhooks", tags=["webhooks"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
EventName = Literal["call.completed", "call.missed", "lead.created", "lead.updated", "job.outcome"]
Events = Annotated[list[EventName], Field(min_length=1, max_length=5)]
URL_MESSAGES = {
    "length": "The address must be a web address of at most 500 characters.",
    "scheme": "The address must start with https://.",
    "userinfo": "Leave the user name and password out of the address.",
    "host": "Use a web site name, not an IP number, localhost or an internal name.",
    "port": "Use port 443, or a port of 1024 or more.",
    "private": "That name points at a private or internal address. Use a public one.",
    "dns": "We could not find that web site name. Check the spelling.",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WebhookCreateIn(_Strict):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    events: Events
    send_transcript: bool = False


class WebhookPatchIn(_Strict):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)] | None = None
    events: Events | None = None
    active: bool | None = None
    send_transcript: bool | None = None


def _service(runtime: Runtime) -> WebhooksOut:
    service = getattr(runtime, "webhooks_out", None)
    if service is None:   # WEBHOOKS_OUT=off: as if it were not there
        raise not_found()
    return service  # type: ignore[no-any-return]


def _store(service: WebhooksOut) -> Any:
    if service.store is None:
        raise ApiError(503, "webhooks_out_unavailable", "Webhooks are not available right now. Try again in a minute.", retry_after=30)
    return service.store


def _checked(service: WebhooksOut, url: str) -> str:
    try:
        service.validate_url(url)
    except ssrf.UnsafeUrl as exc:
        raise ApiError(422, "webhook_url_invalid", URL_MESSAGES.get(exc.reason, URL_MESSAGES["host"]), extra={"reason": exc.reason}) from None
    return url


def _id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise not_found() from None


@router.get("")
def list_webhooks(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return {"items": _service(runtime).repo.endpoints_list(ctx.principal.token, ctx.tenant.id)}


@router.get("/events")
def list_events(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    _service(runtime)
    return {"items": [{"event": e, "description": EVENT_WORDS[e]} for e in EVENTS]}


@router.post("", status_code=201)
def create_webhook(body: WebhookCreateIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    store = _store(service)
    url = _checked(service, body.url)
    endpoint_id, secret = uuid.uuid4(), signing.new_secret()
    name = secret_name(ctx.tenant.id, endpoint_id)
    try:
        store.put(name, secret)
    except SecretStoreError:
        raise ApiError(503, "webhooks_out_unavailable", "Webhooks are not available right now. Try again in a minute.", retry_after=30) from None
    try:
        webhook = service.repo.endpoint_create(ctx.principal.token, ctx.tenant.id, endpoint_id, url, sorted(set(body.events)), body.send_transcript, signing.last4(secret))
    except Exception:
        _forget(store, name)
        raise
    if webhook is None:
        _forget(store, name)
        raise ApiError(409, "too_many_webhooks", "This workspace already has 5 webhook endpoints. Delete one first.")
    return {"webhook": webhook, "secret": secret}


def _forget(store: Any, name: str) -> None:
    try:
        store.delete(name)
    except SecretStoreError:
        logger.warning("a webhook secret was not removed")


@router.patch("/{webhook_id}")
def update_webhook(webhook_id: str, body: WebhookPatchIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    url = _checked(service, body.url) if body.url is not None else None
    try:
        webhook = service.repo.endpoint_update(ctx.principal.token, ctx.tenant.id, _id(webhook_id), url, sorted(set(body.events)) if body.events else None, body.active, body.send_transcript)
    except InvalidValueError:
        raise ApiError(422, "webhook_url_invalid", URL_MESSAGES["host"], extra={"reason": "host"}) from None
    if webhook is None:
        raise not_found()
    return {"webhook": webhook}


@router.post("/{webhook_id}/rotate-secret")
def rotate_secret(webhook_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    store = _store(service)
    endpoint_id, secret = _id(webhook_id), signing.new_secret()
    webhook = service.repo.endpoint_rotate(ctx.principal.token, ctx.tenant.id, endpoint_id, signing.last4(secret))
    if webhook is None:
        raise not_found()
    try:
        store.put(secret_name(ctx.tenant.id, endpoint_id), secret)
    except SecretStoreError:
        # the version moved on, so deliveries wait (no secret of that version yet) until the Owner rotates again
        raise ApiError(503, "webhooks_out_unavailable", "The new secret could not be saved. Rotate it again in a minute.", retry_after=30) from None
    return {"webhook": webhook, "secret": secret}


@router.delete("/{webhook_id}")
def delete_webhook(webhook_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    endpoint_id = _id(webhook_id)
    if not service.repo.endpoint_delete(ctx.principal.token, ctx.tenant.id, endpoint_id):
        raise not_found()
    if service.store is not None:
        _forget(service.store, secret_name(ctx.tenant.id, endpoint_id))
    return {"deleted": True}


@router.post("/{webhook_id}/test", status_code=202)
def test_webhook(webhook_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    got = _service(runtime).repo.endpoint_test(ctx.principal.token, ctx.tenant.id, _id(webhook_id))
    if got is None:
        raise not_found()
    return {"delivery_id": got["delivery_id"]}


def _cursor(raw: str | None) -> tuple[datetime | None, uuid.UUID | None]:
    if not raw:
        return None, None
    try:
        at, _, ident = base64.urlsafe_b64decode(raw.encode() + b"=" * (-len(raw) % 4)).decode().partition("|")
        return datetime.fromisoformat(at), uuid.UUID(ident)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise ApiError(400, "invalid_cursor", "This `before` value is not one we gave you.") from None


@router.get("/{webhook_id}/deliveries")
def deliveries(webhook_id: str, ctx: Manager, runtime: RuntimeDep, before: Annotated[str | None, Query(max_length=200)] = None,
               limit: Annotated[int, Query(ge=1, le=100)] = 50) -> dict[str, Any]:
    service = _service(runtime)
    endpoint_id = _id(webhook_id)
    if not any(str(e.get("id")) == str(endpoint_id) for e in service.repo.endpoints_list(ctx.principal.token, ctx.tenant.id)):
        raise not_found()
    at, ident = _cursor(before)
    rows = service.repo.deliveries_list(ctx.principal.token, ctx.tenant.id, endpoint_id, at, ident, limit + 1)
    page = rows[:limit]
    nxt = None
    if len(rows) > limit and page:
        last = page[-1]
        nxt = base64.urlsafe_b64encode(f"{last['created_at']}|{last['id']}".encode()).decode().rstrip("=")
    return {"items": page, "next_before": nxt}
