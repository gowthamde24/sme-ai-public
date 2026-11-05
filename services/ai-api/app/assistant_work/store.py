"""The database side of the assistant doing the work (job assistant-does-the-work A2; migration 20261229090000): the chat's files, the plan cards and the action log. Every call carries the
PERSON's token: the database decides who may (only the person who dropped a file reads it back; a plan moves by compare-and-set; the Owner's-only plan is the Owner's)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class PlanStateError(RepositoryError):
    """SM981: the plan is not in the state the move expects (a second "Do it" while the first runs; a plan already cancelled or done)."""


class PlanExpiredError(RepositoryError):
    """SM982: the plan was proposed more than 30 minutes ago."""


class WorkStore(Protocol):
    def file_put(self, token: str, tenant_id: uuid.UUID, name: str, content_type: str, kind: str, data_base64: str) -> dict[str, Any]: ...
    def file_get(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, *, with_data: bool = True) -> dict[str, Any]: ...
    def file_drop(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID) -> bool: ...
    def plan_put(self, token: str, tenant_id: uuid.UUID, plan: dict[str, Any]) -> dict[str, Any]: ...
    def plan_get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]: ...
    def plans_for(self, token: str, tenant_id: uuid.UUID, message_ids: list[uuid.UUID]) -> list[dict[str, Any]]: ...
    def plan_move(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, expect: str, status: str, steps: list[dict[str, Any]] | None = None, *, file_gone: bool = False) -> dict[str, Any]: ...
    def action_record(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, step_no: int, tool: str, summary: str, status: str, error: str | None, changed: dict[str, Any], undo: dict[str, Any] | None) -> dict[str, Any]: ...
    def action_undone(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, step_no: int) -> bool: ...
    def actions_list(self, token: str, tenant_id: uuid.UUID, since: str | None, before: str | None, limit: int, action_id: uuid.UUID | None = None, plan_id: uuid.UUID | None = None) -> list[dict[str, Any]]: ...


class PostgrestWorkStore:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM981": PlanStateError, "SM982": PlanExpiredError}, client=client, timeout=60.0)

    def close(self) -> None:
        self._rpc.close()

    def file_put(self, token: str, tenant_id: uuid.UUID, name: str, content_type: str, kind: str, data_base64: str) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_file_put", {"p_tenant_id": str(tenant_id), "p_name": name, "p_content_type": content_type, "p_kind": kind, "p_data_base64": data_base64})

    def file_get(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, *, with_data: bool = True) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_file_get", {"p_tenant_id": str(tenant_id), "p_file_id": str(file_id), "p_with_data": with_data})

    def file_drop(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID) -> bool:
        return bool(self._rpc.call(token, "assistant_file_drop", {"p_tenant_id": str(tenant_id), "p_file_id": str(file_id)}))

    def plan_put(self, token: str, tenant_id: uuid.UUID, plan: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_plan_put", {"p_tenant_id": str(tenant_id), "p_plan": plan})

    def plan_get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_plan_get", {"p_tenant_id": str(tenant_id), "p_plan_id": str(plan_id)})

    def plans_for(self, token: str, tenant_id: uuid.UUID, message_ids: list[uuid.UUID]) -> list[dict[str, Any]]:
        return self._rpc.array(token, "assistant_plans_for_messages", {"p_tenant_id": str(tenant_id), "p_message_ids": [str(m) for m in message_ids]})

    def plan_move(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, expect: str, status: str, steps: list[dict[str, Any]] | None = None, *, file_gone: bool = False) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_plan_move", {"p_tenant_id": str(tenant_id), "p_plan_id": str(plan_id), "p_expect": expect, "p_status": status, "p_steps": steps, "p_file_gone": file_gone})

    def action_record(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, step_no: int, tool: str, summary: str, status: str, error: str | None, changed: dict[str, Any], undo: dict[str, Any] | None) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_action_record", {"p_tenant_id": str(tenant_id), "p_plan_id": str(plan_id), "p_step_no": step_no, "p_tool": tool, "p_summary": summary, "p_status": status,
                                                                   "p_error": error, "p_changed": changed, "p_undo": undo})

    def action_undone(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, step_no: int) -> bool:
        return bool(self._rpc.call(token, "assistant_action_mark_undone", {"p_tenant_id": str(tenant_id), "p_plan_id": str(plan_id), "p_step_no": step_no}))

    def actions_list(self, token: str, tenant_id: uuid.UUID, since: str | None, before: str | None, limit: int, action_id: uuid.UUID | None = None, plan_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "assistant_actions_list", {"p_tenant_id": str(tenant_id), "p_since": since, "p_before": before, "p_limit": limit,
                                                                 "p_action_id": str(action_id) if action_id else None, "p_plan_id": str(plan_id) if plan_id else None})
