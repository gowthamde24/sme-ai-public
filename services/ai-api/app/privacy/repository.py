"""The privacy-rights data access behind an interface (Supabase PostgREST today). Every call carries the CALLER's JWT and the public key, so the database decides who may do what; every function is a
SECURITY DEFINER function of migrations 20261116090000 and 20261116090100. The worker's four calls (`execute_account_deletions`, `expired_exports`, `export_cleaned`, `run_retention`) are made with the
registered scheduler principal's token and refuse everyone else. `read_table_page` is the one PostgREST table read: the workspace export, with the Owner's own token, so row-level security decides what is
in the file. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import NotFoundError, classify_error
from app.privacy.errors import (
    ConfirmationError,
    CoolingOffError,
    PrivacyRateError,
    PrivacyStateError,
    SoleOwnerError,
)
from app.tenancy.repository import MfaRequired, RepositoryError, UpstreamError

logger = logging.getLogger("app.privacy.repository")

_ERRORS: dict[str, type[RepositoryError]] = {
    "SM611": SoleOwnerError,
    "SM612": CoolingOffError,
    "SM613": PrivacyStateError,
    "SM614": PrivacyRateError,
    "SM615": ConfirmationError,
}


class PrivacyRepository(Protocol):
    # data exports
    def export_request(self, token: str, export_id: uuid.UUID, scope: str, tenant_id: uuid.UUID | None) -> dict[str, Any]: ...
    def export_get(self, token: str, export_id: uuid.UUID) -> dict[str, Any]: ...
    def export_list(self, token: str) -> list[dict[str, Any]]: ...
    def export_begin(self, token: str, export_id: uuid.UUID) -> dict[str, Any]: ...
    def export_finish(self, token: str, export_id: uuid.UUID, ok: bool, size: int | None, sha256: str | None, error: str | None) -> dict[str, Any]: ...
    def export_link(self, token: str, export_id: uuid.UUID) -> dict[str, Any]: ...
    def export_bucket(self, token: str) -> str: ...
    def person_data(self, token: str) -> dict[str, Any]: ...
    def read_table_page(self, token: str, table: str, tenant_id: uuid.UUID, order: str, offset: int, limit: int) -> list[dict[str, Any]]: ...
    # deletion
    def deletion_request(self, token: str, request_id: uuid.UUID, kind: str, tenant_id: uuid.UUID | None, confirm: str) -> dict[str, Any]: ...
    def deletion_cancel(self, token: str, request_id: uuid.UUID) -> dict[str, Any]: ...
    def deletion_list(self, token: str, tenant_id: uuid.UUID | None) -> list[dict[str, Any]]: ...
    def deletion_execute_workspace(self, token: str, request_id: uuid.UUID) -> dict[str, Any]: ...
    # retention
    def retention_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def retention_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, int | None]) -> dict[str, Any]: ...
    def retention_preview(self, token: str, tenant_id: uuid.UUID, settings: dict[str, int | None] | None) -> dict[str, Any]: ...
    # grievances
    def grievance_submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def grievance_list(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]: ...
    def grievance_get(self, token: str, grievance_id: uuid.UUID) -> dict[str, Any]: ...
    def grievance_update(self, token: str, grievance_id: uuid.UUID, status: str, note: str | None) -> dict[str, Any]: ...
    # the worker (the scheduler principal's token)
    def execute_account_deletions(self, token: str, limit: int) -> dict[str, Any]: ...
    def expired_exports(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def export_cleaned(self, token: str, export_id: uuid.UUID) -> None: ...
    def run_retention(self, token: str, limit: int) -> dict[str, Any]: ...


class PostgrestPrivacyRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(30.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in _ERRORS:
            return _ERRORS[code](code)
        if code == "SM306":
            return MfaRequired(code)
        if code == "23503":
            return NotFoundError(code)  # "not yours or not there": the same 404 for both
        return classify_error(status, body)

    def _send(self, method: str, path: str, token: str, **kw: Any) -> Any:
        headers = {"apikey": self._anon_key, "Accept": "application/json", "Authorization": f"Bearer {token}", **kw.pop("headers", {})}
        try:
            response = self._client.request(method, path, headers=headers, **kw)
        except httpx.HTTPError as exc:
            logger.error("privacy data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise self._classify(response.status_code, body)

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> Any:
        return self._send("POST", f"/rpc/{function}", token, json=args)

    def _object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._rpc(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def _array(self, token: str, function: str, args: dict[str, Any]) -> list[dict[str, Any]]:
        result = self._rpc(token, function, args)
        if not isinstance(result, list):
            raise UpstreamError("unexpected function result")
        return [r for r in result if isinstance(r, dict)]

    # ------------------------------------------------------------------ data exports
    def export_request(self, token: str, export_id: uuid.UUID, scope: str, tenant_id: uuid.UUID | None) -> dict[str, Any]:
        return self._object(token, "data_export_request", {"p_export_id": str(export_id), "p_scope": scope, "p_tenant_id": str(tenant_id) if tenant_id else None})

    def export_get(self, token: str, export_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "data_export_get", {"p_export_id": str(export_id)})

    def export_list(self, token: str) -> list[dict[str, Any]]:
        return self._array(token, "data_export_list", {})

    def export_begin(self, token: str, export_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "data_export_begin", {"p_export_id": str(export_id)})

    def export_finish(self, token: str, export_id: uuid.UUID, ok: bool, size: int | None, sha256: str | None, error: str | None) -> dict[str, Any]:
        return self._object(token, "data_export_finish", {"p_export_id": str(export_id), "p_ok": ok, "p_size": size, "p_sha256": sha256, "p_error": error})

    def export_link(self, token: str, export_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "data_export_link", {"p_export_id": str(export_id)})

    def export_bucket(self, token: str) -> str:
        result = self._rpc(token, "data_export_ensure_bucket", {})
        if not isinstance(result, str) or not result:
            raise UpstreamError("unexpected function result")
        return result

    def person_data(self, token: str) -> dict[str, Any]:
        return self._object(token, "data_export_person_data", {})

    def read_table_page(self, token: str, table: str, tenant_id: uuid.UUID, order: str, offset: int, limit: int) -> list[dict[str, Any]]:
        result = self._send(
            "GET", f"/{table}", token,
            params={"tenant_id": f"eq.{tenant_id}", "select": "*", "order": order, "offset": str(offset), "limit": str(limit)},
        )  # fmt: skip
        if not isinstance(result, list):
            raise UpstreamError("unexpected table result")
        return [r for r in result if isinstance(r, dict)]

    # ------------------------------------------------------------------ deletion
    def deletion_request(self, token: str, request_id: uuid.UUID, kind: str, tenant_id: uuid.UUID | None, confirm: str) -> dict[str, Any]:
        return self._object(token, "deletion_request", {"p_id": str(request_id), "p_kind": kind, "p_tenant_id": str(tenant_id) if tenant_id else None, "p_confirm": confirm})

    def deletion_cancel(self, token: str, request_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "deletion_cancel", {"p_id": str(request_id)})

    def deletion_list(self, token: str, tenant_id: uuid.UUID | None) -> list[dict[str, Any]]:
        return self._array(token, "deletion_list", {"p_tenant_id": str(tenant_id) if tenant_id else None})

    def deletion_execute_workspace(self, token: str, request_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "deletion_execute_workspace", {"p_id": str(request_id)})

    # ------------------------------------------------------------------ retention
    def retention_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "retention_get", {"p_tenant_id": str(tenant_id)})

    def retention_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, int | None]) -> dict[str, Any]:
        return self._object(token, "retention_set", {"p_tenant_id": str(tenant_id), "p_settings": settings})

    def retention_preview(self, token: str, tenant_id: uuid.UUID, settings: dict[str, int | None] | None) -> dict[str, Any]:
        return self._object(token, "retention_preview", {"p_tenant_id": str(tenant_id), "p_settings": settings})

    # ------------------------------------------------------------------ grievances
    def grievance_submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "grievance_submit", args)

    def grievance_list(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]:
        return self._array(token, "grievance_list", {"p_tenant_id": str(tenant_id), "p_status": status})

    def grievance_get(self, token: str, grievance_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "grievance_get", {"p_id": str(grievance_id)})

    def grievance_update(self, token: str, grievance_id: uuid.UUID, status: str, note: str | None) -> dict[str, Any]:
        return self._object(token, "grievance_update", {"p_id": str(grievance_id), "p_status": status, "p_note": note})

    # ------------------------------------------------------------------ the worker
    def execute_account_deletions(self, token: str, limit: int) -> dict[str, Any]:
        return self._object(token, "privacy_worker_execute_account_deletions", {"p_limit": limit})

    def expired_exports(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._array(token, "privacy_worker_expired_exports", {"p_limit": limit})

    def export_cleaned(self, token: str, export_id: uuid.UUID) -> None:
        self._rpc(token, "privacy_worker_export_cleaned", {"p_id": str(export_id)})

    def run_retention(self, token: str, limit: int) -> dict[str, Any]:
        return self._object(token, "privacy_worker_run_retention", {"p_limit": limit})
