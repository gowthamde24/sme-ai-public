"""The database side (migration 20261231800000): SECURITY DEFINER functions only. The people's functions carry the caller's token; the scheduler_gcal_* ones carry the registered scheduler account's
token (the worker, and the API's two public doors). The database decides who may do what."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class NotConnectedError(RepositoryError):
    """SM881: this business has no Google Calendar link."""


class LinkStateError(RepositoryError):
    """SM882: not in a state that allows this (a used or expired authorization, too many open ones)."""


ERRORS: dict[str, type[RepositoryError]] = {"SM881": NotConnectedError, "SM882": LinkStateError}


class GoogleCalendarRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, ERRORS)

    # ---- the people
    def status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "google_calendar_status", {"p_tenant_id": str(tenant_id)})

    def connect_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "google_calendar_connect_start", {"p_tenant_id": str(tenant_id)})

    def ref(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "google_calendar_ref", {"p_tenant_id": str(tenant_id)})

    def settings_set(self, token: str, tenant_id: uuid.UUID, write_events: bool, block_busy: bool) -> dict[str, Any]:
        return self._rpc.object(token, "google_calendar_settings_set", {"p_tenant_id": str(tenant_id), "p_write_events": write_events, "p_block_busy": block_busy})

    def sync_now(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "google_calendar_sync_now", {"p_tenant_id": str(tenant_id)})

    def disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "google_calendar_disconnect", {"p_tenant_id": str(tenant_id)})

    # ---- the scheduler account
    def state_use(self, token: str, nonce: uuid.UUID, tenant_id: uuid.UUID, member_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_state_use", {"p_nonce": str(nonce), "p_tenant_id": str(tenant_id), "p_member_id": str(member_id)})

    def connected(self, token: str, tenant_id: uuid.UUID, member_id: uuid.UUID, fingerprint: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_connected", {"p_tenant_id": str(tenant_id), "p_member_id": str(member_id), "p_fingerprint": fingerprint})

    def links(self, token: str, limit: int = 50) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_gcal_links", {"p_limit": limit})

    def visits_due(self, token: str, tenant_id: uuid.UUID, limit: int = 25) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_gcal_visits_due", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    def event_done(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str, state: str, hash_hex: str | None, visit_updated_at: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_event_done", {"p_tenant_id": str(tenant_id), "p_visit_id": str(visit_id), "p_event_id": event_id, "p_state": state,
                                                                     "p_hash": hash_hex, "p_visit_updated_at": visit_updated_at})

    def event_failed(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str, code: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_event_failed", {"p_tenant_id": str(tenant_id), "p_visit_id": str(visit_id), "p_event_id": event_id, "p_error_code": code})

    def link_failed(self, token: str, tenant_id: uuid.UUID, work: str, code: str, needs_reconnect: bool) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_link_failed", {"p_tenant_id": str(tenant_id), "p_work": work, "p_error_code": code, "p_needs_reconnect": needs_reconnect})

    def own_events(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_gcal_own_events", {"p_tenant_id": str(tenant_id)})

    def busy_replace(self, token: str, tenant_id: uuid.UUID, blocks: list[tuple[dt.datetime, dt.datetime]]) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_busy_replace", {"p_tenant_id": str(tenant_id), "p_blocks": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in blocks]})

    def channel_set(self, token: str, tenant_id: uuid.UUID, channel_id: uuid.UUID, resource_id: str, expires_at: dt.datetime) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_channel_set", {"p_tenant_id": str(tenant_id), "p_channel_id": str(channel_id), "p_resource_id": resource_id, "p_expires_at": expires_at.isoformat()})

    def channel_lookup(self, token: str, channel_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "scheduler_gcal_channel_lookup", {"p_channel_id": str(channel_id)})
        return got if isinstance(got, dict) else None

    def busy_request(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_busy_request", {"p_tenant_id": str(tenant_id)})

    def set_email(self, token: str, tenant_id: uuid.UUID, email: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_email", {"p_tenant_id": str(tenant_id), "p_google_email": email})

    def scheduler_disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_gcal_disconnect", {"p_tenant_id": str(tenant_id)})
