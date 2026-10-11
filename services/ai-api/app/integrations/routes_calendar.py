"""The visits calendar feed (job BI, ADR 0073).

  POST   /v1/tenants/{tenant_id}/calendar-feed     any member: make (or rotate) YOUR private address. The answer carries the token ONCE: {token, path, created_at}; only its SHA-256 is stored.
  GET    /v1/tenants/{tenant_id}/calendar-feed     any member: {active, created_at, last_used_at}; never the token
  POST   /v1/tenants/{tenant_id}/calendar-feed/revoke   any member: revoke YOUR address at once (a POST: this API has no DELETE endpoint anywhere)
  GET    /v1/calendar/feed/{token}.ics             NO sign-in (a calendar app has none): the upcoming visits as iCalendar. 404 for an unknown, revoked or malformed token (one answer for all of them).

Rate limits (in this process's memory; best effort): 60 reads an hour per token, 240 per 10 minutes per client address, and 20 unknown tokens per 10 minutes per client address (a scan).
The address a person gives their calendar app is the API's public address + `path`. The feed shows when, how long, the state, the party size and "first name + last initial"; never a phone number,
e-mail, note, purpose or company."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.auth.deps import AnyMember, Runtime, get_runtime
from app.errors import ApiError, not_found
from app.integrations.ics import build_calendar
from app.integrations.ratelimit import SlidingWindow
from app.integrations.repository import IntegrationsRepository

logger = logging.getLogger("app.integrations.calendar")

member_router = APIRouter(prefix="/v1/tenants/{tenant_id}/calendar-feed", tags=["calendar"])
public_router = APIRouter(prefix="/v1/calendar", tags=["calendar"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]

TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")
PER_TOKEN = SlidingWindow(60, 3600)
PER_ADDRESS = SlidingWindow(240, 600)
UNKNOWN_PER_ADDRESS = SlidingWindow(20, 600)


def _repo(runtime: Runtime) -> IntegrationsRepository:
    if runtime.integrations is None:
        raise ApiError(503, "integrations_unavailable", "The calendar feed is not available on this system.")
    return runtime.integrations


def sha256_hex(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


@member_router.post("", status_code=201)
def make_feed(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)  # 43 characters of URL-safe base64: 256 bits
    state = _repo(runtime).calendar_create(ctx.principal.token, ctx.tenant.id, sha256_hex(token))
    return {"token": token, "path": f"/v1/calendar/feed/{token}.ics", "created_at": state.get("created_at"), "shown_once": True}


@member_router.get("")
def feed_status(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _repo(runtime).calendar_status(ctx.principal.token, ctx.tenant.id)


@member_router.post("/revoke")
def revoke_feed(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _repo(runtime).calendar_revoke(ctx.principal.token, ctx.tenant.id)


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _too_many(seconds: int) -> ApiError:
    return ApiError(429, "rate_limited", "Too many requests. Try again later.", headers={"Retry-After": str(seconds)})


@public_router.get("/feed/{token_ics}")
def read_feed(token_ics: str, request: Request, runtime: RuntimeDep) -> Response:
    who = _client(request)
    if not PER_ADDRESS.allow(who):
        raise _too_many(PER_ADDRESS.retry_after(who))
    token = token_ics[:-4] if token_ics.endswith(".ics") else ""
    if not TOKEN.fullmatch(token):
        if not UNKNOWN_PER_ADDRESS.allow(who):
            raise _too_many(UNKNOWN_PER_ADDRESS.retry_after(who))
        raise not_found()
    digest = sha256_hex(token)
    if not PER_TOKEN.allow(digest):
        raise _too_many(PER_TOKEN.retry_after(digest))
    feed = _repo(runtime).calendar_read(digest)
    if feed is None:
        if not UNKNOWN_PER_ADDRESS.allow(who):
            raise _too_many(UNKNOWN_PER_ADDRESS.retry_after(who))
        raise not_found()
    return Response(
        content=build_calendar(feed),
        media_type="text/calendar",
        headers={
            "Content-Type": "text/calendar; charset=utf-8",
            "Cache-Control": "private, max-age=300",
            "X-Robots-Tag": "noindex, nofollow",
            "Referrer-Policy": "no-referrer",
            "Content-Disposition": 'inline; filename="store-visits.ics"',
        },
    )
