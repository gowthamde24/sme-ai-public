"""One error shape for the whole API: {"error": {"code": ..., "message": ...}}.

Messages are deliberately generic for auth failures: the reason goes to the server log, never to
the client, and never includes the token.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.errors")


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers or {}


def unauthorized() -> ApiError:
    return ApiError(
        401,
        "unauthorized",
        "Invalid or missing credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def not_found() -> ApiError:
    # Used for unknown AND foreign tenants alike, so existence is never revealed.
    return ApiError(404, "not_found", "Not found.")


def mfa_required() -> ApiError:
    """ADR 0016: a password-only (aal1) Owner or Admin meets an action needing a second factor."""
    return ApiError(
        403,
        "mfa_required",
        "Confirm with your authenticator app to do this: sign in again and enter your code, "
        "or set up the app first.",
    )


def forbidden() -> ApiError:
    return ApiError(403, "forbidden", "Your role does not allow this action.")


def _body(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            _body(exc.code, exc.message), status_code=exc.status_code, headers=exc.headers
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(_body(code, "Request failed."), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Field names only. Never echo submitted values back.
        fields = sorted({".".join(str(p) for p in e["loc"] if p != "body") for e in exc.errors()})
        return JSONResponse(
            _body("validation_error", "Invalid input: " + ", ".join(f for f in fields if f)),
            status_code=422,
        )
