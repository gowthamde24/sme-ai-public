"""The database functions of migration 20261231992345 behind an interface. The people's calls carry the person's token (every member reads, Owner or Admin change, checked by the database); the worker's carry the scheduler account's."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class NotifyRepository(Protocol):
    def channels_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def channel_put(self, token: str, tenant_id: uuid.UUID, kind: str, label: str | None, last4: str | None, events: list[str] | None, fields: list[str] | None, language: str | None) -> dict[str, Any]: ...
    def channel_delete(self, token: str, tenant_id: uuid.UUID, kind: str) -> bool: ...
    def channel_test_result(self, token: str, tenant_id: uuid.UUID, kind: str, ok: bool, reason: str | None) -> dict[str, Any] | None: ...
    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]: ...
    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, reason: str | None, retry_in_s: int | None) -> dict[str, Any]: ...
    def scan_low_balance(self, worker: str) -> dict[str, Any]: ...
    def purge(self, worker: str) -> dict[str, Any]: ...


class PostgrestNotifyRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def channels_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "notify_channels_list", {"p_tenant_id": str(tenant_id)})

    def channel_put(self, token: str, tenant_id: uuid.UUID, kind: str, label: str | None, last4: str | None, events: list[str] | None, fields: list[str] | None, language: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "notify_channel_put", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_label": label, "p_last4": last4, "p_events": events, "p_fields": fields, "p_language": language})

    def channel_delete(self, token: str, tenant_id: uuid.UUID, kind: str) -> bool:
        return self._rpc.call(token, "notify_channel_delete", {"p_tenant_id": str(tenant_id), "p_kind": kind}) is True

    def channel_test_result(self, token: str, tenant_id: uuid.UUID, kind: str, ok: bool, reason: str | None) -> dict[str, Any] | None:
        got = self._rpc.call(token, "notify_channel_test_result", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_ok": ok, "p_reason": reason})
        return got if isinstance(got, dict) else None

    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "notify_deliveries_claim", {"p_limit": limit})

    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, reason: str | None, retry_in_s: int | None) -> dict[str, Any]:
        return self._rpc.object(worker, "notify_delivery_record", {"p_id": str(delivery_id), "p_ok": ok, "p_reason": reason, "p_retry_in_s": retry_in_s})

    def scan_low_balance(self, worker: str) -> dict[str, Any]:
        return self._rpc.object(worker, "notify_scan_low_balance", {})

    def purge(self, worker: str) -> dict[str, Any]:
        return self._rpc.object(worker, "notify_purge", {})
