"""The send log behind an interface (Supabase PostgREST today; job DP part 2). Every call carries the CALLER's token; the functions are those of migration 20261130090000, which prove the role (the Owner,
with a second factor, approves a send), the school module and the guardian before they write. The arguments are line numbers, contact ids and closed template ids: never a name, a mark or a message."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class MarksSendRepository(Protocol):
    def resolve(self, token: str, tenant_id: uuid.UUID, phones: list[str]) -> list[dict[str, Any]]: ...
    def begin(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]: ...
    def finish(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, results: list[dict[str, Any]]) -> dict[str, Any]: ...
    def batches(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> dict[str, Any]: ...
    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestMarksSendRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def resolve(self, token: str, tenant_id: uuid.UUID, phones: list[str]) -> list[dict[str, Any]]:
        result = self._rpc.call(token, "marks_send_resolve", {"p_tenant_id": str(tenant_id), "p_phones": phones})
        return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []

    def begin(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "marks_send_begin", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_items": items})

    def finish(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, results: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "marks_send_finish", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_results": results})

    def batches(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> dict[str, Any]:
        return self._rpc.object(token, "marks_send_batches", {"p_tenant_id": str(tenant_id), "p_limit": limit, "p_before_at": before.isoformat() if before else None})

    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "marks_send_batch", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id)})
