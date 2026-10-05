"""Erasure data access behind an interface (PostgREST today). Every call carries the CALLER's
JWT, so RLS decides what is visible and the definer functions re-check who may request, run or
cancel. Errors are classified by SQLSTATE alone: the data layer's own text is never read into an
exception, a log line or a response."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from app.crm.models import Page, encode_cursor
from app.crm.repository import (
    ConflictError,
    InvalidReferenceError,
    InvalidValueError,
    NotFoundError,
)
from app.erasure.models import DataPolicyOut, ErasureRequestOut, ErasureResultOut
from app.tenancy.repository import Forbidden, RepositoryError, TokenRejected, UpstreamError

logger = logging.getLogger("app.erasure.repository")

SELECT = (
    "id,scope,subject_id,status,requested_by,created_at,execute_after,executed_by,executed_at,"
    "cancelled_by,cancelled_at,result"
)
_SQLSTATE = re.compile(r"^(?:[0-9A-Z]{5}|PGRST\d{3})$")


class NotPendingError(RepositoryError):
    """SM301"""


class WindowNotElapsedError(RepositoryError):
    """SM302"""


class AlreadyExecutedError(RepositoryError):
    """SM303"""


class RequestCancelledError(RepositoryError):
    """SM304"""


class OwnerTransferFirstError(RepositoryError):
    """SM305: the last Owner cannot erase their own record."""


class ErasureRepository(Protocol):
    def request(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        request_id: uuid.UUID,
        scope: str,
        subject_id: uuid.UUID | None,
    ) -> bool:
        """Record a pending request. Returns True for a replay."""
        ...

    def get(
        self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID
    ) -> ErasureRequestOut | None: ...

    def list(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> Page[ErasureRequestOut]: ...

    def execute(self, token: str, request_id: uuid.UUID, *, dry_run: bool) -> ErasureResultOut: ...

    def cancel(self, token: str, request_id: uuid.UUID) -> bool:
        """Cancel a pending request. Returns True for a replay."""
        ...

    def data_policy(self, token: str, tenant_id: uuid.UUID) -> DataPolicyOut: ...


def classify_error(status: int, body: Any, *, hide_denial: bool) -> RepositoryError:
    """SQLSTATE -> one of our exceptions. `hide_denial`: a generic 42501 means "not found"."""
    code = ""
    if isinstance(body, dict):
        raw = body.get("code")
        code = raw if isinstance(raw, str) and _SQLSTATE.fullmatch(raw) else ""
    logger.info("erasure data layer refused: http=%s sqlstate=%s", status, code or "-")
    if status == 401 or code.startswith("PGRST30"):
        return TokenRejected(code or "401")
    if code == "42501":
        return NotFoundError(code) if hide_denial else Forbidden(code)
    mapped: dict[str, type[RepositoryError]] = {
        "SM301": NotPendingError,
        "SM302": WindowNotElapsedError,
        "SM303": AlreadyExecutedError,
        "SM304": RequestCancelledError,
        "SM305": OwnerTransferFirstError,
        "23505": ConflictError,
        "23503": InvalidReferenceError,
        "22023": InvalidValueError,
    }
    if code in mapped:
        return mapped[code](code)
    logger.warning(
        "erasure data layer returned an unexpected error: http=%s sqlstate=%s", status, code or "-"
    )
    return UpstreamError(f"unexpected data-layer response ({status})")


def parse_request(row: Any) -> ErasureRequestOut:
    try:
        return ErasureRequestOut.model_validate(row)
    except (ValidationError, TypeError, ValueError):
        logger.error("erasure data layer returned a request that does not match ErasureRequestOut")
        raise UpstreamError("unexpected row shape") from None


class PostgrestErasureRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(120.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _send(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        hide_denial: bool = False,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("erasure data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise classify_error(response.status_code, body, hide_denial=hide_denial)

    def _rpc(
        self, token: str, name: str, args: dict[str, Any], *, hide_denial: bool
    ) -> dict[str, Any]:
        result = self._send("POST", f"/rpc/{name}", token, json=args, hide_denial=hide_denial)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def request(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        request_id: uuid.UUID,
        scope: str,
        subject_id: uuid.UUID | None,
    ) -> bool:
        result = self._rpc(
            token,
            "request_erasure",
            {
                "p_request_id": str(request_id),
                "p_tenant_id": str(tenant_id),
                "p_scope": scope,
                "p_subject_id": str(subject_id) if subject_id is not None else None,
            },
            hide_denial=False,
        )
        return bool(result.get("replayed"))

    def get(
        self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID
    ) -> ErasureRequestOut | None:
        rows = self._send(
            "GET",
            "/erasure_requests",
            token,
            params={
                "select": SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{request_id}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected list shape")
        return parse_request(rows[0]) if rows else None

    def list(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> Page[ErasureRequestOut]:
        params = {
            "select": SELECT,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),
        }
        if cursor is not None:
            created_at, row_id = cursor  # validated by decode_cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id}))"
            )
        rows = self._send("GET", "/erasure_requests", token, params=params)
        if not isinstance(rows, list):
            raise UpstreamError("unexpected list shape")
        items = [parse_request(row) for row in rows[:limit]]
        nxt = None
        if len(rows) > limit:
            last = rows[limit - 1]
            nxt = encode_cursor(
                datetime.fromisoformat(str(last["created_at"])), uuid.UUID(str(last["id"]))
            )
        return Page[ErasureRequestOut](items=items, next_cursor=nxt)

    def execute(self, token: str, request_id: uuid.UUID, *, dry_run: bool) -> ErasureResultOut:
        result = self._rpc(
            token,
            "execute_erasure",
            {"p_request_id": str(request_id), "p_dry_run": dry_run},
            hide_denial=True,
        )
        try:
            return ErasureResultOut.model_validate(result)
        except ValidationError:
            logger.error(
                "erasure data layer returned a result that does not match ErasureResultOut"
            )
            raise UpstreamError("unexpected erasure result") from None

    def data_policy(self, token: str, tenant_id: uuid.UUID) -> DataPolicyOut:
        """No row means closed (the default)."""
        rows = self._send(
            "GET",
            "/tenant_data_policy",
            token,
            params={"select": "real_data_allowed", "tenant_id": f"eq.{tenant_id}", "limit": "1"},
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected list shape")
        return DataPolicyOut(
            real_data_allowed=bool(rows[0].get("real_data_allowed")) if rows else False
        )

    def cancel(self, token: str, request_id: uuid.UUID) -> bool:
        result = self._rpc(
            token, "cancel_erasure", {"p_request_id": str(request_id)}, hide_denial=True
        )
        return bool(result.get("replayed"))
