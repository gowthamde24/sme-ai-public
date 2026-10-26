"""The lead playbook behind an interface (Supabase PostgREST today; job DR / A1). Every call carries the CALLER's token; the functions are those of migration 20261204090100."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class PlaybookRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save(self, token: str, tenant_id: uuid.UUID, playbook: dict[str, Any]) -> dict[str, Any]: ...
    def reset(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestPlaybookRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_playbook_get", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, playbook: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_playbook_save", {"p_tenant_id": str(tenant_id), "p_playbook": playbook})

    def reset(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_playbook_reset", {"p_tenant_id": str(tenant_id)})
