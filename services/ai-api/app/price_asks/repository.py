"""Price questions the assistant could not answer (owner, 15 Nov 2026): the database functions of migration 20261231974000 behind an interface. Every call carries the CALLER's token."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class PriceAsksRepository(Protocol):
    def record(self, token: str, tenant_id: uuid.UUID, item: str, source: str, lead_id: uuid.UUID | None) -> uuid.UUID: ...
    def answer(self, token: str, tenant_id: uuid.UUID, ask_id: uuid.UUID) -> None: ...
    def list(self, token: str, tenant_id: uuid.UUID, open_only: bool, limit: int) -> list[dict[str, Any]]: ...


class PostgrestPriceAsksRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def record(self, token: str, tenant_id: uuid.UUID, item: str, source: str, lead_id: uuid.UUID | None) -> uuid.UUID:
        out = self._rpc.call(token, "price_ask_record", {"p_tenant_id": str(tenant_id), "p_item": item, "p_source": source, "p_lead_id": str(lead_id) if lead_id else None})
        return uuid.UUID(str(out))

    def answer(self, token: str, tenant_id: uuid.UUID, ask_id: uuid.UUID) -> None:
        self._rpc.call(token, "price_ask_answer", {"p_tenant_id": str(tenant_id), "p_id": str(ask_id)})

    def list(self, token: str, tenant_id: uuid.UUID, open_only: bool, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "price_ask_list", {"p_tenant_id": str(tenant_id), "p_open": open_only, "p_limit": limit})
