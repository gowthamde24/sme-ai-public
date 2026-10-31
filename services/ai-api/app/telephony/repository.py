"""The phone calls behind an interface (Supabase PostgREST; job phone-calls part 6). Every call carries the CALLER's token; the functions are those of migration 20261225090000. Failures are classified by SQLSTATE only."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class CallStateError(RepositoryError):
    """SM961: the call is not in a state that allows this."""


class CallsRepository(Protocol):
    def list_calls(self, token: str, tenant_id: uuid.UUID, state: str, limit: int, before: datetime | None) -> list[dict[str, Any]]: ...
    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestCallsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM961": CallStateError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def list_calls(self, token: str, tenant_id: uuid.UUID, state: str, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "phone_calls_list", {"p_tenant_id": str(tenant_id), "p_state": state, "p_limit": limit, "p_before": before.isoformat() if before else None})

    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "phone_call_get", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id)})
