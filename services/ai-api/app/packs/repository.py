"""Packs, modules and the example data behind an interface (Supabase PostgREST today). Every call carries the CALLER's token, so the database decides who may do what; every function is a SECURITY DEFINER
function of migrations 20261122090000 to 20261122090400 that proves the role first. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.packs.errors import ExampleAlreadyLoadedError, ModuleOffError
from app.rpc_base import RpcClient


class PacksRepository(Protocol):
    def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def workspace_modules(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def catalogue(self, token: str) -> list[dict[str, Any]]: ...
    def example_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def example_load(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def example_remove(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestPacksRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError, "SM721": ExampleAlreadyLoadedError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_pack_get", {"p_tenant_id": str(tenant_id)})

    def workspace_modules(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        result = self._rpc.call(token, "workspace_modules", {"p_tenant_id": str(tenant_id)})
        return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []

    def catalogue(self, token: str) -> list[dict[str, Any]]:
        result = self._rpc.call(token, "pack_catalogue", {})
        return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []

    def example_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "example_data_status", {"p_tenant_id": str(tenant_id)})

    def example_load(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "example_data_load", {"p_tenant_id": str(tenant_id)})

    def example_remove(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "example_data_remove", {"p_tenant_id": str(tenant_id)})
