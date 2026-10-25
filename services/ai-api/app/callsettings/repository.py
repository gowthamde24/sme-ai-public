"""Call settings behind an interface (Supabase PostgREST today; job DP part 4). Every call carries the CALLER's token; the functions are those of migration 20261130090200, which prove the role (the Owner, with
a second factor, saves) and validate the document strictly before they write."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class CallSettingsRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]: ...
    def campaign_get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]: ...
    def campaign_save(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, overrides: dict[str, Any]) -> dict[str, Any]: ...
    def campaign_clear(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestCallSettingsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "call_settings_get", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "call_settings_save", {"p_tenant_id": str(tenant_id), "p_settings": settings})

    def campaign_get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "call_settings_campaign_get", {"p_tenant_id": str(tenant_id), "p_campaign_id": str(campaign_id)})

    def campaign_save(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, overrides: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "call_settings_campaign_save", {"p_tenant_id": str(tenant_id), "p_campaign_id": str(campaign_id), "p_settings": overrides})

    def campaign_clear(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "call_settings_campaign_clear", {"p_tenant_id": str(tenant_id), "p_campaign_id": str(campaign_id)})
