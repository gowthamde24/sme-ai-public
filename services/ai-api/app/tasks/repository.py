"""Tasks behind an interface (Supabase PostgREST today; job DR B1). Every call carries the CALLER's token; the functions are those of migration 20261207090000. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tasks.errors import NotForSchoolsError, PlanChangedError, TaskStateError


class TasksRepository(Protocol):
    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def get(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any]: ...
    def list_tasks(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, before: datetime | None) -> list[dict[str, Any]]: ...
    def contacts(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, status: str | None, limit: int, after_seq: int | None) -> list[dict[str, Any]]: ...
    def report(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any]: ...
    def context(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def exclude(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, contact_ids: list[uuid.UUID], excluded: bool) -> dict[str, Any]: ...
    def approve(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, plan_sha256: str, cap_paise: int | None) -> dict[str, Any]: ...
    def set_cap(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, cap_paise: int) -> dict[str, Any]: ...
    def set_state(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    def claim(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, limit: int) -> dict[str, Any]: ...
    def result(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, row_id: uuid.UUID, result: dict[str, Any]) -> dict[str, Any]: ...


class PostgrestTasksRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM951": NotForSchoolsError, "SM952": PlanChangedError, "SM953": TaskStateError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "task_save", args)

    def context(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "task_context", {"p_tenant_id": str(tenant_id)})

    def get(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "task_get", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id)})

    def list_tasks(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "tasks_list", {"p_tenant_id": str(tenant_id), "p_status": status, "p_limit": limit, "p_before": before.isoformat() if before else None})

    def contacts(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, status: str | None, limit: int, after_seq: int | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "task_contacts_list", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_status": status, "p_limit": limit, "p_after_seq": after_seq})

    def report(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "task_report", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id)})

    def exclude(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, contact_ids: list[uuid.UUID], excluded: bool) -> dict[str, Any]:
        return self._rpc.object(token, "task_exclude", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_contact_ids": [str(c) for c in contact_ids], "p_excluded": excluded})

    def approve(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, plan_sha256: str, cap_paise: int | None) -> dict[str, Any]:
        return self._rpc.object(token, "task_approve", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_plan_sha256": plan_sha256, "p_cap_paise": cap_paise})

    def set_cap(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, cap_paise: int) -> dict[str, Any]:
        return self._rpc.object(token, "task_set_cap", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_cap_paise": cap_paise})

    def set_state(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self._rpc.object(token, "task_set_state", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_action": action})

    def claim(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "task_claim", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_limit": limit})

    def result(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, row_id: uuid.UUID, result: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "task_contact_result", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_row_id": str(row_id), "p_result": result})
