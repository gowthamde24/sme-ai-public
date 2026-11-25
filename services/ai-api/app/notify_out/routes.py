"""Notifications out over HTTP (docs/contracts/commerce-notify.md section C). Off unless NOTIFY_OUT=on: every route answers 404.

  GET  /v1/tenants/{tenant_id}/notify/channels                      every member: the three channels (connected or not), the events and fields one can choose, how to connect each (never an address or a token)
  PUT  /v1/tenants/{tenant_id}/notify/channels/{kind}               Owner or Admin: connect or change one (kind: slack | telegram | teams); the address or token goes to the vault and is never returned
  POST /v1/tenants/{tenant_id}/notify/channels/{kind}/test          Owner or Admin: sends one fixed test line now -> {ok, reason, channel}
  POST /v1/tenants/{tenant_id}/notify/channels/{kind}/disconnect    Owner or Admin: removes the channel, its log and its secret (this API has no DELETE verbs)

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.repository import InvalidValueError
from app.errors import ApiError, not_found
from app.notify_out import messages, vendors
from app.notify_out.service import NotifyOut
from app.tenancy.models import Role
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.notify_out")

router = APIRouter(prefix="/v1/tenants/{tenant_id}/notify/channels", tags=["notify"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Member = Annotated[TenantContext, Depends(require_tenant_role())]
EventName = Literal["new_lead", "missed_call", "call_outcome", "low_balance"]
FieldName = Literal["name", "phone_masked", "outcome", "reason"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChannelIn(_Strict):
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None
    url: Text | None = None
    token: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    chat_id: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    events: Annotated[list[EventName], Field(max_length=4)] | None = None
    fields: Annotated[list[FieldName], Field(max_length=4)] | None = None
    language: Literal["en", "te", "hi", "kn"] | None = None


def _service(runtime: Runtime) -> NotifyOut:
    service = getattr(runtime, "notify_out", None)
    if service is None:   # NOTIFY_OUT=off: as if it were not there
        raise not_found()
    return service  # type: ignore[no-any-return]


def _unavailable() -> ApiError:
    return ApiError(503, "notify_out_unavailable", "Notifications are not available right now. Try again in a minute.", retry_after=30)


def _vault(service: NotifyOut) -> Any:
    if service.vault is None:
        raise _unavailable()
    return service.vault


def _kind(raw: str) -> str:
    if raw not in vendors.KINDS:
        raise not_found()
    return raw


def _empty(kind: str) -> dict[str, Any]:
    return {"kind": kind, "state": "not_connected", "label": "", "last4": "", "events": [], "fields": list(messages.DEFAULT_FIELDS), "language": "en", "test_passed": False,
            "health": {"status": "never_sent", "reason": None, "last_sent_at": None}, "counts_24h": {"sent": 0, "failed": 0, "rate_limited": 0}}


def _items(service: NotifyOut, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    have = {str(c.get("kind")): c for c in service.repo.channels_list(token, tenant_id)}
    return [have.get(k) or _empty(k) for k in vendors.KINDS]


@router.get("")
def list_channels(ctx: Member, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    return {
        "items": _items(service, ctx.principal.token, ctx.tenant.id),
        "kinds": [{"id": k, "name": vendors.KIND_NAMES[k], "fields": vendors.CARD_FIELDS[k]} for k in vendors.KINDS],
        "events": [{"id": e, "words": messages.EVENT_WORDS[e]} for e in messages.EVENTS],
        "fields": [{"id": f, "words": messages.FIELD_WORDS[f], "default": f in messages.DEFAULT_FIELDS} for f in messages.FIELDS],
        "limits": {"per_minute": 20, "per_hour": 300, "lead_messages_per_minute": 5},
    }


@router.put("/{kind}")
def put_channel(kind: str, body: ChannelIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    vault = _vault(service)
    kind = _kind(kind)
    token, tenant = ctx.principal.token, ctx.tenant.id
    existing = next((c for c in service.repo.channels_list(token, tenant) if c.get("kind") == kind), None)
    current = vault.get(tenant, kind) if existing is not None else None
    try:
        secret = vendors.check_secret(kind, {"url": body.url, "token": body.token, "chat_id": body.chat_id}, current)
    except vendors.ChannelInvalid as exc:
        raise ApiError(422, "channel_invalid", vendors.REFUSALS[exc.reason], extra={"reason": exc.reason}) from None
    if secret is None and existing is None:
        raise ApiError(422, "channel_invalid", vendors.REFUSALS["secret_required"], extra={"reason": "secret_required"})
    if secret is not None:
        try:
            vault.put(tenant, kind, secret)
        except SecretStoreError:
            raise _unavailable() from None
    try:
        channel = service.repo.channel_put(
            token, tenant, kind, body.label, vendors.last4_of(secret) if secret is not None else None,
            sorted(set(body.events)) if body.events is not None else None, sorted(set(body.fields)) if body.fields is not None else None, body.language,
        )
    except InvalidValueError:
        raise ApiError(422, "channel_invalid", "Check the choices and try again.", extra={"reason": "choices"}) from None
    except Exception:
        if existing is None and secret is not None:
            _forget(vault, tenant, kind)
        raise
    return {"channel": channel}


def _forget(vault: Any, tenant: uuid.UUID, kind: str) -> None:
    try:
        vault.delete(tenant, kind)
    except (SecretStoreError, ValueError):
        logger.warning("a notification secret was not removed")


@router.post("/{kind}/test")
def test_channel(kind: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    vault = _vault(service)
    kind = _kind(kind)
    token, tenant = ctx.principal.token, ctx.tenant.id
    existing = next((c for c in service.repo.channels_list(token, tenant) if c.get("kind") == kind), None)
    if existing is None:
        raise not_found()
    if not service.test_allowed(str(tenant), kind):
        raise ApiError(429, "asked_too_soon", "Please wait a few seconds before testing again.", retry_after=10)
    secret = vault.get(tenant, kind)
    outcome = vendors.send(service.http, kind, secret, messages.test_text(str(existing.get("language") or "en"))) if secret else vendors.SendOutcome(False, "no_secret")
    logger.info("notify test: kind=%s ok=%s reason=%s", kind, outcome.ok, outcome.reason or "-")
    channel = service.repo.channel_test_result(token, tenant, kind, outcome.ok, outcome.reason)
    if channel is None:
        raise not_found()
    return {"ok": outcome.ok, "reason": outcome.reason, "channel": channel}


@router.post("/{kind}/disconnect")
def disconnect_channel(kind: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    kind = _kind(kind)
    if not service.repo.channel_delete(ctx.principal.token, ctx.tenant.id, kind):
        raise not_found()
    if service.vault is not None:
        _forget(service.vault, ctx.tenant.id, kind)
    return {"disconnected": True}
