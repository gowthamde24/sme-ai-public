"""Inbound calls on the Exotel sandbox (job phone-calls part 5; owner, 4 Nov 2026: "TELEPHONY_MODE on in staging ONLY for inbound calls from +919502380998 into the Owner Test workspace; everything else off").

  GET|POST /v1/telephony/exotel/stream-url   what the Voicebot applet's URL field holds. Exotel asks it once per call and gets {"url": "wss://<api>/v1/telephony/exotel/stream?sample-rate=16000&t=<token>"}:
                                             the token is minted for THIS call, lives 120 seconds and is signed with EXOTEL_STREAM_SECRET (Secret Manager; never in the dashboard). Nothing secret sits in the
                                             dashboard: the URL field is a plain address.
  WS /v1/telephony/exotel/stream             the call. Nothing is heard or said until, in order:
      1. the token is good (signature, not expired);
      2. the `start` message names a caller on the sandbox list (TELEPHONY_SANDBOX_NUMBERS) and an ExoPhone that belongs to a workspace (public.phone_numbers, written by the operator);
      3. EXOTEL ITSELF confirms the call: GET /v1/Accounts/<sid>/Calls/<CallSid>.json with our API key answers a call in progress, from that caller, to that number (a forged `start` cannot pass);
      4. the inbound gate (app/telephony/gate.py `check_inbound`): the mode, the line, "answer inbound calls" on, the caller not blocked, the open lines, the hours.
     Then a phone_calls row (the scheduler account), the call session (app/telephony/call_session.py: the opening line says it is an AI, the phone persona, stop / voicemail / handover rules) and, at the end, ONE log
     line of numbers: the latency from the caller's last word to our first sound (p50, p95, per turn), the turns, the duration and the cost estimate. Never a number, a name or a word the caller said.
No outbound path exists here: this module never places a call (TELEPHONY_OUTBOUND stays false and the gate refuses outbound with it)."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import math
import os
import struct
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.connectors.phone import normalise
from app.telephony import exotel, gate
from app.telephony.line import PhoneLine

log = logging.getLogger("app.telephony.inbound")

TOKEN_TTL_S = 120
STREAM_PATH = "/v1/telephony/exotel/stream"


# ---------------------------------------------------------------------------------------------------------------------------------- the per-call token
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def mint(secret: bytes, now: float, call_sid: str = "") -> str:
    """expires (4 bytes) + nonce (6) + HMAC-SHA256 over both and the call's id when Exotel gave one (16): 35 URL-safe characters, well inside the applet's parameter limit."""
    head = struct.pack(">I", int(now) + TOKEN_TTL_S) + os.urandom(6)
    mac = hmac.new(secret, head + call_sid.encode("utf-8"), hashlib.sha256).digest()[:16]
    return _b64(head + mac)


def verify(secret: bytes, token: str, now: float, call_sid: str = "") -> bool:
    """True for a token this deployment minted that has not expired. A token minted for a call id is good only for that call (when the id was known at mint time it is bound)."""
    try:
        raw = _unb64(token)
    except (ValueError, TypeError):
        return False
    if len(raw) != 26:
        return False
    head, mac = raw[:10], raw[10:]
    (expires,) = struct.unpack(">I", head[:4])
    if now > expires:
        return False
    for bound in (call_sid, ""):
        if hmac.compare_digest(mac, hmac.new(secret, head + bound.encode("utf-8"), hashlib.sha256).digest()[:16]):
            return True
    return False


def fresh(token: str, now: float) -> bool:
    """Before the call says who it is: the token is well formed and not expired (its signature is checked once `start` names the call)."""
    try:
        raw = _unb64(token)
    except (ValueError, TypeError):
        return False
    return len(raw) == 26 and now <= struct.unpack(">I", raw[:4])[0]


def stream_url(public_base: str, token: str, sample_rate: int = 16000) -> str:
    base = public_base.rstrip("/")
    base = "wss://" + base.split("://", 1)[1] if "://" in base else "wss://" + base
    return f"{base}{STREAM_PATH}?sample-rate={sample_rate}&t={token}"


def first(params: dict[str, str], *names: str) -> str:
    """Exotel's flows name the same thing several ways (CallSid / call_sid, CallFrom / From)."""
    for name in names:
        value = params.get(name)
        if value:
            return str(value)
    return ""


# ---------------------------------------------------------------------------------------------------------------------------------- Exotel confirms the call
@dataclass(frozen=True)
class ProviderCall:
    status: str
    from_number: str | None
    to_number: str | None


