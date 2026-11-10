"""The phone calls behind an interface (Supabase PostgREST; job phone-calls part 6). Every call carries the CALLER's token; the functions are those of migration 20261225090000. Failures are classified by SQLSTATE only."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class CallStateError(RepositoryError):
    """SM961: the call is not in a state that allows this."""


class CorrectionInvalid(RepositoryError):
    """The database refused a correction (a note with a phone number or an e-mail address, or too long)."""


class CallsRepository(Protocol):
    def list_calls(self, token: str, tenant_id: uuid.UUID, state: str, limit: int, before: datetime | None) -> list[dict[str, Any]]: ...
    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]: ...
    def handled(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]: ...
    def correct(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, summary: str | None, captured: dict[str, str] | None, note: str | None) -> dict[str, Any]: ...
    def takeover_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def takeover_set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]: ...
    def takeover_event(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, event: str, detail: dict[str, int]) -> None: ...


class PostgrestCallsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM961": CallStateError, "23514": CorrectionInvalid}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def list_calls(self, token: str, tenant_id: uuid.UUID, state: str, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "phone_calls_list", {"p_tenant_id": str(tenant_id), "p_state": state, "p_limit": limit, "p_before": before.isoformat() if before else None})

    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "phone_call_get", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id)})

    def correct(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, summary: str | None, captured: dict[str, str] | None, note: str | None) -> dict[str, Any]:
        """"Correct it" (migration 20261231330000): null keeps a field, an empty string (or {}) clears it."""
        return self._rpc.object(token, "phone_call_correct", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_summary": summary, "p_captured": captured, "p_note": note})

    def handled(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        """A hand-over call was dealt with (the caller was called back): it leaves Today (migration 20261231160000)."""
        return self._rpc.object(token, "phone_call_handled", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id)})

    def takeover_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        """The business's switch for live take-over (job TO, migration 20261231430000): {enabled, updated_at}. Off until the Owner turns it on."""
        return self._rpc.object(token, "call_takeover_get", {"p_tenant_id": str(tenant_id)})

    def takeover_set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        """Owner only; the database audits every change with the old and the new value."""
        return self._rpc.object(token, "call_takeover_set", {"p_tenant_id": str(tenant_id), "p_enabled": enabled})

    def takeover_event(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, event: str, detail: dict[str, int]) -> None:
        """One audit entry for a take-over session event: start, whisper, hang_up or end. `detail` holds numbers only (duration_s, text_chars)."""
        self._rpc.call(token, "call_takeover_event", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_event": event, "p_detail": detail})
