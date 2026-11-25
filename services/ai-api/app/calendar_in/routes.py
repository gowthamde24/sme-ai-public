"""Calendars in (docs/contracts/commerce-notify.md section D). Off unless CALENDAR_IN=on: every route answers 404.

  GET  /v1/tenants/{tenant_id}/calendars/connections                    any member: the three cards (calendly, calcom, outlook): state connected | not_connected | needs_setup, label, last4, booking link, counts
  GET  /v1/tenants/{tenant_id}/calendars/bookings/needs-person          any member: bookings that did not fit a free slot (a person places them)
  POST /v1/tenants/{tenant_id}/calendars/calendly/connect               Owner or Admin: {access_token, booking_link?} -> {connection}: we make the Calendly webhook with the owner's personal access token
  POST /v1/tenants/{tenant_id}/calendars/calcom/connect                 Owner or Admin: {booking_link?, label?} -> {connection, setup {webhook_url, secret, triggers, steps}}: the secret is shown THIS ONCE
  PUT  /v1/tenants/{tenant_id}/calendars/{kind}/settings                Owner or Admin: {booking_link?, share_link?, consent_question?, write_events?, block_busy?} -> {connection}
  POST /v1/tenants/{tenant_id}/calendars/{kind}/disconnect              Owner or Admin: -> {disconnected, events_kept}
  POST /v1/tenants/{tenant_id}/calendars/outlook/start                  the Owner: -> {authorize_url, expires_at} (a full-page navigation); 409 calendar_needs_setup until Stack19 has registered its Microsoft app
  GET  /v1/calendars/outlook/callback                                   PUBLIC (Microsoft sends the browser): 303 to the web's connectors page with ?calendar_outlook=<result>
  POST /v1/webhooks/calendars/{kind}/{token}                            PUBLIC (Calendly, Cal.com): the signature is checked on the raw body; 200 for anything understood, ignored or repeated; 401 bad signature; 404 unknown address; 503 our side failed
This API has no DELETE verb. NOTE: no `from __future__ import annotations` (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import (
    Runtime,
    TenantContext,
    get_runtime,
    require_tenant_role,
)
from app.calendar_in import service as svc_mod
from app.calendar_in.microsoft import MicrosoftError
from app.calendar_in.repository import LinkStateError, NotConnectedError
from app.calendar_in.service import CalendarInService
from app.errors import ApiError, not_found
from app.tenancy.models import Role
from app.tenancy.repository import TokenRejected
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.calendar_in.routes")

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def _on(runtime: RuntimeDep) -> None:
    """The kill switch, checked before anything else (a body that does not fit is a 404 too while the switch is off)."""
    if getattr(runtime, "calendar_in", None) is None:
        raise not_found()


member_router = APIRouter(prefix="/v1/tenants/{tenant_id}/calendars", tags=["calendars"])


def _after_the_door(*roles: Role, strong: bool = False) -> Any:
    """The kill switch, checked right AFTER the role and read-only door (so a read-only workspace is refused first, like every other write) and BEFORE the body is read (a body that does not fit is a 404 too while the switch is off)."""

    def dependency(ctx: Annotated[TenantContext, Depends(require_tenant_role(*roles, strong=strong))], runtime: RuntimeDep) -> TenantContext:
        _on(runtime)
        return ctx

    return Depends(dependency)


AnyMember = Annotated[TenantContext, _after_the_door()]
OwnerOrAdmin = Annotated[TenantContext, _after_the_door(Role.OWNER, Role.ADMIN)]
public_router = APIRouter(prefix="/v1", tags=["calendars"], dependencies=[Depends(_on)])
Owner = Annotated[TenantContext, _after_the_door(Role.OWNER, strong=True)]
Kind = Literal["calendly", "calcom", "outlook"]
_NO_STORE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"}
OK = {"ok": True}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CalendlyConnectIn(_Strict):
    access_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=2500, pattern=r"^[A-Za-z0-9._~+/=-]+$")]
    booking_link: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None


class CalcomConnectIn(_Strict):
    booking_link: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None = None


class SettingsIn(_Strict):
    booking_link: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None
    share_link: bool | None = None
    consent_question: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    write_events: bool | None = None
    block_busy: bool | None = None


def _service(runtime: Runtime) -> CalendarInService:
    service = getattr(runtime, "calendar_in", None)
    if service is None:   # CALENDAR_IN=off: as if it were not there
        raise not_found()
    return service.with_leads(getattr(runtime, "lead_sources", None))  # type: ignore[no-any-return]


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except NotConnectedError:
        raise ApiError(*svc_mod.NOT_CONNECTED) from None
    except LinkStateError:
        raise ApiError(*svc_mod.TRY_LATER, headers={"Retry-After": "600"}) from None
    except MicrosoftError as exc:
        raise (ApiError(*svc_mod.NEEDS_RECONNECT) if exc.code == "revoked" else ApiError(*svc_mod.VENDOR_DOWN)) from None
    except SecretStoreError:
        raise ApiError(*svc_mod.SECRETS_DOWN) from None


@member_router.get("/connections")
def calendars_connections(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    """The cards: Calendly, Cal.com and Outlook with their state (any member). Never a key or an address of the door."""
    return _run(_service(runtime).connections, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@member_router.get("/bookings/needs-person")
def calendars_needs_person(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    """Bookings made on a booking page that did not fit a free slot of the visits calendar: a person places them (any member)."""
    return _run(_service(runtime).needs_person, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@member_router.post("/calendly/connect")
def calendars_calendly_connect(body: CalendlyConnectIn, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Connect Calendly with the owner's personal access token (Owner or Admin). The token is kept in the key store, never shown again."""
    return _run(_service(runtime).connect_calendly, ctx.principal.token, ctx.tenant.id, body.access_token, body.booking_link)  # type: ignore[no-any-return]


