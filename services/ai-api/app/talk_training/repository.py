"""The database side of "How I talk to customers" (migration 20261231150000): every call carries the caller's token; the database decides who (Owner saves with a second factor, Owner and Admin read)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import httpx

from app.rpc_base import RpcClient


class PostgrestTalkTraining:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "talk_training_get", {"p_tenant_id": str(tenant_id)})
        return got if isinstance(got, dict) else None

    def save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "talk_training_save", {"p_tenant_id": str(tenant_id), "p_doc": doc})

    def reset(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "talk_training_reset", {"p_tenant_id": str(tenant_id)})

    def for_call(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "talk_training_for_call", {"p_tenant_id": str(tenant_id)})
        return got if isinstance(got, dict) else None
