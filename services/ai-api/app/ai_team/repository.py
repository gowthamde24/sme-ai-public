"""The AI team's reads and the stand-up's store (migrations 20261231390000: public.ai_team_day; 20261231400000: the stand-up) behind an interface. The caller's own token: the database decides who sees what."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class AiTeamRepository(Protocol):
    def day(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]: ...
    def standup_get(self, token: str, tenant_id: uuid.UUID, on: date, language: str) -> dict[str, Any] | None: ...
    def standup_save(self, token: str, tenant_id: uuid.UUID, on: date, built: dict[str, Any]) -> dict[str, Any]: ...


class PostgrestAiTeamRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def day(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]:
        return self._rpc.object(token, "ai_team_day", {"p_tenant_id": str(tenant_id), "p_date": on.isoformat()})

    def standup_get(self, token: str, tenant_id: uuid.UUID, on: date, language: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "ai_team_standup_get", {"p_tenant_id": str(tenant_id), "p_date": on.isoformat(), "p_language": language})
        return got if isinstance(got, dict) else None

    def standup_save(self, token: str, tenant_id: uuid.UUID, on: date, built: dict[str, Any]) -> dict[str, Any]:
        """Keep a made stand-up (the worker: once a day; the Owner or an Admin: by hand, 3 a day). The answer has `ok`; `ok: false` carries `reason` and `retry_after_s`."""
        return self._rpc.object(token, "ai_team_standup_save", {"p_tenant_id": str(tenant_id), "p_date": on.isoformat(), "p_language": built["language"], "p_text": built["text"],
                                                              "p_lines": built["lines"], "p_numbers": built["numbers"], "p_draft": built["draft"]})

    def standups_due(self, token: str, limit: int = 50) -> list[dict[str, Any]]:
        """The worker: the workspaces whose stand-up is due now (tenant_id, language, date)."""
        return self._rpc.array(token, "scheduler_standup_due", {"p_limit": limit})

    def day_as_scheduler(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]:
        """The worker: the same day as the Owner reads it."""
        return self._rpc.object(token, "scheduler_ai_team_day", {"p_tenant_id": str(tenant_id), "p_date": on.isoformat()})
