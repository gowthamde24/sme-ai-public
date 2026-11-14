"""The database side of an inbound call, as the registered scheduler account (the only principal `phone_line_find` answers; `phone_call_begin/_update/_finish` accept it for any workspace). Synchronous: the call
session runs it in a thread. The caller's number is never written here: an inbound call row has no contact until a person links one."""

# ruff: noqa: E501

from __future__ import annotations

import time
import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient
from app.telephony.outcome import CallOutcome


class Principal(Protocol):
    def token(self) -> str: ...
    def invalidate(self) -> None: ...


LINE_TTL_S = 300.0


class InboundStore:
    def __init__(self, rpc: RpcClient, principal: Principal) -> None:
        self._rpc, self._principal = rpc, principal
        self._lines: dict[str, tuple[float, dict[str, Any]]] = {}

    def scheduler_token(self) -> str:
        """The phone server's own token (the registered scheduler account), for the few calls that are not a call session's (ending a placed call nobody answered)."""
        return self._principal.token()

    def _call(self, function: str, args: dict[str, Any]) -> Any:
        return self._rpc.call(self._principal.token(), function, args)

    def line_find(self, number: str) -> dict[str, Any] | None:
        """The line's row (its workspace, whether it answers, the names a call says). A found line is remembered for LINE_TTL_S, so a call's admission does not wait for the database
        (owner, 6 Nov 2026: first sound under a second); a change to a line (switched off, renamed) applies within that time."""
        now = time.monotonic()
        hit = self._lines.get(number)
        if hit is not None and now - hit[0] < LINE_TTL_S:
            return dict(hit[1])
        out = self._call("phone_line_find", {"p_number": number})
        found = out if isinstance(out, dict) else None
        if found is not None:
            self._lines[number] = (now, dict(found))
        else:
            self._lines.pop(number, None)
        return found

    def begin(self, tenant_id: uuid.UUID, language: str, provider: str = "exotel", refuse_reason: str | None = None, ai_disclosed: bool = True) -> uuid.UUID:
        out = self._call("phone_call_begin", {"p_tenant_id": str(tenant_id), "p_direction": "inbound", "p_provider": provider, "p_sandbox": True, "p_purpose": "inbound", "p_language": language,
                                               "p_ai_disclosed": bool(ai_disclosed), "p_refuse_reason": refuse_reason})
        return uuid.UUID(str(out["id"]))

    def for_call(self, tenant_id: uuid.UUID) -> CallRow:
        return CallRow(self, tenant_id)

    def visit_slots(self, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        """The next free visit slots for this call (empty without the visits module)."""
        out = self._call("visit_slots_for_call", {"p_tenant_id": str(tenant_id)})
        return [s for s in out if isinstance(s, dict)] if isinstance(out, list) else []

    def call_corrections(self, tenant_id: uuid.UUID) -> list[str]:
        """The owner's latest notes from "Correct it" (app v4; migration 20261231330000): how to talk, never a caller's details; at most five, newest first."""
        out = self._call("call_corrections_for_call", {"p_tenant_id": str(tenant_id)})
        return [str(x) for x in out][:5] if isinstance(out, list) else []

    def mention_ai(self, tenant_id: uuid.UUID) -> bool:
        """The workspace's "mention that I'm an AI in the greeting" switch for this call (the scheduler account reads it). ON when nothing is saved or anything is unclear: never fewer words than the safe default."""
        out = self._call("phone_mention_ai_for_call", {"p_tenant_id": str(tenant_id)})
        return out is not False

    def talk_training(self, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        """The Owner's "How I talk to customers" for this call (the scheduler account reads it); None when nothing is saved."""
        out = self._call("talk_training_for_call", {"p_tenant_id": str(tenant_id)})
        return out if isinstance(out, dict) else None


class CallRow:
    """`CallStore` (app/telephony/call_session.py) for one call of one workspace."""

    def __init__(self, store: InboundStore, tenant_id: uuid.UUID) -> None:
        self._store, self._tenant = store, tenant_id

    def mark_in_progress(self, call_id: uuid.UUID, provider_call_sid: str | None) -> None:
        self._store._call("phone_call_update", {"p_tenant_id": str(self._tenant), "p_call_id": str(call_id), "p_state": "in_progress", "p_provider_call_sid": provider_call_sid})

    def note(self, call_id: uuid.UUID, assistant_name: str | None, line_id: str | None) -> None:
        """The assistant's name and the line this call came in on (for the live bar). Once; a second note keeps the first."""
        self._store._call("phone_call_note", {"p_tenant_id": str(self._tenant), "p_call_id": str(call_id), "p_assistant_name": assistant_name, "p_line_id": line_id})

    def heartbeat(self, call_id: uuid.UUID) -> None:
        self._store._call("phone_call_heartbeat", {"p_tenant_id": str(self._tenant), "p_call_id": str(call_id)})

    def book_from_call(self, call_id: uuid.UUID) -> None:
        """The visit time the caller agreed to (captured.visit_at) becomes a booking when the call is a customer's (it has a lead) and the owner lets the assistant book. One stable id per call: a retry books once."""
        visit_id = uuid.uuid5(uuid.NAMESPACE_URL, f"sme-ai-appointment-call:{self._tenant}:{call_id}")
        self._store._call("appointment_book_from_call", {"p_tenant_id": str(self._tenant), "p_call_id": str(call_id), "p_visit_id": str(visit_id)})

    def finish(self, call_id: uuid.UUID, outcome: CallOutcome, duration_s: float) -> None:
        self._store._call("phone_call_finish", {
            "p_tenant_id": str(self._tenant), "p_call_id": str(call_id), "p_state": outcome.state, "p_end_reason": outcome.end_reason, "p_outcome": outcome.outcome, "p_category": outcome.category,
            "p_callback_at": outcome.callback_at.isoformat() if outcome.callback_at else None, "p_captured": outcome.captured or None, "p_summary": outcome.summary,
            "p_transcript": outcome.transcript or None, "p_cost_paise": outcome.cost_paise,
        })
