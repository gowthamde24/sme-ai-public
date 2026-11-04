"""The Lead Finder behind an interface (Supabase PostgREST today; ADR 0119). Every call carries the CALLER's token; the functions are those of migration 20261226090000. Failures are classified by SQLSTATE only."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.lead_finder.errors import (
    NotForThisBusinessError,
    NotInPlanError,
    ProspectStateError,
    SearchCapError,
)
from app.rpc_base import RpcClient


class LeadFinderRepository(Protocol):
    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def settings_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]: ...
    def context(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def search_plan(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def search_approve(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]: ...
    def search_cancel(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]: ...
    def search_finish(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID, items: list[dict[str, Any]], state: str, cost_paise: int, counts: dict[str, Any]) -> dict[str, Any]: ...
    def search_get(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]: ...
    def searches(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def prospects(self, token: str, tenant_id: uuid.UUID, status: str | None, search_id: uuid.UUID | None, limit: int, before: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def prospect_get(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> dict[str, Any]: ...
    def stats(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID | None) -> dict[str, Any]: ...
    def decisions_apply(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> int: ...
    def act(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    def call_finish(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, call_id: uuid.UUID, result: str, qualification: dict[str, Any] | None) -> dict[str, Any]: ...
    def pack_id(self, token: str, tenant_id: uuid.UUID) -> str | None: ...
    def module_on(self, token: str, tenant_id: uuid.UUID) -> bool: ...
    def entitled(self, token: str, tenant_id: uuid.UUID) -> bool: ...
    def stock(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...


class PostgrestLeadFinderRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM971": NotForThisBusinessError, "SM972": SearchCapError, "SM973": ProspectStateError, "SM974": NotInPlanError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_finder_settings_get", {"p_tenant_id": str(tenant_id)})

    def settings_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_finder_settings_set", {"p_tenant_id": str(tenant_id), "p_settings": settings})

    def context(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_context", {"p_tenant_id": str(tenant_id)})

    def search_plan(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_search_plan", {"p_tenant_id": str(tenant_id), **args})

    def search_approve(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_search_approve", {"p_tenant_id": str(tenant_id), "p_id": str(search_id)})

    def search_cancel(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_search_cancel", {"p_tenant_id": str(tenant_id), "p_id": str(search_id)})

    def search_finish(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID, items: list[dict[str, Any]], state: str, cost_paise: int, counts: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_search_finish", {"p_tenant_id": str(tenant_id), "p_id": str(search_id), "p_items": items, "p_state": state, "p_cost_paise": cost_paise, "p_counts": counts})

    def search_get(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_search_get", {"p_tenant_id": str(tenant_id), "p_id": str(search_id)})

    def searches(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "prospect_searches_list", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    def prospects(self, token: str, tenant_id: uuid.UUID, status: str | None, search_id: uuid.UUID | None, limit: int, before: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "prospects_list", {"p_tenant_id": str(tenant_id), "p_status": status, "p_search_id": str(search_id) if search_id else None, "p_limit": limit,
                                                         "p_before_score": before[0] if before else None, "p_before_id": str(before[1]) if before else None})

    def prospect_get(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_get", {"p_tenant_id": str(tenant_id), "p_id": str(prospect_id)})

    def stats(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_stats", {"p_tenant_id": str(tenant_id), "p_search_id": str(search_id) if search_id else None})

    def decisions_apply(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> int:
        return int(self._rpc.call(token, "prospect_decisions_apply", {"p_tenant_id": str(tenant_id), "p_items": items}) or 0)

    def act(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_act", {"p_tenant_id": str(tenant_id), "p_id": str(prospect_id), "p_action": action})

    def call_finish(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, call_id: uuid.UUID, result: str, qualification: dict[str, Any] | None) -> dict[str, Any]:
        return self._rpc.object(token, "prospect_call_finish", {"p_tenant_id": str(tenant_id), "p_id": str(prospect_id), "p_call_id": str(call_id), "p_result": result, "p_qualification": qualification})

    def pack_id(self, token: str, tenant_id: uuid.UUID) -> str | None:
        row = self._rpc.object(token, "workspace_pack_get", {"p_tenant_id": str(tenant_id)})
        value = row.get("pack_id")
        return str(value) if value else None

    def module_on(self, token: str, tenant_id: uuid.UUID) -> bool:
        rows = self._rpc.array(token, "workspace_modules", {"p_tenant_id": str(tenant_id)})
        return any(r.get("module") == "lead_finder" and r.get("enabled") is True for r in rows)

    def entitled(self, token: str, tenant_id: uuid.UUID) -> bool:
        """The plan's switch (public.workspace_entitlements): AI Workforce has the Lead Finder, Lead Desk does not."""
        out = self._rpc.object(token, "workspace_entitlements", {"p_tenant_id": str(tenant_id)})
        return bool((out.get("features") or {}).get("lead_finder"))

    def stock(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "catalogue_search", {"p_tenant_id": str(tenant_id), "p_limit": 50})
