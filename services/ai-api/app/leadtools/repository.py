"""Lead search behind an interface (Supabase PostgREST today): the caller's own JWT, so row-level security decides which leads are visible; the search itself is one SECURITY INVOKER function
(`lead_search`, job AY). Failures are classified by SQLSTATE only."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.leadtools.repository")


class LeadSearchRepository(Protocol):
    def search(
        self,
        token: str,
        tenant_id: uuid.UUID,
        q: str,
        limit: int,
        after: tuple[str, uuid.UUID] | None,
    ) -> list[dict[str, Any]]: ...


class PostgrestLeadSearchRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def search(
        self,
        token: str,
        tenant_id: uuid.UUID,
        q: str,
        limit: int,
        after: tuple[str, uuid.UUID] | None,
    ) -> list[dict[str, Any]]:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        body = {
            "p_tenant_id": str(tenant_id),
            "p_q": q,
            "p_limit": limit,
            "p_after_created_at": after[0] if after else None,
            "p_after_id": str(after[1]) if after else None,
        }
        try:
            response = self._client.post("/rpc/lead_search", json=body, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("lead search: data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                rows = response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
            if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
                raise UpstreamError("unexpected search shape")
            return rows
        try:
            err = response.json()
        except ValueError:
            err = None
        raise classify_error(response.status_code, err)
