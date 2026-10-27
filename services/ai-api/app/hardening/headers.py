"""Security headers and a size limit for every API response and request (job CB, ADR 0082). The API returns JSON for programs, never a page: so nothing may be framed, sniffed, cached by a shared cache or
sent a referrer, and no script, style or image may load from a response. (The web app has its own headers, apps/web/lib/security/headers.ts.) HSTS only in production, where the API is served over https.

Request size: a declared Content-Length over MAX_BODY_BYTES is refused with 413 before anything is read; a body that has no length (chunked) is counted as it arrives and cut off at the same limit. Routes that take
files have their own smaller limits; this is the ceiling under all of them."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.errors import error_body, request_id_of

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

MAX_BODY_BYTES = 20 * 1024 * 1024

_DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


def api_headers(production: bool, documentation: bool) -> list[tuple[bytes, bytes]]:
    csp = b"default-src 'none'; frame-ancestors 'none'" if not documentation else b"frame-ancestors 'none'"
    headers = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"no-referrer"),
        (b"cross-origin-resource-policy", b"same-site"),
        (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
        (b"content-security-policy", csp),
    ]
    if not documentation:
        headers.append((b"cache-control", b"no-store"))
    if production:
        headers.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains; preload"))
    return headers


class TooLarge(Exception):
    pass


class SecurityHeadersMiddleware:
    def __init__(self, app: Any, *, production: bool = False, max_body: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.production = production
        self.max_body = max_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        documentation = scope["path"] in _DOC_PATHS or scope["path"].startswith("/docs/")
        extra = api_headers(self.production, documentation)
        started = False

        async def respond(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                present = {k.lower() for k, _ in message.get("headers", [])}
                message = dict(message)
                message["headers"] = [*message.get("headers", []), *[(k, v) for k, v in extra if k not in present]]
            await send(message)

        declared = next((v for k, v in scope["headers"] if k == b"content-length"), None)
        if declared is not None and declared.isdigit() and int(declared) > self.max_body:
            await self._too_large(respond, scope)
            return

        seen = 0

        async def counted() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_body:
                    raise TooLarge
            return message

        try:
            await self.app(scope, counted, respond)
        except TooLarge:
            if not started:
                await self._too_large(respond, scope)

    @staticmethod
    async def _too_large(send: Send, scope: Scope) -> None:
        body = json.dumps(error_body("payload_too_large", "The request is too large.", request_id=request_id_of(scope))).encode()
        await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
