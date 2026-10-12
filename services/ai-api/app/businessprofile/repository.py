"""The business profile behind an interface (Supabase PostgREST today): the shop's own GSTIN (job CA). Reads and writes carry the CALLER's token; the write is one SECURITY DEFINER function that checks the role
and the second factor itself (public.business_profile_set). Failures are classified by SQLSTATE only."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.businessprofile.repository")


class BusinessProfileRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set_gstin(self, token: str, tenant_id: uuid.UUID, gstin: str | None) -> dict[str, Any]: ...


class PostgrestBusinessProfileRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def _headers(self, token: str) -> dict[str, str]:
        return {"apikey": self._anon_key, "Authorization": f"Bearer {token}", "Accept": "application/json"}

    def _send(self, method: str, path: str, token: str, **kw: Any) -> Any:
        try:
            response = self._client.request(method, path, headers=self._headers(token), **kw)
        except httpx.HTTPError as exc:
            logger.error("business profile: data layer unreachable: %s", exc.__class__.__name__)
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
        if isinstance(body, dict) and body.get("code") == "SM306":
            raise MfaRequired("SM306")
        raise classify_error(response.status_code, body)

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        rows = self._send("GET", "/business_profile", token, params={"select": "gstin", "tenant_id": f"eq.{tenant_id}", "limit": "1"})
        if not isinstance(rows, list):
            raise UpstreamError("unexpected business profile shape")
        return rows[0] if rows and isinstance(rows[0], dict) else {"gstin": None}

    def set_gstin(self, token: str, tenant_id: uuid.UUID, gstin: str | None) -> dict[str, Any]:
        result = self._send("POST", "/rpc/business_profile_set", token, json={"p_tenant_id": str(tenant_id), "p_gstin": gstin})
        if not isinstance(result, dict):
            raise UpstreamError("unexpected business profile answer")
        return result
