"""Readiness and metrics (job CB, ADR 0082). /health says the process is up (liveness: no dependency is touched, so a database outage does not make an orchestrator kill a healthy process). /ready says it can
serve: it asks the data layer one cheap question and answers 200 or 503 with a fixed word per check, never an error text. /metrics is OFF unless METRICS_TOKEN is set; then it needs `Authorization: Bearer <that token>`
(constant-time compare), and answers 404 to everyone else so a scan learns nothing."""

import hmac
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from app.hardening.observe import Metrics

logger = logging.getLogger("app.hardening.ops")
# no `from __future__ import annotations` here: the dependency below is a local function named in an annotation


def build_router(metrics: Metrics, metrics_token: str | None) -> APIRouter:
    router = APIRouter()

    def runtime_of(request: Request) -> Any:
        return getattr(request.app.state, "runtime", None)

    @router.get("/ready")
    def ready(request: Request) -> JSONResponse:
        runtime = runtime_of(request)
        checks: dict[str, str] = {}
        repository = getattr(runtime, "repository", None)
        ping = getattr(repository, "ping", None)
        if runtime is None:
            checks["auth"] = "not_configured"
        else:
            checks["auth"] = "ok"
        if ping is not None:
            checks["database"] = "ok" if ping() else "down"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks}, status_code=200 if ok else 503)

    def authorised(request: Request) -> bool:
        if not metrics_token:
            return False
        header = request.headers.get("authorization", "")
        scheme, _, given = header.partition(" ")
        return scheme.lower() == "bearer" and hmac.compare_digest(given.strip().encode(), metrics_token.encode())

    def guard(request: Request) -> None:
        if not authorised(request):
            from app.errors import not_found

            raise not_found()

    @router.get("/metrics", response_class=PlainTextResponse)
    def scrape(_: Annotated[None, Depends(guard)]) -> PlainTextResponse:
        return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")

    return router
