"""Placing a call on Plivo (job 3 phase B, 10 Nov 2026): the gate, the call's row, Plivo's API, and the mapping of how a call that was never answered ended.

  place(token, tenant, to, ...)   1. the business's own Plivo line is the caller id (Plivo: it must be a number rented from Plivo)
                                  2. THE GATE (app/telephony/gate.py check_outbound): the mode, the sandbox list (only numbers the owner owns while the deployment is a sandbox), hours 10:00 to 21:00 IST,
                                     DND, consent, "the AI says it is an AI", the open lines. A refusal is stored on a `refused` call row with its closed word, and nothing is dialled.
                                  3. the call row is begun (queued), Plivo is asked to dial (answer_url = our outbound-answer with the row's id, hangup_url = our hangup with the same), the row is marked ringing.
  When the callee picks up, Plivo asks the answer URL (signed); the media socket then runs the same pipeline as an inbound call (inbound_routes.run_admitted with `outbound=`).
  A call nobody answers never opens a socket: Plivo's hangup callback ends the row (busy / no answer / failed / cancelled) through `finish_unanswered`.

Real outbound calls go only to numbers on the sandbox list while TELEPHONY_MODE is `sandbox`; `live` is refused by the gate until TELEPHONY_LIVE_CONFIRMED, and no consent path exists yet (phase B places calls to the owner's own phones). Nothing here logs a phone number."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from app.connectors.phone import normalise
from app.rpc_base import RpcClient
from app.telephony import gate, persona
from app.telephony import tone as tone_mod
from app.telephony.line_limits import WorkspaceLines
from app.telephony.plivo_api import PlivoError

log = logging.getLogger("app.telephony.plivo_outbound")
PROVIDER = "plivo"
ALL_DAYS = (1, 2, 3, 4, 5, 6, 7)
TEST_PURPOSE = "visit_reminder"   # a transactional purpose: the test call is not a sales call
TEST_GOAL = ("This is a TEST call placed by the owner of the business to check the phone line and the voice. Greet them, ask whether the voice is clear, answer briefly if they say something, and say a short goodbye "
             "when they are done. Do not offer anything, do not ask for anything.")
TEST_OPENING = {"en": "Hello, this is {assistant}, the AI assistant of {business}. This is a test call to check the phone line. Can you hear me clearly?"}
TEST_OPENING_PLAIN = {"en": "Hello, this is {assistant} from {business}. This is a test call to check the phone line. Can you hear me clearly?"}
GOAL_FRAME = ("This call was set up by the owner of the business to a person the owner named, as a rehearsal of a real call. The goal, in the owner's own words: {goal} "
              "You cannot send, book, note, pass on or arrange anything on this call, nobody will call the person afterwards and no number or detail is shared with anyone; never promise otherwise. Never state a price. Say a short goodbye when you are done.")
MAX_GOAL = 400


def frame_goal(goal: str) -> str:
    """The goal the owner typed, inside the platform's own frame (what the assistant can and cannot do on a phone call)."""
    return GOAL_FRAME.format(goal=" ".join(goal.split())[:MAX_GOAL])


def opening_for(kind: str, language: str, tone: str = tone_mod.DEFAULT_TONE, introduce: object | None = None, say_ai: bool = True) -> str | None:
    """The words the call opens with (placeholders {assistant} {business}). `say_ai` is the RESOLVED setting "Say 'AI assistant' when greeting" (app/opening/greeting.py): true = "the AI assistant of {business}", false = the name only. A TEST call
    is English; a goal or task call opens in its language, in its tone, with the plain 'is this a good time' line."""
    from app.opening import greeting
    from app.tasks.dialer import OPENERS

    if kind == "test":
        return (TEST_OPENING if say_ai else TEST_OPENING_PLAIN)["en"]
    if not say_ai:
        return tone_mod.opener(language, tone, introduce, say_ai=False) or greeting.plain_outbound(language)
    return tone_mod.opener(language, tone, introduce) or OPENERS.get(language, OPENERS["en"])


