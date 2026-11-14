"""Google Calendar 2-way sync (appointment booking slice 4; the contract for the web: docs/contracts/google-calendar.md).

  GET  /v1/tenants/{tenant_id}/integrations/google-calendar/status       any member: {configured, connected, status, google_email, calendar_id, calendar_name, write_events, block_busy, last_synced_at, last_error_code}
  POST /v1/tenants/{tenant_id}/integrations/google-calendar/connect      the Owner, second factor: {authorize_url, expires_at} (open it in the browser; Google sends the browser back to the callback)
  PUT  /v1/tenants/{tenant_id}/integrations/google-calendar/settings     the Owner: {write_events, block_busy} -> the status
  POST /v1/tenants/{tenant_id}/integrations/google-calendar/sync-now     the Owner or an Admin: the worker syncs on its next tick (about a minute) -> the status + requested
  POST /v1/tenants/{tenant_id}/integrations/google-calendar/disconnect   the Owner: revoke at Google, stop the channel, delete our copy of the token and every row; events already written stay
  GET  /v1/integrations/google-calendar/callback                         PUBLIC (Google sends the browser): 303 to the web's settings page with ?google_calendar=<result>
  POST /v1/integrations/google-calendar/push                             PUBLIC (Google's push notification; headers only): always 200; a verified one asks for a busy-times refresh
Without the OAuth client (GOOGLE_OAUTH_CLIENT_ID / _SECRET) every route but the status answers 409 not_configured; the status says configured: false. This API has no DELETE verb."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, ConfigDict

from app.auth.deps import (
    AnyMember,
    OwnerOrAdmin,
    Runtime,
    TenantContext,
    get_runtime,
    require_tenant_role,
)
from app.errors import ApiError
from app.google_calendar.google import GoogleError
from app.google_calendar.repository import LinkStateError, NotConnectedError
from app.google_calendar.service import GoogleCalendarService
from app.tenancy.models import Role
from app.tenancy.repository import TokenRejected
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.google_calendar.routes")

member_router = APIRouter(prefix="/v1/tenants/{tenant_id}/integrations/google-calendar", tags=["google-calendar"])
public_router = APIRouter(prefix="/v1/integrations/google-calendar", tags=["google-calendar"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]

NOT_CONFIGURED = (409, "not_configured", "This feature is not set up on this system yet.")
NOT_CONNECTED = (409, "google_calendar_not_connected", "Google Calendar is not connected.")
TRY_LATER = (429, "google_calendar_try_later", "Too many connection attempts. Try again in a few minutes.")
NEEDS_RECONNECT = (409, "google_calendar_needs_reconnect", "Connect Google Calendar again: Google no longer accepts the old permission.")
GOOGLE_DOWN = (502, "google_calendar_unavailable", "Google did not answer. Try again in a moment.")
SECRETS_DOWN = (503, "google_calendar_secret_unavailable", "The connection's key store did not answer. Try again in a moment.")
STATUS_OFF: dict[str, Any] = {"configured": False, "connected": False, "status": "not_connected", "google_email": None, "calendar_id": None, "calendar_name": None,
                              "write_events": False, "block_busy": False, "last_synced_at": None, "last_error_code": None}


class SettingsIn(BaseModel):
    """write_events: copy every appointment to the Owner's primary Google Calendar. block_busy: times that are busy in that calendar cannot be booked."""

    model_config = ConfigDict(extra="forbid", strict=True)
    write_events: bool
    block_busy: bool


def _service(runtime: Runtime) -> GoogleCalendarService:
    svc = getattr(runtime, "google_calendar", None)
    if svc is None:
        raise ApiError(*NOT_CONFIGURED)
    return svc  # type: ignore[no-any-return]


def _mapped(exc: Exception) -> ApiError | None:
    if isinstance(exc, NotConnectedError):
        return ApiError(*NOT_CONNECTED)
    if isinstance(exc, LinkStateError):
        return ApiError(*TRY_LATER, headers={"Retry-After": "600"})
    if isinstance(exc, GoogleError):
        return ApiError(*NEEDS_RECONNECT) if exc.code == "revoked" else ApiError(*GOOGLE_DOWN)
    if isinstance(exc, SecretStoreError):
        return ApiError(*SECRETS_DOWN)
    return None


def _run(fn: Any, *args: Any) -> Any:
    try:
        return fn(*args)
    except (NotConnectedError, LinkStateError, GoogleError, SecretStoreError) as exc:
        mapped = _mapped(exc)
        assert mapped is not None  # noqa: S101
        raise mapped from None


@member_router.get("/status")
def google_calendar_status(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    """Is Google Calendar connected, and how is it set (any member)."""
    svc = getattr(runtime, "google_calendar", None)
    if svc is None:
        return dict(STATUS_OFF)
    return _run(svc.status, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@member_router.post("/connect")
def google_calendar_connect(ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    """Start connecting Google Calendar: the address of Google's consent screen (the Owner, second factor)."""
    return _run(_service(runtime).connect, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@member_router.put("/settings")
def google_calendar_settings(body: SettingsIn, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    """Write appointments to Google Calendar, and block the busy times of that calendar (the Owner)."""
    return _run(_service(runtime).settings, ctx.principal.token, ctx.tenant.id, body.write_events, body.block_busy)  # type: ignore[no-any-return]


@member_router.post("/sync-now")
def google_calendar_sync_now(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Sync with Google Calendar now (within about a minute)."""
    return _run(_service(runtime).sync_now, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@member_router.post("/disconnect")
def google_calendar_disconnect(ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    """Disconnect Google Calendar: the permission is withdrawn at Google and our copy deleted; events already written stay (the Owner)."""
    return _run(_service(runtime).disconnect, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


_NO_STORE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"}


@public_router.get("/callback")
def google_calendar_callback(request: Request, runtime: RuntimeDep) -> Response:
    """Google sends the browser back here after the consent screen. Never answers with data: a redirect to the web's settings page."""
    svc = _service(runtime)
    q = request.query_params
    try:
        target = svc.callback(q.get("code"), q.get("state"), q.get("error"))
    except TokenRejected:
        svc.scheduler.invalidate()   # the shared scheduler sign-in is made again on the next request
        target = svc.back(None, "error")
    except Exception as exc:   # the browser always lands on the settings page; the reason is a class name in the log
        logger.error("google calendar callback failed: %s", exc.__class__.__name__)
        target = svc.back(None, "error")
    return RedirectResponse(target, status_code=303, headers=_NO_STORE)


@public_router.post("/push")
def google_calendar_push(request: Request, runtime: RuntimeDep) -> Response:
    """Google's push notification of a change in the watched calendar (headers only). Always 200: Google learns nothing from the answer."""
    svc = _service(runtime)
    h = request.headers
    try:
        outcome = svc.push(h.get("x-goog-channel-id"), h.get("x-goog-channel-token"), h.get("x-goog-resource-id"), h.get("x-goog-resource-state"))
    except TokenRejected:
        svc.scheduler.invalidate()
        outcome = "error"
    except Exception as exc:
        logger.error("google calendar push failed: %s", exc.__class__.__name__)
        outcome = "error"
    logger.info("google calendar push: %s", outcome)
    return Response(status_code=200, headers={"Cache-Control": "no-store"})
