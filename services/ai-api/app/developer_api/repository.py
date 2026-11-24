"""The developer API's database functions (migration 20261231210000) behind an interface. Settings -> Developers carries the PERSON's token; the program's requests carry the worker account's
token and the key's hash, and every function checks the key before it does anything."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class DeveloperRepository(Protocol):
    def keys_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def key_create(self, token: str, tenant_id: uuid.UUID, name: str, scopes: list[str], ip_allow: list[str], key_hash: str, prefix: str, last4: str) -> dict[str, Any] | None: ...
    def key_rotate(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID, key_hash: str, prefix: str, last4: str) -> dict[str, Any] | None: ...
    def key_revoke(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID) -> dict[str, Any] | None: ...
    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def auth(self, worker: str, key_hash: str, scope: str | None, ip: str | None) -> dict[str, Any]: ...
    def lead_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, lead: dict[str, Any]) -> dict[str, Any]: ...
    def lead_get(self, worker: str, key_hash: str, lead_id: uuid.UUID) -> dict[str, Any] | None: ...
    def leads_list(self, worker: str, key_hash: str, updated_since: datetime | None, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def api_usage(self, worker: str, key_hash: str) -> dict[str, Any]: ...
    def me(self, worker: str, key_hash: str) -> dict[str, Any] | None: ...
    def call_context(self, worker: str, key_hash: str, lead_id: uuid.UUID) -> dict[str, Any]: ...
    def call_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, lead_id: uuid.UUID, scheduled_for: datetime) -> dict[str, Any]: ...
    def call_get(self, worker: str, key_hash: str, call_id: uuid.UUID) -> dict[str, Any] | None: ...
    def calls_list(self, worker: str, key_hash: str, lead_id: uuid.UUID | None, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def campaign_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, campaign: dict[str, Any]) -> dict[str, Any]: ...
    def campaign_get(self, worker: str, key_hash: str, campaign_id: uuid.UUID) -> dict[str, Any] | None: ...
    def campaigns_list(self, worker: str, key_hash: str, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def activity_log(self, worker: str, key_hash: str, method: str, route: str, status: int, latency_ms: int) -> bool: ...
    def activity_list(self, worker: str, key_hash: str, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def activity_for_settings(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID | None, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...


class PostgrestDeveloperRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def keys_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "developer_keys_list", {"p_tenant_id": str(tenant_id)})

    def key_create(self, token: str, tenant_id: uuid.UUID, name: str, scopes: list[str], ip_allow: list[str], key_hash: str, prefix: str, last4: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "developer_key_create", {"p_tenant_id": str(tenant_id), "p_name": name, "p_scopes": scopes, "p_ip_allow": ip_allow, "p_key_hash": key_hash, "p_prefix": prefix, "p_last4": last4})
        return got if isinstance(got, dict) else None

    def key_rotate(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID, key_hash: str, prefix: str, last4: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "developer_key_rotate", {"p_tenant_id": str(tenant_id), "p_key_id": str(key_id), "p_key_hash": key_hash, "p_prefix": prefix, "p_last4": last4})
        return got if isinstance(got, dict) else None

    def key_revoke(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "developer_key_revoke", {"p_tenant_id": str(tenant_id), "p_key_id": str(key_id)})
        return got if isinstance(got, dict) else None

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "developer_usage", {"p_tenant_id": str(tenant_id)})

    def auth(self, worker: str, key_hash: str, scope: str | None, ip: str | None) -> dict[str, Any]:
        return self._rpc.object(worker, "developer_api_auth", {"p_key_hash": key_hash, "p_scope": scope, "p_ip": ip})

    def lead_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, lead: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(worker, "developer_sandbox_lead_create", {"p_key_hash": key_hash, "p_idem_key": idem_key, "p_body_sha": body_sha, "p_lead": lead})

    def lead_get(self, worker: str, key_hash: str, lead_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(worker, "developer_sandbox_lead_get", {"p_key_hash": key_hash, "p_id": str(lead_id)})
        return got if isinstance(got, dict) else None

    def leads_list(self, worker: str, key_hash: str, updated_since: datetime | None, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "developer_sandbox_leads_list", {
            "p_key_hash": key_hash, "p_updated_since": updated_since.isoformat() if updated_since else None, "p_after_at": after_at.isoformat() if after_at else None,
            "p_after_id": str(after_id) if after_id else None, "p_limit": limit,
        })

    def api_usage(self, worker: str, key_hash: str) -> dict[str, Any]:
        return self._rpc.object(worker, "developer_api_usage", {"p_key_hash": key_hash})

    def me(self, worker: str, key_hash: str) -> dict[str, Any] | None:
        got = self._rpc.call(worker, "developer_api_me", {"p_key_hash": key_hash})
        return got if isinstance(got, dict) else None

    def call_context(self, worker: str, key_hash: str, lead_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(worker, "developer_sandbox_call_context", {"p_key_hash": key_hash, "p_lead_id": str(lead_id)})

    def call_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, lead_id: uuid.UUID, scheduled_for: datetime) -> dict[str, Any]:
        return self._rpc.object(worker, "developer_sandbox_call_create", {"p_key_hash": key_hash, "p_idem_key": idem_key, "p_body_sha": body_sha, "p_lead_id": str(lead_id), "p_scheduled_for": scheduled_for.isoformat()})

    def call_get(self, worker: str, key_hash: str, call_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(worker, "developer_sandbox_call_get", {"p_key_hash": key_hash, "p_id": str(call_id)})
        return got if isinstance(got, dict) else None

    def calls_list(self, worker: str, key_hash: str, lead_id: uuid.UUID | None, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "developer_sandbox_calls_list", {
            "p_key_hash": key_hash, "p_lead_id": str(lead_id) if lead_id else None, "p_after_at": after_at.isoformat() if after_at else None,
            "p_after_id": str(after_id) if after_id else None, "p_limit": limit,
        })

    def campaign_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, campaign: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(worker, "developer_sandbox_campaign_create", {"p_key_hash": key_hash, "p_idem_key": idem_key, "p_body_sha": body_sha, "p_campaign": campaign})

    def campaign_get(self, worker: str, key_hash: str, campaign_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(worker, "developer_sandbox_campaign_get", {"p_key_hash": key_hash, "p_id": str(campaign_id)})
        return got if isinstance(got, dict) else None

    def campaigns_list(self, worker: str, key_hash: str, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "developer_sandbox_campaigns_list", {
            "p_key_hash": key_hash, "p_after_at": after_at.isoformat() if after_at else None, "p_after_id": str(after_id) if after_id else None, "p_limit": limit,
        })

    def activity_log(self, worker: str, key_hash: str, method: str, route: str, status: int, latency_ms: int) -> bool:
        return self._rpc.call(worker, "developer_api_activity_log", {"p_key_hash": key_hash, "p_method": method, "p_route": route, "p_status": status, "p_latency_ms": latency_ms}) is True

    def activity_list(self, worker: str, key_hash: str, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker, "developer_api_activity_list", {
            "p_key_hash": key_hash, "p_before_at": before_at.isoformat() if before_at else None, "p_before_id": str(before_id) if before_id else None, "p_limit": limit,
        })

    def activity_for_settings(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID | None, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "developer_activity_list", {
            "p_tenant_id": str(tenant_id), "p_key_id": str(key_id) if key_id else None, "p_before_at": before_at.isoformat() if before_at else None,
            "p_before_id": str(before_id) if before_id else None, "p_limit": limit,
        })
