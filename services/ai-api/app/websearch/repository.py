"""What the workspace has used of the web research tools today (job BP): one SECURITY DEFINER function (`web_usage_today`, Owner and Admin only) called with the CALLER's own JWT. Failures are classified by
SQLSTATE only."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.websearch.repository")


class ResearchUsageRepository(Protocol):
    def usage_today(self, token: str, tenant_id: uuid.UUID) -> dict[str, dict[str, int]]: ...


class PostgrestResearchUsageRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def usage_today(self, token: str, tenant_id: uuid.UUID) -> dict[str, dict[str, int]]:
        headers = {"apikey": self._anon_key, "Authorization": f"Bearer {token}", "Accept": "application/json"}
        try:
            response = self._client.post("/rpc/web_usage_today", json={"p_tenant_id": str(tenant_id)}, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("research usage: data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                body: Any = response.json()
                return {
                    str(model): {"used": int(v["used"]), "cap": int(v["cap"])}
                    for model, v in body.items()
                }
            except (ValueError, KeyError, TypeError, AttributeError):
                raise UpstreamError("unexpected usage shape") from None
        try:
            err = response.json()
        except ValueError:
            err = None
        raise classify_error(response.status_code, err)