@member_router.post("/calcom/connect")
def calendars_calcom_connect(body: CalcomConnectIn, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Connect Cal.com: the address and secret to paste into Cal.com's webhook settings (Owner or Admin). The secret is shown this once."""
    return _run(_service(runtime).connect_calcom, ctx.principal.token, ctx.tenant.id, body.booking_link, body.label)  # type: ignore[no-any-return]


@member_router.put("/{kind}/settings")
def calendars_settings(kind: Kind, body: SettingsIn, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """The booking page address, "share my booking link", the consent question (Calendly, Cal.com) and write events / block busy times (Outlook)."""
    return _run(  # type: ignore[no-any-return]
        _service(runtime).settings, ctx.principal.token, ctx.tenant.id, kind, booking_link=body.booking_link, share_link=body.share_link, write_events=body.write_events,
        block_busy=body.block_busy, consent_question=body.consent_question)


@member_router.post("/{kind}/disconnect")
def calendars_disconnect(kind: Kind, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Disconnect: the door stops answering, the key is deleted, Calendly's webhook is removed; events already written to Outlook stay (Owner or Admin)."""
    return _run(_service(runtime).disconnect, ctx.principal.token, ctx.tenant.id, kind)  # type: ignore[no-any-return]


@member_router.post("/outlook/start")
def calendars_outlook_start(ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    """Start connecting Outlook: the address of Microsoft's consent screen (the Owner)."""
    return _run(_service(runtime).outlook_start, ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@public_router.get("/calendars/outlook/callback")
def calendars_outlook_callback(request: Request, runtime: RuntimeDep) -> Response:
    """Microsoft sends the browser back here. Never answers with data: a redirect to the web's connectors page."""
    service = _service(runtime)
    q = request.query_params
    try:
        target = service.outlook_callback(q.get("code"), q.get("state"), q.get("error"))
    except TokenRejected:
        service.scheduler.invalidate()
        target = service.back(None, "error")
    except Exception as exc:   # the browser always lands on the page; the reason is a class name in the log
        logger.error("outlook callback failed: %s", exc.__class__.__name__)
        target = service.back(None, "error")
    return RedirectResponse(target, status_code=303, headers=_NO_STORE)


@public_router.post("/webhooks/calendars/{kind}/{token}")
async def calendars_webhook(kind: str, token: str, request: Request, runtime: RuntimeDep) -> Response:
    """Calendly's and Cal.com's booking messages. Believed only through the vendor's own signature over the raw body."""
    service = _service(runtime)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > svc_mod.MAX_BODY:
        raise ApiError(413, "too_large", "Too large.")
    raw = await request.body()
    if len(raw) > svc_mod.MAX_BODY:
        raise ApiError(413, "too_large", "Too large.")
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        outcome = service.receive(kind, token, raw, headers)
    except TokenRejected:
        service.scheduler.invalidate()
        outcome = "unavailable"
    except Exception as exc:   # OUR side failed: the vendor retries
        logger.error("calendar webhook failed: %s", exc.__class__.__name__)
        outcome = "unavailable"
    logger.info("calendar webhook: kind=%s outcome=%s", kind if kind in svc_mod.KINDS else "other", outcome)   # closed words only: never a body, a name or a number
    if outcome == "unknown":
        raise not_found()
    if outcome == "bad_signature":
        raise ApiError(401, "unauthorized", "Not authorised.")
    if outcome == "unavailable":
        raise ApiError(503, "calendar_unavailable", "Not available right now.")
    return JSONResponse(OK, headers=_NO_STORE)
