"""The AI assistant's settings behind an interface (Supabase PostgREST today; job DM). Every call carries the CALLER's token; the functions are SECURITY DEFINER functions of migration 20261129090300 that prove
the role first (the Owner saves, with a second factor; the Owner and Admin read)."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class AssistantSettingsRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]: ...
    def voices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...


class PostgrestAssistantSettingsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_settings_get", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_settings_save", {"p_tenant_id": str(tenant_id), "p_settings": settings})

    def voices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "assistant_voices", {"p_tenant_id": str(tenant_id)})
