"""Compress the API's answers (planner, 19 Nov 2026): the Today summary is 214 KB of JSON and was sent as it is (about 1.1 s on a 1.5 Mbps phone link); gzip makes it about a tenth of that. Server-sent events (the assistant's
streamed answers) are never compressed (Starlette's own exclusion), and the in-process reads of the bootstrap and the Today summary are not compressed either: they never leave the process."""

from __future__ import annotations

from typing import Any

from starlette.middleware.gzip import GZipMiddleware
from starlette.types import Receive, Scope, Send

INTERNAL = b"x-internal-bootstrap"   # app.bootstrap.routes.INTERNAL_HEADER, as bytes (not imported: this module stays free of the routes)


class CompressResponses:
    def __init__(self, app: Any, *, minimum_size: int = 1024, compresslevel: int = 5) -> None:
        self.app = app
        self._gzip = GZipMiddleware(app, minimum_size=minimum_size, compresslevel=compresslevel)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and any(name == INTERNAL for name, _ in scope["headers"]):
            await self.app(scope, receive, send)
            return
        await self._gzip(scope, receive, send)
