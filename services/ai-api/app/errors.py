"""One error shape for the whole API (job CD): every refusal, from every router, the middleware and the handlers, is

    {"error": {"code": "<closed word>", "message": "<a fixed sentence>", "retry_after": <seconds> | null, "request_id": "<the x-request-id of this response>", ...closed extras}}

`code` is what the web maps to a page or a sentence; `retry_after` (whole seconds, also sent as the Retry-After header) is set only when waiting helps (429, a pause); `request_id` is the id the person can
quote to the owner, and it is the same id as the `x-request-id` response header and the access log line. Extras are closed and never carry a submitted value: `reason` (a closed word), `until` (a time),
`fields` (the NAMES of the fields a 422 refused). Everything is built here, in `error_body`: a test fails if another file builds an error body.

Messages are deliberately generic for auth failures: the reason goes to the server log, never to
the client, and never includes the token.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.observability.sentry import capture as sentry_capture

logger = logging.getLogger("app.errors")


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers or {}
        # closed, non-secret fields added next to code and message (e.g. `until` of ai_paused_until)
        self.extra = extra or {}
        self.retry_after = retry_after if retry_after is not None else retry_after_of(self.headers)
        if self.retry_after is not None and not any(k.lower() == "retry-after" for k in self.headers):
            self.headers = {**self.headers, "Retry-After": str(self.retry_after)}


def retry_after_of(headers: dict[str, str] | None) -> int | None:
    """Whole seconds from a Retry-After header (the number form only), else None."""
    for key, value in (headers or {}).items():
        if key.lower() == "retry-after" and value.strip().isdigit():
            return int(value.strip())
    return None


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


def mfa_required(reason: str | None = None) -> ApiError:
    """ADR 0016, changed by ADR 0115: the authenticator is OPTIONAL; a person who turned it on enters the code once per sign-in session (the session then stays at aal2) and meets this on a sensitive action
    before that. `reason` is `second_factor` when the API knows why; without it the database refused."""
    return ApiError(
        403,
        "mfa_required",
        "Confirm with your authenticator app to do this: sign in again and enter your code, "
        "or set up the app first.",
        extra={"reason": reason} if reason else None,
    )


def forbidden() -> ApiError:
    return ApiError(403, "forbidden", "Your role does not allow this action.")


def error_body(
    code: str,
    message: str,
    *,
    retry_after: int | None = None,
    request_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """The one error body. Extras cannot overwrite the four fixed keys."""
    fixed = {"code": code, "message": message, "retry_after": retry_after, "request_id": request_id}
    return {"error": {**{k: v for k, v in (extra or {}).items() if k not in fixed}, **fixed}}


def request_id_of(scope: Any) -> str | None:
    """The id the outermost middleware (hardening/observe.py) made or kept for this request."""
    state = scope.get("state") if hasattr(scope, "get") else None
    value = state.get("request_id") if isinstance(state, dict) else None
    return value if isinstance(value, str) else None


def api_error_response(exc: ApiError, request_id: str | None) -> JSONResponse:
    return JSONResponse(
        error_body(exc.code, exc.message, retry_after=exc.retry_after, request_id=request_id, extra=exc.extra),
        status_code=exc.status_code,
        headers=exc.headers,
    )


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    429: "rate_limited",
}


ERROR_SCHEMA = "ApiErrorBody"
_ERROR_REF = {"$ref": f"#/components/schemas/{ERROR_SCHEMA}"}
_ERROR_DESCRIPTIONS = {
    "401": "Not signed in, or the sign-in is no longer valid (code unauthorized).",
    "403": "Signed in, but not allowed: forbidden (the role), mfa_required (a second factor is needed) or a closed reason code.",
    "404": "Not found, or not yours: a foreign and an unknown workspace look the same (code not_found).",
    "422": "The input was refused: code validation_error and the NAMES of the fields in `fields`.",
    "429": "Too many requests: wait `retry_after` seconds (also the Retry-After header).",
    "500": "Something went wrong on our side (code internal_error); quote `request_id`.",
}


def _error_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["error"],
        "properties": {
            "error": {
                "type": "object",
                "required": ["code", "message", "retry_after", "request_id"],
                "properties": {
                    "code": {"type": "string"},
                    "message": {"type": "string"},
                    "retry_after": {"type": ["integer", "null"], "minimum": 0},
                    "request_id": {"type": ["string", "null"]},
                    "fields": {"type": "array", "items": {"type": "string"}},
                    "reason": {"type": "string"},
                    "until": {"type": "string"},
                },
            }
        },
    }


def install_error_documentation(app: FastAPI) -> None:
    """The error body in the OpenAPI document: one schema, named on every operation's 422/429/500 (and 401/403/404 on the signed-in /v1/tenants and /v1/me routes), replacing FastAPI's own 422 shape."""
    base = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = base()
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        components[ERROR_SCHEMA] = _error_schema()
        components.pop("HTTPValidationError", None)
        components.pop("ValidationError", None)
        for path, item in schema.get("paths", {}).items():
            signed_in = path.startswith(("/v1/tenants", "/v1/me"))
            for method, operation in item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                responses = operation.setdefault("responses", {})
                wanted = ["422", "429", "500"] + (["401", "403", "404"] if signed_in else [])
                for status in wanted:
                    if status == "422" and "422" not in responses and not (operation.get("requestBody") or operation.get("parameters")):
                        continue
                    responses[status] = {"description": _ERROR_DESCRIPTIONS[status], "content": {"application/json": {"schema": _ERROR_REF}}}
        app.openapi_schema = schema
        return schema

    app.openapi = openapi  # type: ignore[method-assign]


def install_error_handlers(app: FastAPI) -> None:
    install_error_documentation(app)

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return api_error_response(exc, request_id_of(request.scope))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        headers = {k: v for k, v in (exc.headers or {}).items() if k.lower() in ("allow", "www-authenticate", "retry-after")}
        return JSONResponse(
            error_body(
                _STATUS_CODES.get(exc.status_code, "http_error"),
                "Request failed.",
                retry_after=retry_after_of(headers),
                request_id=request_id_of(request.scope),
            ),
            status_code=exc.status_code,
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field names only. Never echo submitted values back.
        fields = sorted({".".join(str(p) for p in e["loc"] if p != "body") or "body" for e in exc.errors()})  # "body": the whole body was the wrong kind of thing
        return JSONResponse(
            error_body(
                "validation_error",
                "Invalid input: " + ", ".join(fields),
                request_id=request_id_of(request.scope),
                extra={"fields": fields},
            ),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, _exc: Exception) -> JSONResponse:
        # Nothing about the failure reaches the client. The server still logs the exception itself (the handler runs in Starlette's outermost layer, which re-raises), and the access line carries the same request id.
        request_id = request_id_of(request.scope)
        sentry_capture(_exc, request_id)   # job DP part 6: a no-op unless SENTRY_DSN is set; class name and stack only (app/observability/sentry.py)
        return JSONResponse(
            error_body("internal_error", "Something went wrong on our side.", request_id=request_id),
            status_code=500,
            headers={"x-request-id": request_id} if request_id else None,  # this response leaves from outside the request-id middleware
        )
