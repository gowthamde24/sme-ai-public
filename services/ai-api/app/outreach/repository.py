"""Speed to lead behind an interface (Supabase PostgREST today; job DR A3). The routes carry the CALLER's token; the worker's three calls carry the registered scheduler's token. The database decides who may do what
and re-checks everything (the plan hash, the second factor, the roles, the hours, the caps)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Protocol

import httpx

from app.outreach.errors import OutreachStateError, PlanChangedError
from app.rpc_base import RpcClient
from app.tasks.errors import NotForSchoolsError


class OutreachRepository(Protocol):
    def policy_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def policy_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]: ...
    def batch_plan(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]: ...
    def batches(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]: ...
    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]: ...
    def items(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, limit: int, after_at: datetime | None, after_id: uuid.UUID | None) -> list[dict[str, Any]]: ...
    def exclude(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, contact_ids: list[uuid.UUID]) -> dict[str, Any]: ...
    def approve(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, plan_sha256: str) -> dict[str, Any]: ...
    def batch_state(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    def caps(self, token: str, tenant_id: uuid.UUID, kind: str, item_id: uuid.UUID, calls: int | None, minutes: int | None) -> dict[str, Any]: ...
    def rule_save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]: ...
    def rules(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def rule_state(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    def result(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, result: str, outcome: dict[str, Any] | None, minutes: float, stop: bool) -> dict[str, Any]: ...
    def handoffs(self, token: str, tenant_id: uuid.UUID, open_only: bool) -> list[dict[str, Any]]: ...
    def handoff_acted(self, token: str, tenant_id: uuid.UUID, handoff_id: uuid.UUID) -> dict[str, Any]: ...
    def report(self, token: str, tenant_id: uuid.UUID, start: date | None, end: date | None) -> dict[str, Any]: ...
    def source_costs(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def source_costs_set(self, token: str, tenant_id: uuid.UUID, costs: list[dict[str, Any]]) -> list[dict[str, Any]]: ...
    # the worker
    def scan(self, token: str, limit: int) -> dict[str, Any]: ...
    def run(self, token: str, limit: int) -> dict[str, Any]: ...
    def reminders(self, token: str, limit: int) -> list[dict[str, Any]]: ...


class PostgrestOutreachRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM811": OutreachStateError, "SM812": PlanChangedError, "SM951": NotForSchoolsError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def policy_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_policy_get", {"p_tenant_id": str(tenant_id)})

    def policy_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_policy_set", {"p_tenant_id": str(tenant_id), "p_settings": settings})

    def batch_plan(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_batch_plan", {"p_tenant_id": str(tenant_id), "p_doc": doc})

    def batches(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outreach_batches_list", {"p_tenant_id": str(tenant_id), "p_status": status})

    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_batch_get", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id)})

    def items(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, limit: int, after_at: datetime | None, after_id: uuid.UUID | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outreach_items_list", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_limit": limit, "p_after_at": after_at.isoformat() if after_at else None, "p_after_id": str(after_id) if after_id else None})

    def exclude(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, contact_ids: list[uuid.UUID]) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_batch_exclude", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_contact_ids": [str(c) for c in contact_ids]})

    def approve(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, plan_sha256: str) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_batch_approve", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_plan_sha256": plan_sha256})

    def batch_state(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_batch_state", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_action": action})

    def caps(self, token: str, tenant_id: uuid.UUID, kind: str, item_id: uuid.UUID, calls: int | None, minutes: int | None) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_caps_set", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_id": str(item_id), "p_max_calls_per_day": calls, "p_max_total_minutes": minutes})

    def rule_save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_rule_save", {"p_tenant_id": str(tenant_id), "p_doc": doc})

    def rules(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outreach_rules_list", {"p_tenant_id": str(tenant_id)})

    def rule_state(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_rule_state", {"p_tenant_id": str(tenant_id), "p_rule_id": str(rule_id), "p_action": action})

    def result(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, result: str, outcome: dict[str, Any] | None, minutes: float, stop: bool) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_item_result", {"p_tenant_id": str(tenant_id), "p_item_id": str(item_id), "p_result": result, "p_outcome": outcome, "p_minutes": minutes, "p_stop": stop})

    def handoffs(self, token: str, tenant_id: uuid.UUID, open_only: bool) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outreach_handoffs_list", {"p_tenant_id": str(tenant_id), "p_open": open_only})

    def handoff_acted(self, token: str, tenant_id: uuid.UUID, handoff_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_handoff_acted", {"p_tenant_id": str(tenant_id), "p_id": str(handoff_id)})

    def report(self, token: str, tenant_id: uuid.UUID, start: date | None, end: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "outreach_report", {"p_tenant_id": str(tenant_id), "p_from": start.isoformat() if start else None, "p_to": end.isoformat() if end else None})

    def source_costs(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outreach_source_costs_get", {"p_tenant_id": str(tenant_id)})

    def source_costs_set(self, token: str, tenant_id: uuid.UUID, costs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outreach_source_costs_set", {"p_tenant_id": str(tenant_id), "p_costs": costs})

    def scan(self, token: str, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_outreach_scan", {"p_limit": limit})

    def run(self, token: str, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_outreach_run", {"p_limit": limit})

    def reminders(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_outreach_reminders", {"p_limit": limit})
