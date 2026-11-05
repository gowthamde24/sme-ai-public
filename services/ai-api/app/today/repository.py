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

    def agent_switches(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def agent_switch_set(self, token: str, tenant_id: uuid.UUID, agent: str, enabled: bool) -> Any: ...

    def nav_counts(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def ai_usage(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def ai_usage_percent(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def paused_until(self, token: str, tenant_id: uuid.UUID) -> Any: ...

    def ai_usage_week(self, token: str, tenant_id: uuid.UUID) -> Any: ...


class PostgrestTodayRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _rpc(self, name: str, token: str, tenant_id: uuid.UUID) -> Any:
        return self._call_args(name, token, {"p_tenant_id": str(tenant_id)})

    def _call_args(self, name: str, token: str, args: dict[str, Any]) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.post(
                f"/rpc/{name}", json=args, headers=headers
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

    def agent_switches(self, token: str, tenant_id: uuid.UUID) -> Any:
        """Owner or Admin: each helper's own switch for this workspace (migration 20261231170000)."""
        return self._rpc("agent_switches_get", token, tenant_id)

    def agent_switch_set(self, token: str, tenant_id: uuid.UUID, agent: str, enabled: bool) -> Any:
        """Owner: switch one helper on or off for this workspace."""
        return self._call_args("agent_switch_set", token, {"p_tenant_id": str(tenant_id), "p_agent": agent, "p_enabled": enabled})

    def nav_counts(self, token: str, tenant_id: uuid.UUID) -> Any:
        """Any member: the sidebar's counts, each by the caller's role (docs/contracts/nav-counts.md)."""
        return self._rpc("nav_counts", token, tenant_id)

    def ai_usage(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._rpc("ai_usage_today", token, tenant_id)

    def ai_usage_percent(self, token: str, tenant_id: uuid.UUID) -> Any:
        """Owner or Admin: percentages and reset times only (job AK / K2)."""
        return self._rpc("ai_usage", token, tenant_id)

    def paused_until(self, token: str, tenant_id: uuid.UUID) -> Any:
        """Any member: when the AI features are back (an ISO time) or null."""
        return self._rpc("ai_paused_until", token, tenant_id)

    def ai_usage_week(self, token: str, tenant_id: uuid.UUID) -> Any:
        """Owner or Admin: this week's share of the AI allowance as a percentage, and when the week resets (job AS)."""
        return self._rpc("ai_usage_week", token, tenant_id)
