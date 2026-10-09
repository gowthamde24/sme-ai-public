"""Reads for Today, AI usage and the helpers' status (job AD / D3), behind an interface.

Every call carries the CALLER's JWT and the public anon key, so row-level security decides every
row. The three database functions are reads: `today_summary` and `agents_status` (SECURITY
INVOKER, written for this) and `ai_usage_today` (Owner or Admin; the Indian day). Failures are
classified by SQLSTATE only; data-layer text is never returned, logged or chained.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.today.repository")


class TodayRepository(Protocol):
    def today_summary(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def agents_status(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def ai_usage(self, token: str, tenant_id: uuid.UUID) -> Any: ...


class PostgrestTodayRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _rpc(self, name: str, token: str, tenant_id: uuid.UUID) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.post(
                f"/rpc/{name}", json={"p_tenant_id": str(tenant_id)}, headers=headers
            )
        except httpx.HTTPError as exc:
            logger.error("today data layer unreachable: %s", exc.__class__.__name__)
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

    def today_summary(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._rpc("today_summary", token, tenant_id)

    def agents_status(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._rpc("agents_status", token, tenant_id)

    def ai_usage(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._rpc("ai_usage_today", token, tenant_id)
