"""The shop's basics and the weekly report (job BY, ADR 0077): SECURITY DEFINER functions of migration 20261118090100, called with the caller's own token."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

from app.rpc_base import RpcClient


class WorkspaceRepository(Protocol):
    def profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save_profile(self, token: str, tenant_id: uuid.UUID, name: str | None, town: str | None, languages: list[str] | None) -> dict[str, Any]: ...
    def weekly_report(self, token: str, tenant_id: uuid.UUID, week_start: date | None) -> dict[str, Any]: ...


class PostgrestWorkspaceRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key)

    def profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_profile_get", {"p_tenant_id": str(tenant_id)})

    def save_profile(self, token: str, tenant_id: uuid.UUID, name: str | None, town: str | None, languages: list[str] | None) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_profile_save", {"p_tenant_id": str(tenant_id), "p_name": name, "p_town": town, "p_languages": languages})

    def weekly_report(self, token: str, tenant_id: uuid.UUID, week_start: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "weekly_report", {"p_tenant_id": str(tenant_id), "p_week_start": week_start.isoformat() if week_start else None})
