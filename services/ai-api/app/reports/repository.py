"""The reports behind an interface (Supabase PostgREST today; job CV, ADR 0088). Every call carries the CALLER's token; the functions are SECURITY DEFINER functions of migration 20261126090100 that prove the role and
the modules first. A model never reads these figures."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class ReportsRepository(Protocol):
    def catalogue(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def run(self, token: str, tenant_id: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]: ...


class PostgrestReportsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def catalogue(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "report_catalogue", {"p_tenant_id": str(tenant_id)})

    def run(self, token: str, tenant_id: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        return self._rpc.object(
            token, "report_run", {"p_tenant_id": str(tenant_id), "p_code": code, "p_from": date_from.isoformat() if date_from else None, "p_to": date_to.isoformat() if date_to else None}
        )
