"""The database's door for AI employees (migration 20261231992750). The caller's token goes with every call; the database decides who may and every rule; its refusals come back as SQLSTATE words."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

REASONS = {"SM861": "employee_limit", "SM862": "name_taken", "SM863": "last_default", "SM864": "hours_wider", "SM865": "settings_elsewhere"}


class EmployeeRefused(RepositoryError):
    """`reason` is a closed word (employee_limit, name_taken, last_default, hours_wider, settings_elsewhere); any other refusal is `invalid`."""

    reason = "invalid"

    def __init__(self, code: str = "") -> None:
        super().__init__(code)
        self.reason = REASONS.get(code, "invalid")


class EmployeeRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {code: EmployeeRefused for code in REASONS})

    def employees(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "employees_list", {"p_tenant_id": str(tenant_id)})

    def get(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "employee_get", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id)})

    def create(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, role_code: str, name: str) -> dict[str, Any]:
        return self._rpc.object(token, "employee_create", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id), "p_role_code": role_code, "p_name": name})

    def update(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "employee_update", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id), "p_patch": patch})

    def status(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._rpc.object(token, "employee_status_set", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id), "p_status": status})

    def voice(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, language: str, voice_code: str) -> dict[str, Any]:
        return self._rpc.object(token, "employee_voice_set", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id), "p_language": language, "p_voice_code": voice_code})

    def phone(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, phone_number_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "employee_phone_set", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id), "p_phone_number_id": str(phone_number_id) if phone_number_id else None})

    def activity(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, limit: int, before: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "employee_activity", {"p_tenant_id": str(tenant_id), "p_id": str(employee_id), "p_limit": limit, "p_before": before})

    def assign(self, token: str, tenant_id: uuid.UUID, kind: str, item_id: uuid.UUID, employee_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "employee_assign", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_id": str(item_id), "p_employee_id": str(employee_id) if employee_id else None})

    def runtime(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID | None, line: str | None) -> dict[str, Any] | None:
        """What a call reads (the scheduler's account): the employee that answers, or None."""
        out = self._rpc.call(token, "employee_runtime", {"p_tenant_id": str(tenant_id), "p_employee_id": str(employee_id) if employee_id else None, "p_line": line})
        return out if isinstance(out, dict) else None
