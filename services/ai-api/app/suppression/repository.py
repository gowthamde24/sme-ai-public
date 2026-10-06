"""Suppression data access behind an interface (Supabase PostgREST today). Same discipline as the other adapters: every call carries the CALLER's JWT and the public anon key, so
the definer functions decide who may do what; failures are classified by SQLSTATE only and the data layer's text (which could hold a row) is never returned, logged or chained.
The request bodies of these calls carry HMACs: nothing here logs a body, a URL query or a key."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.tenancy.repository import (
    Forbidden,
    MfaRequired,
    RepositoryError,
    TokenRejected,
    UpstreamError,
)

logger = logging.getLogger("app.suppression.repository")
_SQLSTATE = re.compile(r"^(?:[0-9A-Z]{5}|PGRST\d{3})$")


class SuppressionRepository(Protocol):
    def record_keys(
        self, token: str, contact_id: uuid.UUID, keys: dict[str, Any], also: dict[str, Any]
    ) -> dict[str, Any]: ...
    def check(
        self, token: str, tenant_id: uuid.UUID, keys: dict[str, list[str]]
    ) -> dict[str, Any]: ...
    def unkeyed_count(self, token: str, tenant_id: uuid.UUID) -> int: ...
    def unkeyed_contacts(
        self, token: str, tenant_id: uuid.UUID, limit: int
    ) -> list[dict[str, Any]]: ...
    def backfill(
        self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]
    ) -> dict[str, Any]: ...
    def allow_without_key(self, token: str, request_id: uuid.UUID) -> dict[str, Any]: ...


def classify_error(status: int, body: Any) -> RepositoryError:
    code = ""
    if isinstance(body, dict):
        raw = body.get("code")
        code = raw if isinstance(raw, str) and _SQLSTATE.fullmatch(raw) else ""
    logger.info("suppression data layer refused: http=%s sqlstate=%s", status, code or "-")
    if status == 401 or code.startswith("PGRST30"):
        return TokenRejected(code or "401")
    mapped: dict[str, type[RepositoryError]] = {
        "42501": Forbidden,
        "SM306": MfaRequired,
        "22023": InvalidValueError,
        "23503": InvalidReferenceError,
        "23505": ConflictError,
    }
    if code in mapped:
        return mapped[code](code)
    logger.warning(
        "suppression data layer returned an unexpected error: http=%s sqlstate=%s",
        status,
        code or "-",
    )
    return UpstreamError(f"unexpected data-layer response ({status})")


class PostgrestSuppressionRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(30.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("suppression data layer unreachable: %s", exc.__class__.__name__)
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
        raise classify_error(response.status_code, body)

    def _object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._rpc(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def record_keys(
        self, token: str, contact_id: uuid.UUID, keys: dict[str, Any], also: dict[str, Any]
    ) -> dict[str, Any]:
        return self._object(
            token,
            "record_contact_keys",
            {"p_contact_id": str(contact_id), "p_keys": keys, "p_also": also},
        )

    def check(self, token: str, tenant_id: uuid.UUID, keys: dict[str, list[str]]) -> dict[str, Any]:
        return self._object(
            token, "check_suppression", {"p_tenant_id": str(tenant_id), "p_keys": keys}
        )

    def unkeyed_count(self, token: str, tenant_id: uuid.UUID) -> int:
        result = self._rpc(token, "unkeyed_contact_count", {"p_tenant_id": str(tenant_id)})
        if not isinstance(result, int) or isinstance(result, bool):
            raise UpstreamError("unexpected function result")
        return result

    def unkeyed_contacts(
        self, token: str, tenant_id: uuid.UUID, limit: int
    ) -> list[dict[str, Any]]:
        result = self._rpc(
            token, "unkeyed_contacts", {"p_tenant_id": str(tenant_id), "p_limit": limit}
        )
        if not isinstance(result, list) or any(not isinstance(r, dict) for r in result):
            raise UpstreamError("unexpected function result")
        return result

    def backfill(
        self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return self._object(
            token, "backfill_contact_keys", {"p_tenant_id": str(tenant_id), "p_items": items}
        )

    def allow_without_key(self, token: str, request_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "allow_erasure_without_key", {"p_request_id": str(request_id)})
