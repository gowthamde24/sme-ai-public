"""The API activity log: one row per request to /api/v1 made with a valid key (route template, method, status, latency, key id; kept 30 days). Never a body, a query string, an address or the key itself.
Writing the row can never change the answer: a failure is logged without the key and forgotten."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.developer_api import keys as K
from app.errors import ApiError

logger = logging.getLogger("app.developer_api")


async def record(request: Request, route: str, status: int, started: float) -> None:
    runtime = getattr(request.app.state, "runtime", None)
    api = getattr(runtime, "developer_api", None)
    secret = K.bearer(request.headers.get("authorization"))
    if api is None or secret is None:
        return
    latency_ms = max(0, int((time.perf_counter() - started) * 1000))
    try:
        worker = api.worker()
        await asyncio.to_thread(api.repo.activity_log, worker, K.key_hash(secret), request.method, route, status, latency_ms)
    except Exception:   # noqa: BLE001 - the log is a side note: the answer to the program does not wait on it
        logger.warning("developer api activity not logged")


class ActivityRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()
        template = self.path

        async def handler(request: Request) -> Response:
            started, status = time.perf_counter(), 500
            try:
                response = await original(request)
                status = response.status_code
                return response
            except ApiError as exc:
                status = exc.status_code
                raise
            except RequestValidationError:
                status = 422
                raise
            except (HTTPException, StarletteHTTPException) as exc:
                status = exc.status_code
                raise
            finally:
                await record(request, template, status, started)

        return handler
