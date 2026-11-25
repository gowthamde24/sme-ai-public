"""The database side (migration 20261231992360): SECURITY DEFINER functions only. The people's functions carry the caller's token; the scheduler_cal* ones carry the registered scheduler account's token (the
vendors' webhook door, the OAuth callback and the worker). The database decides who may do what."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class NotConnectedError(RepositoryError):
    """SM891: this calendar is not connected."""


class LinkStateError(RepositoryError):
    """SM892: not in a state that allows this (a used or expired authorization, too many open ones)."""


ERRORS: dict[str, type[RepositoryError]] = {"SM891": NotConnectedError, "SM892": LinkStateError}


class CalendarInRepository(Protocol):
    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def save(self, token: str, tenant_id: uuid.UUID, kind: str, label: str | None, last4: str | None, booking_link: str | None, hook_hash: str, hook_ref: str | None) -> dict[str, Any]: ...
    def settings(self, token: str, tenant_id: uuid.UUID, kind: str, booking_link: str | None, share_link: bool | None, write_events: bool | None, block_busy: bool | None, consent_question: str | None) -> dict[str, Any]: ...
    def ref(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]: ...
    def disconnect(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]: ...
    def outlook_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def needs_person(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    # the scheduler account
    def hook(self, token: str, hook_hash: str) -> dict[str, Any] | None: ...
    def booking_apply(self, token: str, tenant_id: uuid.UUID, kind: str, external_id: str, phone: str | None, email: str | None, starts_at: dt.datetime, ends_at: dt.datetime, purpose: str | None) -> dict[str, Any]: ...
    def booking_cancel(self, token: str, tenant_id: uuid.UUID, kind: str, external_id: str, starts_at: dt.datetime | None, ends_at: dt.datetime | None) -> dict[str, Any]: ...
    def booking_link(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def state_use(self, token: str, nonce: uuid.UUID, tenant_id: uuid.UUID, member_id: uuid.UUID) -> dict[str, Any]: ...
    def outlook_connected(self, token: str, tenant_id: uuid.UUID, member_id: uuid.UUID, last4: str | None) -> dict[str, Any]: ...
    def outlook_links(self, token: str, limit: int = 50) -> list[dict[str, Any]]: ...
    def visits_due(self, token: str, tenant_id: uuid.UUID, limit: int = 25) -> list[dict[str, Any]]: ...
    def event_done(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str | None, state: str, hash_hex: str | None, visit_updated_at: str) -> dict[str, Any]: ...
    def event_failed(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, code: str) -> dict[str, Any]: ...
    def link_failed(self, token: str, tenant_id: uuid.UUID, work: str, code: str, needs_reconnect: bool) -> dict[str, Any]: ...
    def busy_replace(self, token: str, tenant_id: uuid.UUID, blocks: list[tuple[dt.datetime, dt.datetime]]) -> dict[str, Any]: ...
    def own_events(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def scheduler_disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestCalendarInRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, ERRORS)

    # ---- the people
    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "calendar_connections_list", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, kind: str, label: str | None, last4: str | None, booking_link: str | None, hook_hash: str, hook_ref: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "calendar_connection_save", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_label": label, "p_last4": last4, "p_booking_link": booking_link, "p_hook_hash": hook_hash, "p_hook_ref": hook_ref})

    def settings(self, token: str, tenant_id: uuid.UUID, kind: str, booking_link: str | None, share_link: bool | None, write_events: bool | None, block_busy: bool | None, consent_question: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "calendar_connection_settings", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_booking_link": booking_link, "p_share_link": share_link,
                                                                         "p_write_events": write_events, "p_block_busy": block_busy, "p_consent_question": consent_question})

    def ref(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        return self._rpc.object(token, "calendar_connection_ref", {"p_tenant_id": str(tenant_id), "p_kind": kind})

    def disconnect(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        return self._rpc.object(token, "calendar_connection_disconnect", {"p_tenant_id": str(tenant_id), "p_kind": kind})

    def outlook_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "calendar_outlook_start", {"p_tenant_id": str(tenant_id)})

    def needs_person(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "calendar_bookings_list", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    # ---- the scheduler account
    def hook(self, token: str, hook_hash: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "scheduler_calendar_hook", {"p_hook_hash": hook_hash})
        return got if isinstance(got, dict) else None

    def booking_apply(self, token: str, tenant_id: uuid.UUID, kind: str, external_id: str, phone: str | None, email: str | None, starts_at: dt.datetime, ends_at: dt.datetime, purpose: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_calendar_booking_apply", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_external_id": external_id, "p_phone": phone, "p_email": email,
                                                                             "p_starts_at": starts_at.isoformat(), "p_ends_at": ends_at.isoformat(), "p_purpose": purpose})

    def booking_cancel(self, token: str, tenant_id: uuid.UUID, kind: str, external_id: str, starts_at: dt.datetime | None, ends_at: dt.datetime | None) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_calendar_booking_cancel", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_external_id": external_id,
                                                                              "p_starts_at": starts_at.isoformat() if starts_at else None, "p_ends_at": ends_at.isoformat() if ends_at else None})

    def booking_link(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "scheduler_calendar_booking_link", {"p_tenant_id": str(tenant_id)})
        return got if isinstance(got, dict) else None

    def state_use(self, token: str, nonce: uuid.UUID, tenant_id: uuid.UUID, member_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_state_use", {"p_nonce": str(nonce), "p_tenant_id": str(tenant_id), "p_member_id": str(member_id)})

    def outlook_connected(self, token: str, tenant_id: uuid.UUID, member_id: uuid.UUID, last4: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_outlook_connected", {"p_tenant_id": str(tenant_id), "p_member_id": str(member_id), "p_last4": last4})

    def outlook_links(self, token: str, limit: int = 50) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_cal_outlook_links", {"p_limit": limit})

    def visits_due(self, token: str, tenant_id: uuid.UUID, limit: int = 25) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_cal_visits_due", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    def event_done(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str | None, state: str, hash_hex: str | None, visit_updated_at: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_event_done", {"p_tenant_id": str(tenant_id), "p_visit_id": str(visit_id), "p_event_id": event_id, "p_state": state, "p_hash": hash_hex, "p_visit_updated_at": visit_updated_at})

    def event_failed(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, code: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_event_failed", {"p_tenant_id": str(tenant_id), "p_visit_id": str(visit_id), "p_error_code": code})

    def link_failed(self, token: str, tenant_id: uuid.UUID, work: str, code: str, needs_reconnect: bool) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_link_failed", {"p_tenant_id": str(tenant_id), "p_work": work, "p_error_code": code, "p_needs_reconnect": needs_reconnect})

    def busy_replace(self, token: str, tenant_id: uuid.UUID, blocks: list[tuple[dt.datetime, dt.datetime]]) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_busy_replace", {"p_tenant_id": str(tenant_id), "p_blocks": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in blocks]})

    def own_events(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_cal_own_events", {"p_tenant_id": str(tenant_id)})

    def scheduler_disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_cal_disconnect", {"p_tenant_id": str(tenant_id)})
