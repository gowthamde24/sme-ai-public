"""The owner's notes behind an interface (Supabase PostgREST today; job EB part A). Every call carries the CALLER's token; the functions are SECURITY DEFINER and prove the role first (read: any member; save: Owner or Admin).
Failures are classified by SQLSTATE only."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import NotFoundError
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class ContextChanged(RepositoryError):
    """SM971: someone saved first."""


class InvalidNotes(RepositoryError):
    """22023: too long or not clean text."""


class ContextRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save(self, token: str, tenant_id: uuid.UUID, notes: str, expected_version: int, change: str) -> dict[str, Any]: ...
    def versions(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def version(self, token: str, tenant_id: uuid.UUID, version: int) -> dict[str, Any]: ...


class PostgrestContextRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM971": ContextChanged, "22023": InvalidNotes, "P0002": NotFoundError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_context_get", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, notes: str, expected_version: int, change: str) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_context_save", {"p_tenant_id": str(tenant_id), "p_notes": notes, "p_expected_version": expected_version, "p_change": change})

    def versions(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        out = self._rpc.object(token, "assistant_context_versions_list", {"p_tenant_id": str(tenant_id), "p_limit": limit})
        items = out.get("items")
        return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []

    def version(self, token: str, tenant_id: uuid.UUID, version: int) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_context_version_get", {"p_tenant_id": str(tenant_id), "p_version": version})
