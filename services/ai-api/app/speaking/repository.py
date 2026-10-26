"""Speaking style behind an interface (Supabase PostgREST today; job DS). Every call carries the CALLER's token; the two functions are those of migration 20261203090000."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class SpeakingRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]: ...


class PostgrestSpeakingRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "speaking_style_get", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "speaking_style_set", {"p_tenant_id": str(tenant_id), "p_settings": settings})
