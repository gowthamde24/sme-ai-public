"""Origin lock (job DT, security audit): the Cloud Run services are reachable at their own addresses, which would let anyone skip Cloudflare's firewall, bot checks and rate limits. When ORIGIN_LOCK_SECRET
is set, every request must carry the same secret in `X-Stack19-Origin` (the Cloudflare Worker adds it; so do our own server-to-server callers: the web's server, the worker job, the demo refresh). The
health and readiness probes are exempt (Cloud Run's own checks cannot send it). The comparison is constant-time; a refusal is a plain 403 in the one error shape and says nothing about why. Unset =
no lock, so nothing changes until the owner has put the secret in the Worker (docs/runbooks/origin-lock.md)."""

from __future__ import annotations

import hmac
import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.errors import error_body, request_id_of

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

HEADER = b"x-stack19-origin"
EXEMPT = ("/health", "/ready")


def origin_ok(provided: bytes | None, secret: str) -> bool:
    return provided is not None and hmac.compare_digest(provided, secret.encode())


class OriginLockMiddleware:
    def __init__(self, app: Any, *, secret: str | None) -> None:
        self.app = app
        self.secret = secret or None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.secret is None or scope["type"] != "http" or scope["path"] in EXEMPT:
            await self.app(scope, receive, send)
            return
        provided = next((v for k, v in scope["headers"] if k == HEADER), None)
        if origin_ok(provided, self.secret):
            await self.app(scope, receive, send)
            return
        body = json.dumps(error_body("forbidden", "Not allowed.", request_id=request_id_of(scope))).encode()
        await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
