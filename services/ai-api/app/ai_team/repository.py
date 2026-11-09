"""The AI team's one read (migration 20261231390000: public.ai_team_day) behind an interface. The caller's own token: the database decides who sees what."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class AiTeamRepository(Protocol):
    def day(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]: ...


class PostgrestAiTeamRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def day(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]:
        return self._rpc.object(token, "ai_team_day", {"p_tenant_id": str(tenant_id), "p_date": on.isoformat()})
