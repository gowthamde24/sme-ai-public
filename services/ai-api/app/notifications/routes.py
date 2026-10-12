"""The "needs you" feed and web-push under /v1 (job BY, ADR 0077).

  GET  /v1/push/public-key                                  no sign-in   -> {enabled, public_key}   the key the browser subscribes with (null until the server has VAPID keys)
  POST /v1/me/push-subscriptions                            any signed-in person   the browser's PushSubscription JSON {endpoint, keys: {p256dh, auth}}   -> {id}
  POST /v1/me/push-subscriptions/remove                     {endpoint}   -> {removed}
  GET  /v1/tenants/{t}/notifications?limit=20               any member   -> {total, unread_count, last_seen_at, items: [{kind, id, customer, city, summary, at, amount_paise, target, unread, agent}]}
  POST /v1/tenants/{t}/notifications/seen                   any member   -> {last_seen_at}   (everything now waiting is "seen")
  GET  /v1/tenants/{t}/notifications/push                   any member   -> {enabled, subscriptions, server_ready}
  PUT  /v1/tenants/{t}/notifications/push                   any member   {enabled}   -> the same. Off until the member switches it on; switching on counts what waits as told.
A push only ever names a thing that waits for the member who opted in; the text is a fixed sentence (no customer, no amount)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.notifications.models import PushEnabledIn, PushSubscriptionIn, RemoveSubscriptionIn
from app.notifications.runtime import NotificationsRuntime
from app.today.service import needs_item

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["notifications"])
me_router = APIRouter(prefix="/v1", tags=["notifications"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]


def _n(runtime: Runtime) -> NotificationsRuntime:
    if runtime.notifications is None:
        raise ApiError(503, "notifications_unavailable", "This is not available on this system.")
    return runtime.notifications


@me_router.get("/push/public-key")
def public_key(runtime: RuntimeDep) -> dict[str, Any]:
    n = runtime.notifications
    vapid = n.vapid if n is not None else None
    return {"enabled": vapid is not None, "public_key": vapid.public_b64 if vapid is not None else None}


@me_router.post("/me/push-subscriptions")
def subscribe(body: PushSubscriptionIn, principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return _n(runtime).repository.subscribe(principal.token, body.endpoint, body.keys.p256dh, body.keys.auth)


@me_router.post("/me/push-subscriptions/remove")
def unsubscribe(body: RemoveSubscriptionIn, principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return _n(runtime).repository.unsubscribe(principal.token, body.endpoint)


@router.get("/notifications")
def feed(ctx: AnyMember, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=50)] = 20) -> dict[str, Any]:
    raw = _n(runtime).repository.feed(ctx.principal.token, ctx.tenant.id, limit)
    items = []
    for row in raw.get("items") or []:
        item = needs_item(row).model_dump(mode="json")
        item["unread"] = row.get("unread") is True
        items.append(item)
    return {"total": raw.get("total", 0), "unread_count": raw.get("unread_count", 0), "last_seen_at": raw.get("last_seen_at"), "items": items}


@router.post("/notifications/seen")
def seen(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _n(runtime).repository.mark_seen(ctx.principal.token, ctx.tenant.id)


def _prefs(runtime: Runtime, raw: dict[str, Any]) -> dict[str, Any]:
    n = _n(runtime)
    return {"enabled": raw.get("enabled") is True, "subscriptions": raw.get("subscriptions", 0), "server_ready": n.vapid is not None}


@router.get("/notifications/push")
def get_push(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _prefs(runtime, _n(runtime).repository.prefs(ctx.principal.token, ctx.tenant.id))


@router.put("/notifications/push")
def set_push(body: PushEnabledIn, ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    repository = _n(runtime).repository
    repository.set_prefs(ctx.principal.token, ctx.tenant.id, body.enabled)
    return _prefs(runtime, repository.prefs(ctx.principal.token, ctx.tenant.id))