class ExotelCalls:
    """One read-only request per call: GET the call's details with our API key. Never places, changes or ends a call."""

    def __init__(self, base: str, sid: str, api_key: str, api_token: str, *, client: httpx.AsyncClient | None = None) -> None:
        self._url = f"{base.rstrip('/')}/v1/Accounts/{sid}/Calls"
        self._auth = (api_key, api_token)
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0))

    def __repr__(self) -> str:
        return "ExotelCalls(<keys hidden>)"

    async def get(self, call_sid: str) -> ProviderCall | None:
        if not call_sid or not all(c.isalnum() or c in "-_" for c in call_sid) or len(call_sid) > 80:
            return None
        try:
            response = await self._client.get(f"{self._url}/{call_sid}.json", auth=self._auth)
        except httpx.HTTPError as exc:
            log.warning("exotel_call_check_unreachable %s", exc.__class__.__name__)
            return None
        if response.status_code != 200:
            log.warning("exotel_call_check_status %s", response.status_code)
            return None
        try:
            call = response.json().get("Call") or {}
        except ValueError:
            return None
        return ProviderCall(status=str(call.get("Status") or "").lower(), from_number=normalise(call.get("From")), to_number=normalise(call.get("To")))


# ---------------------------------------------------------------------------------------------------------------------------------- the shared trial number (sandbox only)
@dataclass(frozen=True)
class TrialRule:
    """Owner, 4 Nov 2026: Exotel's SHARED trial number (PIN routing) records its calls under Exotel's trial host account, so the lookup of step 3 can never confirm one. On THAT number only, and only
    in sandbox mode, a call is admitted instead when ALL hold: our per-call signed token (checked before admit), the one caller, the start message's account_sid = ours, its app id = ours, no other
    call open, at most `max_calls_per_day` a day (India time); the call is cut at `max_call_s`. Every other number keeps the strict Exotel lookup. The counts are this server's (staging runs at most
    two instances)."""

    number: str           # normalised (+91...)
    caller: str           # normalised
    account_sid: str
    app_id: str
    max_calls_per_day: int = 10
    max_call_s: int = 180
    max_concurrent: int = 1


class DayCount:
    """Calls admitted by the trial rule today (India time), in this process."""

    def __init__(self) -> None:
        self.day: str = ""
        self.n = 0

    def _today(self, now: datetime) -> str:
        return (now.astimezone(UTC) + timedelta(hours=5, minutes=30)).date().isoformat()

    def count(self, now: datetime) -> int:
        return self.n if self.day == self._today(now) else 0

    def add(self, now: datetime) -> None:
        today = self._today(now)
        self.n = self.n + 1 if self.day == today else 1
        self.day = today


def trial_rule(number: str, caller: str, account_sid: str | None, app_id: str, *, max_calls_per_day: int = 10, max_call_s: int = 180) -> TrialRule | None:
    """The rule from the settings, or None when any part is missing (then the trial number gets the strict lookup like every other number, and is refused)."""
    n, c = normalise(number), normalise(caller)
    if not (n and c and account_sid and app_id.strip()):
        return None
    return TrialRule(number=n, caller=c, account_sid=account_sid, app_id=app_id.strip(), max_calls_per_day=max(0, max_calls_per_day), max_call_s=max(30, min(max_call_s, 180)))


def _match(ours: str | None, theirs: str) -> str:
    if not theirs:
        return "absent"
    if not ours:
        return "unknown"
    return "yes" if hmac.compare_digest(ours.encode("utf-8"), theirs.encode("utf-8")) else "no"


# ---------------------------------------------------------------------------------------------------------------------------------- the decision before any audio
@dataclass(frozen=True)
class Admitted:
    tenant_id: uuid.UUID
    talk: bool
    rule: str = "exotel_lookup"   # which rule admitted the call: exotel_lookup | trial_number
    max_call_s: int | None = None   # a tighter cut than the deployment's, when the rule has one


