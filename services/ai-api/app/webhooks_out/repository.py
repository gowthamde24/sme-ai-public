"""The database functions of migration 20261231992000 behind an interface. The people's calls carry the person's token (Owner or Admin, checked by the database); the worker's carry the scheduler account's."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class WebhooksRepository(Protocol):
    def endpoints_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def endpoint_create(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, url: str, events: list[str], send_transcript: bool, last4: str) -> dict[str, Any] | None: ...
    def endpoint_update(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, url: str | None, events: list[str] | None, active: bool | None, send_transcript: bool | None) -> dict[str, Any] | None: ...
    def endpoint_rotate(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, last4: str) -> dict[str, Any] | None: ...
    def endpoint_delete(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> bool: ...
    def endpoint_test(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> dict[str, Any] | None: ...
    def deliveries_list(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID | None, before: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]: ...
    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, status: int | None, error: str | None, retry_in_s: int | None) -> dict[str, Any]: ...
    def purge(self, worker: str) -> dict[str, Any]: ...


class PostgrestWebhooksRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def endpoints_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "webhook_endpoints_list", {"p_tenant_id": str(tenant_id)})

    def endpoint_create(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, url: str, events: list[str], send_transcript: bool, last4: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "webhook_endpoint_create", {"p_tenant_id": str(tenant_id), "p_id": str(endpoint_id), "p_url": url, "p_events": events, "p_send_transcript": send_transcript, "p_last4": last4})
        return got if isinstance(got, dict) else None

    def endpoint_update(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, url: str | None, events: list[str] | None, active: bool | None, send_transcript: bool | None) -> dict[str, Any] | None:
        got = self._rpc.call(token, "webhook_endpoint_update", {"p_tenant_id": str(tenant_id), "p_id": str(endpoint_id), "p_url": url, "p_events": events, "p_active": active, "p_send_transcript": send_transcript})
        return got if isinstance(got, dict) else None

    def endpoint_rotate(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, last4: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "webhook_endpoint_rotate", {"p_tenant_id": str(tenant_id), "p_id": str(endpoint_id), "p_last4": last4})
        return got if isinstance(got, dict) else None

    def endpoint_delete(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> bool:
        return self._rpc.call(token, "webhook_endpoint_delete", {"p_tenant_id": str(tenant_id), "p_id": str(endpoint_id)}) is True

    def endpoint_test(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "webhook_endpoint_test", {"p_tenant_id": str(tenant_id), "p_id": str(endpoint_id)})
        return got if isinstance(got, dict) else None

    def deliveries_list(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID | None, before: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        got = self._rpc.call(token, "webhook_deliveries_list", {"p_tenant_id": str(tenant_id), "p_endpoint_id": str(endpoint_id) if endpoint_id else None,
                                                                 "p_before": before.isoformat() if before else None, "p_before_id": str(before_id) if before_id else None, "p_limit": limit})
        return [r for r in got if isinstance(r, dict)] if isinstance(got, list) else []

    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "webhook_deliveries_claim", {"p_limit": limit})

    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, status: int | None, error: str | None, retry_in_s: int | None) -> dict[str, Any]:
        return self._rpc.object(worker, "webhook_delivery_record", {"p_id": str(delivery_id), "p_ok": ok, "p_status": status, "p_error": error, "p_retry_in_s": retry_in_s})

    def purge(self, worker: str) -> dict[str, Any]:
        return self._rpc.object(worker, "webhook_purge", {})
