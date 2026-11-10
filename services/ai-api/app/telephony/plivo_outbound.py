"""Placing a call on Plivo (job 3 phase B, 10 Nov 2026): the gate, the call's row, Plivo's API, and the mapping of how a call that was never answered ended.

  place(token, tenant, to, ...)   1. the business's own Plivo line is the caller id (Plivo: it must be a number rented from Plivo)
                                  2. THE GATE (app/telephony/gate.py check_outbound): the mode, the sandbox list (only numbers the owner owns while the deployment is a sandbox), hours 09:00 to 21:00 IST,
                                     DND, consent, "the AI says it is an AI", the open lines. A refusal is stored on a `refused` call row with its closed word, and nothing is dialled.
                                  3. the call row is begun (queued), Plivo is asked to dial (answer_url = our outbound-answer with the row's id, hangup_url = our hangup with the same), the row is marked ringing.
  When the callee picks up, Plivo asks the answer URL (signed); the media socket then runs the same pipeline as an inbound call (inbound_routes.run_admitted with `outbound=`).
  A call nobody answers never opens a socket: Plivo's hangup callback ends the row (busy / no answer / failed / cancelled) through `finish_unanswered`.

Real outbound calls go only to numbers on the sandbox list while TELEPHONY_MODE is `sandbox`; `live` is refused by the gate until TELEPHONY_LIVE_CONFIRMED, and no consent path exists yet (phase B places calls to the owner's own phones). Nothing here logs a phone number."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from app.connectors.phone import normalise
from app.rpc_base import RpcClient
from app.telephony import gate, persona
from app.telephony.plivo_api import PlivoError

log = logging.getLogger("app.telephony.plivo_outbound")
PROVIDER = "plivo"
ALL_DAYS = (1, 2, 3, 4, 5, 6, 7)
TEST_PURPOSE = "visit_reminder"   # a transactional purpose: the test call is not a sales call
TEST_GOAL = ("This is a TEST call placed by the owner of the business to check the phone line and the voice. Greet them, ask whether the voice is clear, answer briefly if they say something, and say a short goodbye "
             "when they are done. Do not offer anything, do not ask for anything.")
TEST_OPENING = {"en": "Hello, this is {assistant}, the AI assistant of {business}. This is a test call to check the phone line. Can you hear me clearly?"}
LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml", "mr")
# how Plivo's hangup callback ends a call that was never answered (CallStatus -> the call's state and end reason)
UNANSWERED = {"busy": ("busy", "busy"), "no-answer": ("no_answer", "no_answer"), "timeout": ("no_answer", "no_answer"), "failed": ("failed", "error"), "cancel": ("cancelled", "stopped"),
              "completed": ("failed", "error")}   # (completed with no media socket = it was answered but our side never took it: that is a failure of ours)


class OutboundRefused(Exception):
    """The gate (or the setup) said no. `reason` is one of the gate's closed words; the refusal is already on a `refused` call row."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class OutboundRepo(Protocol):
    def line_for_tenant(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def begin(self, token: str, tenant_id: uuid.UUID, purpose: str, language: str, refuse_reason: str | None = None) -> uuid.UUID: ...
    def ringing(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, provider_call_id: str) -> None: ...
    def finish_unanswered(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, state: str, end_reason: str) -> None: ...
    def state(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any] | None: ...


class PostgrestOutboundRepo:
    """The database side, with the CALLER's token (an Owner's for a test call, the phone server's for the dialer)."""

    def __init__(self, rpc: RpcClient) -> None:
        self._rpc = rpc

    def line_for_tenant(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "phone_line_for_tenant", {"p_tenant_id": str(tenant_id), "p_provider": PROVIDER})
        return out if isinstance(out, dict) else None

    def begin(self, token: str, tenant_id: uuid.UUID, purpose: str, language: str, refuse_reason: str | None = None) -> uuid.UUID:
        out = self._rpc.object(token, "phone_call_begin", {"p_tenant_id": str(tenant_id), "p_direction": "outbound", "p_provider": PROVIDER, "p_sandbox": True, "p_purpose": purpose, "p_language": language,
                                                           "p_ai_disclosed": True, "p_refuse_reason": refuse_reason})
        return uuid.UUID(str(out["id"]))

    def ringing(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, provider_call_id: str) -> None:
        self._rpc.call(token, "phone_call_update", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_state": "ringing", "p_provider_call_sid": provider_call_id})

    def finish_unanswered(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, state: str, end_reason: str) -> None:
        self._rpc.call(token, "phone_call_finish", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_state": state, "p_end_reason": end_reason})

    def state(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "phone_call_state", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id)})
        return out if isinstance(out, dict) else None


class PlivoCaller(Protocol):
    def place_call(self, *, from_number: str, to_number: str, answer_url: str, hangup_url: str, ring_timeout: int = 30, time_limit: int = 180) -> str: ...


@dataclass(frozen=True)
class PlacedCall:
    call_id: uuid.UUID
    provider_call_id: str
    state: str = "ringing"


def answer_query(call_id: uuid.UUID, tenant_id: uuid.UUID, language: str, purpose: str, kind: str) -> str:
    """The closed words and ids that tell the answer URL what this call is. No number, no name: Plivo signs the whole address, so it cannot be changed on the way."""
    return f"call={call_id}&tenant={tenant_id}&lang={language}&p={purpose}&k={kind}"


class PlivoOutbound:
    def __init__(self, *, api: PlivoCaller, repo: OutboundRepo, gate_settings: gate.Settings, public_base: str, active_calls: Callable[[], int] = lambda: 0,
                 clock: Callable[[], datetime] = lambda: datetime.now(UTC), max_call_s: int = 180, api_for: Callable[[dict[str, Any]], PlivoCaller | None] | None = None) -> None:
        self._api, self._repo, self._gate, self._base = api, repo, gate_settings, public_base.rstrip("/")
        self._api_for = api_for   # the REST client for a line that sits in a SUBACCOUNT (its own Auth ID and token); None or a None answer: the main account's
        self._active, self._clock, self._max_call_s = active_calls, clock, max_call_s

    def place(self, token: str, tenant_id: uuid.UUID, to_number: str, *, language: str = "en", purpose: str = TEST_PURPOSE, kind: str = "test", business: str = "the business") -> PlacedCall:
        language = language if language in LANGUAGES else "en"
        number = normalise(to_number)
        line = self._repo.line_for_tenant(token, tenant_id)
        reason = self._decide(number, purpose, language, kind, business, have_line=line is not None)
        if reason is not None:
            self._repo.begin(token, tenant_id, purpose, language, refuse_reason=reason)   # the refusal is recorded, with its closed word
            raise OutboundRefused(reason)
        assert number is not None and line is not None  # noqa: S101 - _decide refused otherwise
        call_id = self._repo.begin(token, tenant_id, purpose, language)
        query = answer_query(call_id, tenant_id, language, purpose, kind)
        try:
            api = (self._api_for(line) if self._api_for is not None else None) or self._api
            sid = api.place_call(from_number=str(line["number"]), to_number=number, answer_url=f"{self._base}/v1/telephony/plivo/outbound-answer?{query}",
                                       hangup_url=f"{self._base}/v1/telephony/plivo/hangup?{query}", time_limit=self._max_call_s)
        except PlivoError as exc:
            log.warning("plivo_outbound place_failed reason=%s", exc.reason)
            self._repo.finish_unanswered(token, tenant_id, call_id, "failed", "error")
            raise
        self._repo.ringing(token, tenant_id, call_id, sid)
        log.info("plivo_outbound placed call_fp=%s", str(call_id)[:8])
        return PlacedCall(call_id, sid)

    def _decide(self, number: str | None, purpose: str, language: str, kind: str, business: str, *, have_line: bool) -> str | None:
        if number is None:
            return "bad_number"
        if not have_line:
            return "no_such_line"
        own = self._gate.mode == "sandbox" and number in self._gate.sandbox_numbers   # an owner's own phone: the only consent a SANDBOX call has (a test call to oneself). `live` has no consent path yet: it refuses (no_consent)
        opening = persona.opening_line(language if language in TEST_OPENING else "en", business=business, assistant=None, customer=None, owner_line=TEST_OPENING.get(language) if kind == "test" else None, inbound=False)
        facts = gate.OutboundFacts(number=number, purpose=purpose, now=self._clock(), hours=gate.Hours(days=ALL_DAYS, from_minute=gate.WINDOW_FROM_MINUTE, to_minute=gate.WINDOW_TO_MINUTE),
                                   approval="task", approval_valid=True, can_contact=own, dnd="no" if own else "unknown", opening_line=opening, active_calls_total=self._active())
        decision = gate.check_outbound(self._gate, facts)
        return decision.reason if isinstance(decision, gate.Refused) else None


def finish_after_hangup(repo: OutboundRepo, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, call_status: str) -> str | None:
    """Plivo's hangup callback for an OUTBOUND call: if the call row is still queued or ringing (nobody answered, or our side never took it), end it with the matching state. A call that was answered and ran
    through the media socket is finished by the call session itself, so it is left alone. Returns the state it set, or None."""
    state = repo.state(token, tenant_id, call_id)
    if state is None or state.get("state") not in ("queued", "ringing"):
        return None
    mapped = UNANSWERED.get(call_status.lower(), ("failed", "error"))
    repo.finish_unanswered(token, tenant_id, call_id, mapped[0], mapped[1])
    return mapped[0]


class PlivoDialer:
    """The outreach worker's `Dialer` (app/outreach/runner.py) on Plivo: place the call through `PlivoOutbound` (so the gate decides), then wait for its row to finish and answer the way `DialResult` wants.
    It blocks for the length of the call, so `max_wait_s` must stay under the worker task's timeout; a call still running then is hung up by Plivo's own `time_limit`. Not wired into the worker until the
    owner decides (OUTREACH_DIALER stays `fake`); real calls only to numbers on the sandbox list."""

    def __init__(self, outbound: PlivoOutbound, repo: OutboundRepo, token: Callable[[], str], *, max_wait_s: float = 100.0, poll_s: float = 2.0, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._outbound, self._repo, self._token, self._max_wait, self._poll, self._sleep, self._clock = outbound, repo, token, max_wait_s, poll_s, sleep, clock

    def dial(self, call: dict[str, Any]) -> Any:
        from app.outreach.runner import DialResult

        tenant = uuid.UUID(str(call["tenant_id"]))
        language = str(call.get("language") or "en")
        token = self._token()
        try:
            placed = self._outbound.place(token, tenant, str(call.get("phone") or ""), language=language, purpose="sales_followup", kind="task")
        except (OutboundRefused, PlivoError):
            return DialResult("failed")
        deadline = self._clock() + self._max_wait
        state: dict[str, Any] | None = None
        while self._clock() < deadline:
            state = self._repo.state(token, tenant, placed.call_id)
            if state is not None and state.get("state") not in ("queued", "ringing", "in_progress"):
                break
            self._sleep(self._poll)
        if state is None or state.get("state") in ("queued", "ringing", "in_progress"):
            return DialResult("failed")
        minutes = round((state.get("duration_s") or 0) / 60, 1)
        end = str(state.get("state"))
        if end in ("no_answer", "busy", "failed"):
            return DialResult(end, 0.0)
        if end == "voicemail":
            return DialResult("voicemail", minutes)
        outcome = {k: state[k] for k in ("outcome", "category", "captured", "callback_at") if state.get(k)}
        return DialResult("connected", minutes, outcome or None, stop=state.get("category") in ("do_not_call", "wrong_number"))
