"""The database functions of migration 20261231992330 behind an interface. The people's calls carry the person's token (Owner or Admin, checked by the database); the worker's carry the scheduler account's."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class CrmPushRepository(Protocol):
    def connections_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def connection_save(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, type_: str, config: dict[str, str], mapping: dict[str, str], events: list[str]) -> dict[str, Any]: ...
    def connection_update(self, token: str, tenant_id: uuid.UUID, type_: str, mapping: dict[str, str] | None, events: list[str] | None, active: bool | None) -> dict[str, Any] | None: ...
    def connection_delete(self, token: str, tenant_id: uuid.UUID, type_: str) -> uuid.UUID | None: ...
    def connection_tested(self, token: str, tenant_id: uuid.UUID, type_: str, ok: bool, reason: str | None) -> dict[str, Any] | None: ...
    def deliveries_list(self, token: str, tenant_id: uuid.UUID, type_: str | None, before: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def deliveries_retry(self, token: str, tenant_id: uuid.UUID, type_: str) -> dict[str, Any] | None: ...
    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]: ...
    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, status: int | None, error: str | None, retry_in_s: int | None, result: str | None) -> dict[str, Any]: ...
    def purge(self, worker: str) -> dict[str, Any]: ...


class PostgrestCrmPushRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def connections_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "crm_connections_list", {"p_tenant_id": str(tenant_id)})

    def connection_save(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, type_: str, config: dict[str, str], mapping: dict[str, str], events: list[str]) -> dict[str, Any]:
        return self._rpc.object(token, "crm_connection_save", {"p_tenant_id": str(tenant_id), "p_id": str(connection_id), "p_type": type_, "p_config": config, "p_mapping": mapping, "p_events": events})

    def connection_update(self, token: str, tenant_id: uuid.UUID, type_: str, mapping: dict[str, str] | None, events: list[str] | None, active: bool | None) -> dict[str, Any] | None:
        got = self._rpc.call(token, "crm_connection_update", {"p_tenant_id": str(tenant_id), "p_type": type_, "p_mapping": mapping, "p_events": events, "p_active": active})
        return got if isinstance(got, dict) else None

    def connection_delete(self, token: str, tenant_id: uuid.UUID, type_: str) -> uuid.UUID | None:
        got = self._rpc.call(token, "crm_connection_delete", {"p_tenant_id": str(tenant_id), "p_type": type_})
        return uuid.UUID(str(got)) if got else None

    def connection_tested(self, token: str, tenant_id: uuid.UUID, type_: str, ok: bool, reason: str | None) -> dict[str, Any] | None:
        got = self._rpc.call(token, "crm_connection_tested", {"p_tenant_id": str(tenant_id), "p_type": type_, "p_ok": ok, "p_reason": reason})
        return got if isinstance(got, dict) else None

    def deliveries_list(self, token: str, tenant_id: uuid.UUID, type_: str | None, before: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        got = self._rpc.call(token, "crm_deliveries_list", {"p_tenant_id": str(tenant_id), "p_type": type_, "p_before": before.isoformat() if before else None, "p_before_id": str(before_id) if before_id else None, "p_limit": limit})
        return [r for r in got if isinstance(r, dict)] if isinstance(got, list) else []

    def deliveries_retry(self, token: str, tenant_id: uuid.UUID, type_: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "crm_deliveries_retry", {"p_tenant_id": str(tenant_id), "p_type": type_})
        return got if isinstance(got, dict) else None

    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "crm_deliveries_claim", {"p_limit": limit})

    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, status: int | None, error: str | None, retry_in_s: int | None, result: str | None) -> dict[str, Any]:
        return self._rpc.object(worker, "crm_delivery_record", {"p_id": str(delivery_id), "p_ok": ok, "p_status": status, "p_error": error, "p_retry_in_s": retry_in_s, "p_result": result})

    def purge(self, worker: str) -> dict[str, Any]:
        return self._rpc.object(worker, "crm_purge", {})
