"""The database functions of migration 20261231992340 behind an interface. The owner's calls carry the person's token (Owner or Admin, checked by the database); the receiver's, the worker's and the phone's carry
the scheduler account's."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class CommerceRepository(Protocol):
    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def connect(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, kind: str, label: str, token_hash: str, last4: str, lead_source_id: uuid.UUID | None) -> dict[str, Any]: ...
    def settings_set(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any] | None: ...
    def mark(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, state: str, problem: str | None, webhooks: bool | None) -> dict[str, Any] | None: ...
    def disconnect(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> bool: ...
    def by_token(self, worker: str, token_hash: str) -> dict[str, Any] | None: ...
    def order_upsert(self, worker: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, o: Any) -> dict[str, Any]: ...
    def order_lead_sent(self, worker: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, external_id: str) -> bool: ...
    def checkout_upsert(self, worker: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, c: Any, wait_min: int) -> dict[str, Any]: ...
    def checkouts_claim(self, worker: str, limit: int) -> list[dict[str, Any]]: ...
    def checkout_finish(self, worker: str, checkout_id: uuid.UUID, result: str) -> bool: ...
    def order_facts(self, worker: str, tenant_id: uuid.UUID, phone: str) -> list[dict[str, Any]]: ...
    def purge(self, worker: str) -> dict[str, Any]: ...


def _iso(value: datetime) -> str:
    return value.isoformat()


class PostgrestCommerceRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "commerce_connections_list", {"p_tenant_id": str(tenant_id)})

    def connect(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, kind: str, label: str, token_hash: str, last4: str, lead_source_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "commerce_connect", {"p_tenant_id": str(tenant_id), "p_id": str(connection_id), "p_kind": kind, "p_store_label": label, "p_token_hash": token_hash, "p_last4": last4,
                                                            "p_lead_source_id": str(lead_source_id) if lead_source_id else None})

    def settings_set(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any] | None:
        got = self._rpc.call(token, "commerce_settings_set", {"p_tenant_id": str(tenant_id), "p_id": str(connection_id), "p_settings": settings})
        return got if isinstance(got, dict) else None

    def mark(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, state: str, problem: str | None, webhooks: bool | None) -> dict[str, Any] | None:
        got = self._rpc.call(token, "commerce_mark", {"p_tenant_id": str(tenant_id), "p_id": str(connection_id), "p_state": state, "p_problem": problem, "p_webhooks": webhooks})
        return got if isinstance(got, dict) else None

    def disconnect(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> bool:
        return self._rpc.call(token, "commerce_disconnect", {"p_tenant_id": str(tenant_id), "p_id": str(connection_id)}) is True

    def by_token(self, worker: str, token_hash: str) -> dict[str, Any] | None:
        got = self._rpc.call(worker, "commerce_connection_by_token", {"p_token_hash": token_hash})
        return got if isinstance(got, dict) else None

    def order_upsert(self, worker: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, o: Any) -> dict[str, Any]:
        return self._rpc.object(worker, "commerce_order_upsert", {"p_tenant_id": str(tenant_id), "p_connection_id": str(connection_id), "p_external_id": o.external_id, "p_number": o.number, "p_status": o.status,
                                                                  "p_payment": o.payment, "p_total_paise": o.total_paise, "p_items": o.items, "p_tracking": o.tracking, "p_phone": o.phone,
                                                                  "p_placed_at": _iso(o.placed_at), "p_checkout_ref": o.checkout_ref})

    def order_lead_sent(self, worker: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, external_id: str) -> bool:
        return self._rpc.call(worker, "commerce_order_lead_sent", {"p_tenant_id": str(tenant_id), "p_connection_id": str(connection_id), "p_external_id": external_id}) is True

    def checkout_upsert(self, worker: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, c: Any, wait_min: int) -> dict[str, Any]:
        return self._rpc.object(worker, "commerce_checkout_upsert", {"p_tenant_id": str(tenant_id), "p_connection_id": str(connection_id), "p_external_id": c.external_id, "p_phone": c.phone, "p_name": c.name,
                                                                     "p_total_paise": c.total_paise, "p_items": c.items, "p_completed": c.completed, "p_wait_min": wait_min})

    def checkouts_claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        got = self._rpc.call(worker, "commerce_checkouts_claim", {"p_limit": limit})
        return [r for r in got if isinstance(r, dict)] if isinstance(got, list) else []

    def checkout_finish(self, worker: str, checkout_id: uuid.UUID, result: str) -> bool:
        return self._rpc.call(worker, "commerce_checkout_finish", {"p_id": str(checkout_id), "p_result": result}) is True

    def order_facts(self, worker: str, tenant_id: uuid.UUID, phone: str) -> list[dict[str, Any]]:
        got = self._rpc.call(worker, "commerce_order_facts", {"p_tenant_id": str(tenant_id), "p_phone": phone})
        return [r for r in got if isinstance(r, dict)] if isinstance(got, list) else []

    def purge(self, worker: str) -> dict[str, Any]:
        return self._rpc.object(worker, "commerce_purge", {})