class PendingGoals:
    """The goal text of calls just placed, kept in memory (one server) for the few seconds until the callee picks up. It is never put in an address (the hosting logs addresses) and never in the database."""

    def __init__(self, ttl_s: float = 600.0, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl, self._clock = ttl_s, clock
        self._items: dict[uuid.UUID, tuple[float, str]] = {}
        self._questions: dict[uuid.UUID, tuple[float, tuple[dict[str, str], ...]]] = {}
        self._extras: dict[uuid.UUID, tuple[str, bool, tuple[str, str | None] | None]] = {}
        self._jobs: dict[uuid.UUID, tuple[float, str]] = {}   # the job that placed the call (app/opening/greeting.JOB_KINDS): its own "say AI when greeting" applies when the callee picks up
        self._employees: dict[uuid.UUID, tuple[float, uuid.UUID]] = {}   # the AI employee that does the call (EMPLOYEES)
        self._people: dict[uuid.UUID, tuple[str | None, str | None]] = {}   # (the called person's name, their gender when KNOWN): the Respectful tone addresses a named person as "Name గారు"

    def put(self, call_id: uuid.UUID, goal: str, tone: str = tone_mod.DEFAULT_TONE, *, owner_test: bool = False, introduce: tuple[str, str | None] | None = None, questions: tuple[dict[str, str], ...] = ()) -> None:
        now = self._clock()
        for key in [k for k, (at, _) in self._items.items() if now - at > self._ttl]:
            del self._items[key]
            self._extras.pop(key, None)
            self._people.pop(key, None)
            self._jobs.pop(key, None)
        for key in [k for k, (at, _) in self._questions.items() if now - at > self._ttl]:
            del self._questions[key]
        self._items[call_id] = (now, goal)
        if questions:
            self._questions[call_id] = (now, questions)
        self._extras[call_id] = (tone if tone in tone_mod.TONES else tone_mod.DEFAULT_TONE, owner_test, introduce if owner_test else None)

    def take_questions(self, call_id: uuid.UUID) -> tuple[dict[str, str], ...]:
        """The questions of the plan this call carries (a Lead Desk task call), once."""
        item = self._questions.pop(call_id, None)
        return item[1] if item is not None and self._clock() - item[0] <= self._ttl else ()

    def take_extras(self, call_id: uuid.UUID) -> tuple[str, bool, tuple[str, str | None] | None]:
        """(tone, owner_test, introduce) this call was placed with (once). The default: friendly, a customer call, the business name."""
        return self._extras.pop(call_id, (tone_mod.DEFAULT_TONE, False, None))

    def keep_person(self, call_id: uuid.UUID, name: str | None, gender: str | None) -> None:
        if name or gender:
            self._people[call_id] = (name, gender)

    def keep_job(self, call_id: uuid.UUID, job: str | None) -> None:
        now = self._clock()
        for key in [k for k, (at, _) in self._jobs.items() if now - at > self._ttl]:   # a call nobody answered is never taken: forgotten here
            del self._jobs[key]
        if job:
            self._jobs[call_id] = (now, job)

    def keep_employee(self, call_id: uuid.UUID, employee_id: uuid.UUID | None) -> None:
        now = self._clock()
        for key in [k for k, (at, _) in self._employees.items() if now - at > self._ttl]:
            del self._employees[key]
        if employee_id:
            self._employees[call_id] = (now, employee_id)

    def take_employee(self, call_id: uuid.UUID) -> uuid.UUID | None:
        item = self._employees.pop(call_id, None)
        return item[1] if item is not None and self._clock() - item[0] <= self._ttl else None

    def take_job(self, call_id: uuid.UUID) -> str | None:
        item = self._jobs.pop(call_id, None)
        return item[1] if item is not None and self._clock() - item[0] <= self._ttl else None

    def take_person(self, call_id: uuid.UUID) -> tuple[str | None, str | None]:
        return self._people.pop(call_id, (None, None))

    def take_tone(self, call_id: uuid.UUID) -> str:
        return self.take_extras(call_id)[0]

    def take(self, call_id: uuid.UUID) -> str | None:
        item = self._items.pop(call_id, None)
        return item[1] if item is not None and self._clock() - item[0] <= self._ttl else None

    def drop(self, call_id: uuid.UUID) -> None:
        self._items.pop(call_id, None)
        self._questions.pop(call_id, None)
        self._extras.pop(call_id, None)
        self._people.pop(call_id, None)
        self._jobs.pop(call_id, None)


PENDING = PendingGoals()
LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml", "mr")
# how Plivo's hangup callback ends a call that was never answered (CallStatus -> the call's state and end reason)
UNANSWERED = {"busy": ("busy", "busy"), "no-answer": ("no_answer", "no_answer"), "timeout": ("no_answer", "no_answer"), "failed": ("failed", "error"), "cancel": ("cancelled", "stopped"),
              "completed": ("failed", "error")}   # (completed with no media socket = it was answered but our side never took it: that is a failure of ours)


class OutboundRefused(Exception):
    """The gate (or the setup) said no. `reason` is one of the gate's closed words; the refusal is already on a `refused` call row."""

    def __init__(self, reason: str, free_minutes: dict[str, Any] | None = None, *, wallet_low: bool = False, kyc_pending: bool = False) -> None:
        super().__init__(reason)
        self.reason = reason
        self.kyc_pending = kyc_pending   # billing_blocked because the business is not verified yet (KYC_PER_CLIENT): the Owner is told `kyc_pending`
        self.wallet_low = wallet_low   # billing_blocked because the balance does not cover a minute at the plan's rate (BILLING_CHARGE_CALLS): the Owner is told `wallet_low`
        # `billing_blocked` for a business with its own free-minutes number (Customer Zero): {minutes, restarts_on}, so the answer to the Owner can say so in one plain sentence (None for every other refusal)
        self.free_minutes = free_minutes


class OutboundRepo(Protocol):
    def line_for_tenant(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def begin(self, token: str, tenant_id: uuid.UUID, purpose: str, language: str, refuse_reason: str | None = None) -> uuid.UUID: ...
    def ringing(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, provider_call_id: str) -> None: ...
    def finish_unanswered(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, state: str, end_reason: str) -> None: ...
    def state(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any] | None: ...
    def proof(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any] | None: ...
    def set_proof(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> None: ...
    def prospect(self, token: str, tenant_id: uuid.UUID, number: str) -> bool: ...
    def approved(self, token: str, tenant_id: uuid.UUID, kind: str, ref: uuid.UUID | None, number: str | None) -> bool: ...
    def facts(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, number: str) -> dict[str, Any]: ...


class PostgrestOutboundRepo:
    """The database side, with the CALLER's token (an Owner's for a test call, the phone server's for the dialer)."""

    def __init__(self, rpc: RpcClient, provider: str = PROVIDER, *, wallet_enforced: bool = False, kyc_enforced: bool = False) -> None:
        self._kyc = kyc_enforced
        self._wallet = wallet_enforced   # BILLING_CHARGE_CALLS: an outbound call needs a minute of balance (or included minutes)
        self._rpc = rpc
        self._provider = provider   # the provider word of the calls and the line this repository places (plivo | voicelink)

    def line_for_tenant(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "phone_line_for_tenant", {"p_tenant_id": str(tenant_id), "p_provider": self._provider})
        if not isinstance(out, dict):
            return None
        if self._kyc and out.get("kyc_pending") is True:
            out = {**out, "billing_blocked": True, "kyc_blocked": True}
        wallet = out.get("wallet")
        if self._wallet and isinstance(wallet, dict) and wallet.get("outbound_ok") is False:
            out = {**out, "billing_blocked": True, "wallet_low": True}
        return out

    def begin(self, token: str, tenant_id: uuid.UUID, purpose: str, language: str, refuse_reason: str | None = None) -> uuid.UUID:
        out = self._rpc.object(token, "phone_call_begin", {"p_tenant_id": str(tenant_id), "p_direction": "outbound", "p_provider": self._provider, "p_sandbox": True, "p_purpose": purpose, "p_language": language,
                                                           "p_ai_disclosed": True, "p_refuse_reason": refuse_reason})
        return uuid.UUID(str(out["id"]))

    def ringing(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, provider_call_id: str) -> None:
        self._rpc.call(token, "phone_call_update", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_state": "ringing", "p_provider_call_sid": provider_call_id})

    def finish_unanswered(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, state: str, end_reason: str) -> None:
        self._rpc.call(token, "phone_call_finish", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_state": state, "p_end_reason": end_reason})

    def state(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "phone_call_state", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id)})
        return out if isinstance(out, dict) else None

    def proof(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "call_back_proof", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id)})
        return out if isinstance(out, dict) else None

    def set_proof(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> None:
        self._rpc.call(token, "phone_call_set_proof", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id)})

    def prospect(self, token: str, tenant_id: uuid.UUID, number: str) -> bool:
        return self._rpc.call(token, "prospect_no_ai_call", {"p_tenant_id": str(tenant_id), "p_number": number}) is True

    def approved(self, token: str, tenant_id: uuid.UUID, kind: str, ref: uuid.UUID | None, number: str | None) -> bool:
        return self._rpc.call(token, "call_approved", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_ref": str(ref) if ref else None, "p_number": number}) is True

    def facts(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, number: str) -> dict[str, Any]:
        """Everything the gate needs about this call from the database in one answer (consent, STOP, archive, proof of request, prospect, counts, hours): the same for the sandbox and the live path."""
        return self._rpc.object(token, "call_facts", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_number": number})


class PlivoCaller(Protocol):
    def place_call(self, *, from_number: str, to_number: str, answer_url: str, hangup_url: str, ring_timeout: int = 30, time_limit: int = 180) -> str: ...
    def cancel_request(self, request_uuid: str) -> bool: ...
    def hang_up(self, call_uuid: str) -> bool: ...


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
                 clock: Callable[[], datetime] = lambda: datetime.now(UTC), max_call_s: int = 180, api_for: Callable[[dict[str, Any]], PlivoCaller | None] | None = None, id_key: bytes = b"",
                 provider: str = PROVIDER, lines: WorkspaceLines | None = None, active_for_tenant: Callable[[uuid.UUID], int] | None = None) -> None:
        self._lines, self._active_for = lines, active_for_tenant   # EXTRA_LINES: a call is placed only while the workspace has a free line of its own (both given, or neither)
        self.provider = provider   # "plivo" or "voicelink": the word on the calls' rows and the kind of line this placer needs (the REST client behind `api` is the only other difference)
        self._id_key = id_key or os.urandom(32)   # keys the ids of the test-number list (a plain hash of a phone number could be guessed back)
        self._api, self._repo, self._gate, self._base = api, repo, gate_settings, public_base.rstrip("/")
        self._api_for = api_for   # the REST client for a line that sits in a SUBACCOUNT (its own Auth ID and token); None or a None answer: the main account's
        self._active, self._clock, self._max_call_s = active_calls, clock, max_call_s

    def test_numbers(self) -> list[dict[str, str]]:
        """The sandbox list for the Owner's screen: a stable id and a masked form (country code and the last five digits). The full number is never returned."""
        items = []
        for number in sorted(self._gate.sandbox_numbers):
            key = hmac.new(self._id_key, number.encode(), hashlib.sha256).hexdigest()[:16]
            items.append({"id": key, "masked": f"{number[:3]} ••••• {number[-5:]}"})
        return items

    def on_sandbox(self, number: str) -> bool:
        """Is this phone on the deployment's sandbox list (the only numbers a real call may ring while the line is in sandbox mode)?"""
        normal = normalise(number)
        return normal is not None and normal in self._gate.sandbox_numbers

    def number_for_id(self, test_number_id: str) -> str | None:
        """The sandbox number behind an id from `test_numbers`, or None."""
        for number in self._gate.sandbox_numbers:
            if hmac.compare_digest(hmac.new(self._id_key, number.encode(), hashlib.sha256).hexdigest()[:16], test_number_id):
                return number
        return None

    def place(self, token: str, tenant_id: uuid.UUID, to_number: str, *, lead_id: uuid.UUID | None = None, approval_kind: gate.Approval | None = None, approval_ref: uuid.UUID | None = None, language: str = "en", purpose: str = TEST_PURPOSE, kind: str = "test", business: str = "the business", goal: str | None = None, tone: str | None = None, owner_test: bool = False, introduce: tuple[str, str | None] | None = None, person_name: str | None = None, person_gender: str | None = None, questions: tuple[dict[str, str], ...] = (), say_ai: bool = True, job: str | None = None, employee_id: uuid.UUID | None = None) -> PlacedCall:
        language = language if language in LANGUAGES else "en"
        if goal and kind == "test":
            kind = "goal"   # the owner typed what the call is for: not the plain line-check
        if kind == "test":
            language = "en"   # the line-check is English
        number = normalise(to_number)
        line = self._repo.line_for_tenant(token, tenant_id)
        # casual is selectable ONLY on the Owner's own test call (`owner_test`, set by the Owner-only route); a Lead Desk task call to a customer is respectful or friendly, whatever is asked
        use_tone = (tone if tone in tone_mod.TONES else tone_mod.DEFAULT_TONE) if owner_test else tone_mod.for_task_call(tone)
        # the facts of THIS call, from the database, the same for the sandbox and the live path (planner, 19 Nov 2026): consent, STOP, archive, the person's own request, the counts, the hours. The owner's own phone in a
        # sandbox is exempt (a call to oneself); a call with no lead has no facts, so nobody is contacted on a guess; an answer we could not read is a refusal.
        sandbox_own = self._gate.mode == "sandbox" and number is not None and number in self._gate.sandbox_numbers
        facts: dict[str, Any] | None = None
        facts_unread = False
        if lead_id is not None and number is not None and line is not None and self._gate.mode != "off" and not sandbox_own:
            try:
                facts = self._repo.facts(token, tenant_id, lead_id, number)
            except Exception as exc:  # noqa: BLE001 - fail closed, never into the caller
                log.warning("plivo_outbound facts not read: %s", exc.__class__.__name__)
                facts_unread = True
        proof = None   # a LIVE call-back needs a request the person made (owner, 18 Nov 2026): found by the database from the lead's contact; the sandbox does not ask
        if self._gate.mode == "live":
            proof = bool(facts is not None and facts.get("proof") is True)
        prospect = False   # a Lead Finder prospect is never called (every mode); an answer we could not get counts as yes
        if number is not None and line is not None and self._gate.mode != "off":
            try:
                prospect = self._repo.prospect(token, tenant_id, number)
            except Exception as exc:  # noqa: BLE001 - fail closed, never into the caller
                log.warning("plivo_outbound prospect check not read: %s", exc.__class__.__name__)
                prospect = True
        approved = False   # the Owner's approval of THIS call (their own press, an approved task, a rule that is on, an approved batch, for THIS person's number): found by the database, never assumed; no kind given = not approved
        if approval_kind is not None and number is not None and line is not None and self._gate.mode != "off":
            try:
                approved = self._repo.approved(token, tenant_id, approval_kind, approval_ref, number)
            except Exception as exc:  # noqa: BLE001 - an answer we could not get is a refusal (a refused row with its closed word), never an escape into the caller
                log.warning("plivo_outbound approval not read: %s", exc.__class__.__name__)
        workspace: tuple[int, int] | None = None   # (the workspace's lines, its calls live now): the plain reason a call is refused when every line is on a call
        if self._lines is not None and self._active_for is not None and line is not None and self._gate.mode != "off":
            total = self._lines.total(tenant_id)
            if total is not None:
                workspace = (total, self._active_for(tenant_id))
        reason = self._decide(number, purpose, language, kind, business, have_line=line is not None, workspace=workspace, tone=use_tone, billing_ok=not (line or {}).get("billing_blocked"), proof=proof, prospect=prospect, approval=approval_kind if approved else None, facts=facts, facts_unread=facts_unread, say_ai=say_ai)
        if reason is not None:
            self._repo.begin(token, tenant_id, purpose, language, refuse_reason=reason)   # the refusal is recorded, with its closed word
            free = (line or {}).get("free_minutes")
            raise OutboundRefused(reason, free if reason == "billing_blocked" and isinstance(free, dict) else None, wallet_low=reason == "billing_blocked" and bool((line or {}).get("wallet_low")), kyc_pending=reason == "billing_blocked" and bool((line or {}).get("kyc_blocked")))
        assert number is not None and line is not None  # noqa: S101 - _decide refused otherwise
        call_id = self._repo.begin(token, tenant_id, purpose, language)
        if self._gate.mode == "live":
            self._repo.set_proof(token, tenant_id, call_id)   # the row keeps which request this call answers (the database finds it again)
        if goal:
            PENDING.put(call_id, goal, use_tone, owner_test=owner_test, introduce=introduce, questions=questions)
            PENDING.keep_person(call_id, person_name, person_gender)
        PENDING.keep_job(call_id, job)   # (also a call with no typed goal: a standing rule's call)
        PENDING.keep_employee(call_id, employee_id)
        query = answer_query(call_id, tenant_id, language, purpose, kind)
        try:
            api = (self._api_for(line) if self._api_for is not None else None) or self._api
            sid = api.place_call(from_number=str(line["number"]), to_number=number, answer_url=f"{self._base}/v1/telephony/{self.provider}/outbound-answer?{query}",
                                       hangup_url=f"{self._base}/v1/telephony/{self.provider}/hangup?{query}", time_limit=self._max_call_s)
        except PlivoError as exc:
            log.warning("%s_outbound place_failed reason=%s", self.provider, exc.reason)
            PENDING.drop(call_id)
            self._repo.finish_unanswered(token, tenant_id, call_id, "failed", "error")
            raise
        self._repo.ringing(token, tenant_id, call_id, sid)
        log.info("plivo_outbound placed call_fp=%s", str(call_id)[:8])
        return PlacedCall(call_id, sid)

    def cancel(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> str:
        """End a call WE placed that is still ringing (or queued): ask Plivo to cancel it (by the request uuid, else as a call), then close the row as `cancelled`. Returns `cancelled`, or `not_ringing` when the row is not
        a Plivo outbound call in a ringing state (it was answered, or it already ended: nothing is done). A Plivo that no longer knows the call counts as cancelled (it ended on its own). A Plivo that cannot be reached raises PlivoError."""
        state = self._repo.state(token, tenant_id, call_id)
        if state is None or state.get("direction") != "outbound" or state.get("provider") != self.provider or state.get("state") not in ("queued", "ringing"):
            return "not_ringing"
        sid = str(state.get("provider_call_sid") or "")
        if sid:
            line = self._repo.line_for_tenant(token, tenant_id)
            api = (self._api_for(line) if self._api_for is not None and line is not None else None) or self._api
            if not api.cancel_request(sid):
                api.hang_up(sid)   # (answered in the meantime, or a call id rather than a request id)
        self._repo.finish_unanswered(token, tenant_id, call_id, "cancelled", "stopped")
        log.info("plivo_outbound cancelled call_fp=%s", str(call_id)[:8])
        return "cancelled"

    def _decide(self, number: str | None, purpose: str, language: str, kind: str, business: str, *, have_line: bool, workspace: tuple[int, int] | None = None, tone: str = tone_mod.DEFAULT_TONE, approval: gate.Approval | None = None, billing_ok: bool = True, proof: bool | None = None, prospect: bool = False, facts: dict[str, Any] | None = None, facts_unread: bool = False, say_ai: bool = True) -> str | None:
        if number is None:
            return "bad_number"
        if not have_line:
            return "no_such_line"
        own = self._gate.mode == "sandbox" and number in self._gate.sandbox_numbers   # an owner's own phone: the only consent a SANDBOX call has (a test call to oneself). `live` has no consent path yet: it refuses (no_consent)
        opening = persona.opening_line(language, business=business, assistant=None, customer=None, owner_line=opening_for(kind, language, tone, None, say_ai), inbound=False, mention_ai=say_ai)
        hours = gate.Hours(days=ALL_DAYS, from_minute=gate.WINDOW_FROM_MINUTE, to_minute=gate.WINDOW_TO_MINUTE)
        extra: dict[str, Any] = {}
        if facts is not None and not own:
            row_hours = facts.get("hours")
            if isinstance(row_hours, dict) and isinstance(row_hours.get("days"), list):
                hours = gate.Hours(days=[int(d) for d in row_hours["days"]], from_minute=int(row_hours.get("from_minute", gate.WINDOW_FROM_MINUTE)), to_minute=int(row_hours.get("to_minute", gate.WINDOW_TO_MINUTE)))
            extra = {"can_contact": facts.get("can_contact") is True, "suppressed": facts.get("suppressed") is True, "erased_or_archived": facts.get("erased_or_archived") is True,
                     "calls_to_contact_this_week": int(facts.get("weekly_calls") or 0), "weekly_limit": max(1, int(facts.get("weekly_limit") or 1)), "calls_today": int(facts.get("calls_today") or 0),
                     "minutes_today": float(facts.get("minutes_today") or 0), "holidays": tuple(str(h) for h in (facts.get("holidays") or [])), "active_calls_to_number": int(facts.get("active_to_number") or 0), "recent_complaints": int(facts.get("complaints_10d") or 0),
                     "enquiry_age_days": float(facts["enquiry_age_days"]) if facts.get("enquiry_age_days") is not None else None, "registered_consent": facts.get("registered_consent") is True,
                     "own_number_verified": facts.get("own_number_verified") is True, "usage_ack": facts.get("usage_ack") is True, "logged_complaints": int(facts.get("logged_complaints_10d") or 0)}
        out_facts = gate.OutboundFacts(number=number, purpose=purpose, now=self._clock(), hours=hours,
                                       approval=approval, approval_valid=True, **{"can_contact": own, "dnd": "no" if own else "unknown", **extra}, opening_line=opening, say_ai=say_ai, active_calls_total=self._active(),
                                       billing_ok=billing_ok, proof_of_request=proof, prospect=prospect,
                                       workspace_lines=workspace[0] if workspace else None, active_calls_workspace=workspace[1] if workspace else 0)
        decision = gate.check_outbound(self._gate, out_facts)
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


# an outreach item belongs to a standing rule or to an approved batch; any other kind is refused (not guessed as a batch)
_APPROVAL_OF: dict[str, gate.Approval] = {"rule": "standing_rule", "batch": "plan", "plan": "plan"}


def _uuid_or_none(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


class PlivoDialer:
    """The outreach worker's `Dialer` (app/outreach/runner.py) on Plivo: place the call through `PlivoOutbound` (so the gate decides), then wait for its row to finish and answer the way `DialResult` wants.
    It blocks for the length of the call, so `max_wait_s` must stay under the worker task's timeout; a call still running then is hung up by Plivo's own `time_limit`. Not wired into the worker until the
    owner decides (OUTREACH_DIALER stays `fake`); real calls only to numbers on the sandbox list."""

    def __init__(self, outbound: PlivoOutbound, repo: OutboundRepo, token: Callable[[], str], *, max_wait_s: float = 100.0, poll_s: float = 2.0, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, say_ai_for: Callable[[str, uuid.UUID, str | None], bool] | None = None) -> None:
        self._outbound, self._repo, self._token, self._max_wait, self._poll, self._sleep, self._clock = outbound, repo, token, max_wait_s, poll_s, sleep, clock
        self._say_ai_for = say_ai_for   # the resolved "Say 'AI assistant' when greeting" for the job; without it the call says it (the strict side)

    def dial(self, call: dict[str, Any]) -> Any:
        from app.outreach.runner import DialResult

        tenant = uuid.UUID(str(call["tenant_id"]))
        language = str(call.get("language") or "en")
        token = self._token()
        job = "speed_to_lead" if call.get("owner_kind") == "rule" else None   # a standing rule is the speed-to-lead job; a batch is no job's
        say_ai = True
        if self._say_ai_for is not None:
            try:
                say_ai = bool(self._say_ai_for(token, tenant, job))
            except Exception as exc:  # noqa: BLE001 - only the class is logged; an unreadable setting is OFF, as everywhere
                log.warning("plivo_dialer greeting setting lookup failed %s", exc.__class__.__name__)
                say_ai = False
        try:
            placed = self._outbound.place(token, tenant, str(call.get("phone") or ""), lead_id=_uuid_or_none(call.get("lead_id")), approval_kind=_APPROVAL_OF.get(str(call.get("owner_kind"))), approval_ref=_uuid_or_none(call.get("item_id")), language=language, purpose="sales_followup", kind="task", say_ai=say_ai, job=job)
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
