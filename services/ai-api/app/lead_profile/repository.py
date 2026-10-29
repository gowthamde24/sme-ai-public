"""The lead profile functions behind an interface (Supabase PostgREST today; job EE, migration 20261219090000). Every call carries the CALLER's token: the database decides who may do what."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class LeadProfileRepository(Protocol):
    def page(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def get(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any] | None: ...
    def unseeded(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def seed(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> int: ...
    def fix(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, Any]) -> dict[str, Any]: ...
    def apply_ai(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, str], confidence: dict[str, str]) -> dict[str, Any]: ...
    def open(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> bool: ...


class PostgrestLeadProfileRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def page(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_desk_page", {"p_tenant_id": str(tenant_id), **args})

    def get(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any] | None:
        result = self._rpc.call(token, "lead_desk_get", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id)})
        return result if isinstance(result, dict) else None

    def unseeded(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        result = self._rpc.call(token, "lead_profile_unseeded", {"p_tenant_id": str(tenant_id), "p_limit": limit})
        return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []

    def seed(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> int:
        result = self._rpc.call(token, "lead_profile_seed", {"p_tenant_id": str(tenant_id), "p_items": items})
        return int(result) if isinstance(result, int) else 0

    def fix(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_profile_fix", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_fields": fields})

    def apply_ai(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, str], confidence: dict[str, str]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_profile_apply_ai", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_fields": fields, "p_confidence": confidence})

    def open(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> bool:
        return bool(self._rpc.call(token, "lead_profile_open", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id)}))


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
