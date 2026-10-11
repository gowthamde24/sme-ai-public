"""The integrations' data access behind an interface (Supabase PostgREST today). Every call carries the CALLER's JWT and the public key, so the database decides who may do what; every function is a
SECURITY DEFINER function of migrations 20261114090000 to 20261114090300. The ONE call without a person is `calendar_read`: a calendar app has no sign-in, the SHA-256 of a private token is its
credential, and only the public key travels. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.integrations.errors import ExportTooLargeError, ImportJobStateError, ImportMismatchError
from app.tenancy.repository import MfaRequired, RepositoryError, UpstreamError

logger = logging.getLogger("app.integrations.repository")

_ERRORS: dict[str, type[RepositoryError]] = {
    "SM601": ExportTooLargeError,
    "SM602": ImportJobStateError,
    "SM603": ImportMismatchError,
}


class IntegrationsRepository(Protocol):
    def export_data(self, token: str, tenant_id: uuid.UUID, export_id: uuid.UUID, fmt: str, date_from: str, date_to: str) -> dict[str, Any]: ...
    def job_preview_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def job_get(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, Any]: ...
    def job_list(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def job_begin(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, file_sha256: str, mapping_sha256: str) -> dict[str, Any]: ...
    def job_finish(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, status: str, counts: dict[str, Any], issues: list[dict[str, Any]]) -> dict[str, Any]: ...
    def stock_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def stock_apply(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, changes: list[dict[str, str]]) -> dict[str, Any]: ...
    def calendar_create(self, token: str, tenant_id: uuid.UUID, token_sha256: str) -> dict[str, Any]: ...
    def calendar_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def calendar_revoke(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def calendar_read(self, token_sha256: str) -> dict[str, Any] | None: ...
    def policy_accept(self, token: str, terms: str | None, privacy: str | None, via: str) -> list[dict[str, Any]]: ...
    def policy_mine(self, token: str) -> list[dict[str, Any]]: ...


class PostgrestIntegrationsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(20.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in _ERRORS:
            return _ERRORS[code](code)
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    def _rpc(self, token: str | None, function: str, args: dict[str, Any]) -> Any:
        headers = {"apikey": self._anon_key, "Accept": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("integrations data layer unreachable: %s", exc.__class__.__name__)
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
        raise self._classify(response.status_code, body)

    def _object(self, token: str | None, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._rpc(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def _array(self, token: str | None, function: str, args: dict[str, Any]) -> list[dict[str, Any]]:
        result = self._rpc(token, function, args)
        if not isinstance(result, list):
            raise UpstreamError("unexpected function result")
        return result

    # ------------------------------------------------------------------ export
    def export_data(self, token: str, tenant_id: uuid.UUID, export_id: uuid.UUID, fmt: str, date_from: str, date_to: str) -> dict[str, Any]:
        return self._object(token, "export_accounting_data", {"p_tenant_id": str(tenant_id), "p_export_id": str(export_id), "p_format": fmt, "p_from": date_from, "p_to": date_to})

    # ------------------------------------------------------------------ import jobs
    def job_preview_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "import_job_preview_save", args)

    def job_get(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "import_job_get", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id)})

    def job_list(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return self._array(token, "import_job_list", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    def job_begin(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, file_sha256: str, mapping_sha256: str) -> dict[str, Any]:
        return self._object(token, "import_job_begin", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id), "p_file_sha256": file_sha256, "p_mapping_sha256": mapping_sha256})

    def job_finish(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, status: str, counts: dict[str, Any], issues: list[dict[str, Any]]) -> dict[str, Any]:
        return self._object(token, "import_job_finish", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id), "p_status": status, "p_counts": counts, "p_issues": issues})

    def stock_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._array(token, "catalogue_stock_list", {"p_tenant_id": str(tenant_id)})

    def stock_apply(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, changes: list[dict[str, str]]) -> dict[str, Any]:
        return self._object(token, "catalogue_stock_apply", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id), "p_changes": changes})

    # ------------------------------------------------------------------ calendar feed
    def calendar_create(self, token: str, tenant_id: uuid.UUID, token_sha256: str) -> dict[str, Any]:
        return self._object(token, "calendar_feed_create", {"p_tenant_id": str(tenant_id), "p_token_sha256": token_sha256})

    def calendar_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "calendar_feed_status", {"p_tenant_id": str(tenant_id)})

    def calendar_revoke(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "calendar_feed_revoke", {"p_tenant_id": str(tenant_id)})

    def calendar_read(self, token_sha256: str) -> dict[str, Any] | None:
        result = self._rpc(None, "calendar_feed_read", {"p_token_sha256": token_sha256})
        return result if isinstance(result, dict) else None

    # ------------------------------------------------------------------ policy acceptance
    def policy_accept(self, token: str, terms: str | None, privacy: str | None, via: str) -> list[dict[str, Any]]:
        return self._array(token, "policy_accept", {"p_terms_version": terms, "p_privacy_version": privacy, "p_via": via})

    def policy_mine(self, token: str) -> list[dict[str, Any]]:
        return self._array(token, "policy_acceptances_mine", {})
