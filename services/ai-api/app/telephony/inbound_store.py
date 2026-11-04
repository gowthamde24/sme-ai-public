"""The database side of an inbound call, as the registered scheduler account (the only principal `phone_line_find` answers; `phone_call_begin/_update/_finish` accept it for any workspace). Synchronous: the call
session runs it in a thread. The caller's number is never written here: an inbound call row has no contact until a person links one."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient
from app.telephony.outcome import CallOutcome


class Principal(Protocol):
    def token(self) -> str: ...
    def invalidate(self) -> None: ...


class InboundStore:
    def __init__(self, rpc: RpcClient, principal: Principal) -> None:
        self._rpc, self._principal = rpc, principal

    def _call(self, function: str, args: dict[str, Any]) -> Any:
        return self._rpc.call(self._principal.token(), function, args)

    def line_find(self, number: str) -> dict[str, Any] | None:
        out = self._call("phone_line_find", {"p_number": number})
        return out if isinstance(out, dict) else None

    def begin(self, tenant_id: uuid.UUID, language: str, refuse_reason: str | None = None) -> uuid.UUID:
        out = self._call("phone_call_begin", {"p_tenant_id": str(tenant_id), "p_direction": "inbound", "p_provider": "exotel", "p_sandbox": True, "p_purpose": "inbound", "p_language": language,
                                               "p_ai_disclosed": True, "p_refuse_reason": refuse_reason})
        return uuid.UUID(str(out["id"]))

    def for_call(self, tenant_id: uuid.UUID) -> CallRow:
        return CallRow(self, tenant_id)


class CallRow:
    """`CallStore` (app/telephony/call_session.py) for one call of one workspace."""

    def __init__(self, store: InboundStore, tenant_id: uuid.UUID) -> None:
        self._store, self._tenant = store, tenant_id

    def mark_in_progress(self, call_id: uuid.UUID, provider_call_sid: str | None) -> None:
        self._store._call("phone_call_update", {"p_tenant_id": str(self._tenant), "p_call_id": str(call_id), "p_state": "in_progress", "p_provider_call_sid": provider_call_sid})

    def finish(self, call_id: uuid.UUID, outcome: CallOutcome, duration_s: float) -> None:
        self._store._call("phone_call_finish", {
            "p_tenant_id": str(self._tenant), "p_call_id": str(call_id), "p_state": outcome.state, "p_end_reason": outcome.end_reason, "p_outcome": outcome.outcome, "p_category": outcome.category,
            "p_callback_at": outcome.callback_at.isoformat() if outcome.callback_at else None, "p_captured": outcome.captured or None, "p_summary": outcome.summary,
            "p_transcript": outcome.transcript or None, "p_cost_paise": outcome.cost_paise,
        })