async def admit(start: exotel.Start, settings: gate.Settings, *, find_line: Callable[[str], dict[str, Any] | None], calls: ExotelCalls | None, active_calls: int,
                now: datetime, hours: gate.Hours | None = None, our_sid: str | None = None, trial: TrialRule | None = None, trial_count: DayCount | None = None) -> Admitted | gate.Refused:
    """Steps 2 to 4 of the module note (or, on the shared trial number in sandbox mode, the trial rule instead of step 3). Refusals are the gate's closed words."""
    caller, line_no = normalise(start.from_number), normalise(start.to_number)
    log.info("exotel_start fields=%s custom=%s account_matches=%s app_id_matches=%s trial_number=%s", ",".join(start.fields) or "-", ",".join(sorted(start.custom)) or "-",
             _match(our_sid, start.account_sid), _match(trial.app_id if trial else None, start.app_id), "yes" if trial and line_no == trial.number else "no")
    if settings.mode == "off":
        return gate.Refused("telephony_off")
    if caller is None or line_no is None:
        return gate.Refused("bad_number")
    if settings.mode == "sandbox" and caller not in settings.sandbox_numbers:
        return gate.Refused("not_on_sandbox_list")
    found = await asyncio.to_thread(find_line, line_no)
    if not found:
        return gate.Refused("no_such_line")
    if trial is not None and line_no == trial.number:
        return _admit_trial(start, settings, trial, trial_count, found=found, caller=caller, line_no=line_no, active_calls=active_calls, now=now, hours=hours)
    if calls is None:
        return gate.Refused("telephony_off")   # without our Exotel key the call cannot be confirmed: fail closed
    confirmed = await calls.get(start.call_sid)
    if confirmed is None or confirmed.status not in ("in-progress", "in_progress", "ringing") or confirmed.from_number != caller:
        log.warning("exotel_call_not_confirmed status=%s", confirmed.status if confirmed else "none")
        return gate.Refused("not_approved")
    decision = gate.check_inbound(settings, gate.InboundFacts(to_number=line_no, now=now, line_known=True, inbound_on=bool(found.get("inbound_on")), hours=hours, active_calls_total=active_calls, from_number=caller))
    if isinstance(decision, gate.Refused):
        return decision
    return Admitted(tenant_id=uuid.UUID(str(found["tenant_id"])), talk=decision.talk)


def _admit_trial(start: exotel.Start, settings: gate.Settings, trial: TrialRule, count: DayCount | None, *, found: dict[str, Any], caller: str, line_no: str,
                 active_calls: int, now: datetime, hours: gate.Hours | None) -> Admitted | gate.Refused:
    if settings.mode != "sandbox":
        return gate.Refused("trial_not_sandbox")
    if caller != trial.caller:
        return gate.Refused("trial_caller")
    if _match(trial.account_sid, start.account_sid) != "yes":
        return gate.Refused("trial_account")
    if _match(trial.app_id, start.app_id) != "yes":
        return gate.Refused("trial_app_id")
    if active_calls >= trial.max_concurrent:
        return gate.Refused("trial_busy")
    if count is None or count.count(now) >= trial.max_calls_per_day:
        return gate.Refused("trial_day_limit")
    decision = gate.check_inbound(settings, gate.InboundFacts(to_number=line_no, now=now, line_known=True, inbound_on=bool(found.get("inbound_on")), hours=hours, active_calls_total=active_calls, from_number=caller))
    if isinstance(decision, gate.Refused):
        return decision
    count.add(now)
    return Admitted(tenant_id=uuid.UUID(str(found["tenant_id"])), talk=decision.talk, rule="trial_number", max_call_s=trial.max_call_s)


# ---------------------------------------------------------------------------------------------------------------------------------- the numbers of one call
def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, math.ceil(q * len(ordered)) - 1))
    return ordered[k]


class TimedLine(PhoneLine):
    """The phone line, keeping each turn's `first_sound_ms` (the caller's last word to our first sound: what they feel) before the browser-only message is dropped."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.first_sound_ms: list[float] = []

    async def send_json(self, message: dict[str, Any]) -> None:
        if message.get("type") == "timings" and isinstance(message.get("first_sound_ms"), (int, float)) and not message.get("interrupted"):
            self.first_sound_ms.append(float(message["first_sound_ms"]))
        await super().send_json(message)


def call_numbers(call_id: uuid.UUID, line: TimedLine, duration_s: float, cost_paise: int, outcome: str | None) -> dict[str, Any]:
    p50, p95 = percentile(line.first_sound_ms, 0.5), percentile(line.first_sound_ms, 0.95)
    return {"call": str(call_id), "turns": len(line.first_sound_ms), "first_sound_p50_ms": None if p50 is None else round(p50), "first_sound_p95_ms": None if p95 is None else round(p95),
            "duration_s": round(duration_s, 1), "cost_paise_estimate": cost_paise, "outcome": outcome, "end": line.end_reason}


def log_call(numbers: dict[str, Any]) -> None:
    log.info("phone_call_numbers %s", json.dumps(numbers, sort_keys=True))


def now_utc() -> datetime:
    return datetime.now(UTC)


def monotonic() -> float:
    return time.time()
