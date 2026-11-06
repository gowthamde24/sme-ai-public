"""Inbound calls on the Exotel sandbox (job phone-calls part 5; owner, 4 Nov 2026: "TELEPHONY_MODE on in staging ONLY for inbound calls from +919502380998 into the Owner Test workspace; everything else off").

  GET|POST /v1/telephony/exotel/stream-url   what the Voicebot applet's URL field holds. Exotel asks it once per call and gets {"url": "wss://<api>/v1/telephony/exotel/stream/<token>?sample-rate=16000"}:
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

from app.connectors.phone import normalise, normalise_line
from app.telephony import exotel, gate
from app.telephony.line import PhoneLine

log = logging.getLogger("app.telephony.inbound")

TOKEN_TTL_S = 120
LOOKUP_RETRIES_S = (0.6, 1.2)   # Exotel's call lookup: asked again twice on a 404 (about 2 s in all) before the call is refused
STREAM_PATH = "/v1/telephony/exotel/stream"


# ---------------------------------------------------------------------------------------------------------------------------------- the per-call token
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


TRIAL_MARK = "trial"   # the stream-url request named the shared trial number as its `To`: the token says so, signed (the start message's `to` is the line the call LANDED on, 5 Nov 2026)


def _mac(secret: bytes, head: bytes, call_sid: str, mark: str) -> bytes:
    return hmac.new(secret, head + call_sid.encode("utf-8") + (b"\x00" + mark.encode("ascii") if mark else b""), hashlib.sha256).digest()[:16]


def mint(secret: bytes, now: float, call_sid: str = "", mark: str = "") -> str:
    """expires (4 bytes) + nonce (6) + HMAC-SHA256 over both, the call's id when Exotel gave one and the mark when there is one (16): 35 URL-safe characters, well inside the applet's parameter
    limit. The mark is never readable from the token, only provable with the secret."""
    head = struct.pack(">I", int(now) + TOKEN_TTL_S) + os.urandom(6)
    return _b64(head + _mac(secret, head, call_sid, mark))


def verify_mark(secret: bytes, token: str, now: float, call_sid: str = "") -> str | None:
    """The token's mark ("" or TRIAL_MARK) for a token this deployment minted that has not expired; None otherwise. A token minted for a call id is good only for that call."""
    try:
        raw = _unb64(token)
    except (ValueError, TypeError):
        return None
    if len(raw) != 26:
        return None
    head, mac = raw[:10], raw[10:]
    (expires,) = struct.unpack(">I", head[:4])
    if now > expires:
        return None
    for bound in (call_sid, ""):
        for mark in ("", TRIAL_MARK):
            if hmac.compare_digest(mac, _mac(secret, head, bound, mark)):
                return mark
    return None


def verify(secret: bytes, token: str, now: float, call_sid: str = "") -> bool:
    """True for a token this deployment minted that has not expired. A token minted for a call id is good only for that call (when the id was known at mint time it is bound)."""
    return verify_mark(secret, token, now, call_sid) is not None


def fresh(token: str, now: float) -> bool:
    """Before the call says who it is: the token is well formed and not expired (its signature is checked once `start` names the call)."""
    try:
        raw = _unb64(token)
    except (ValueError, TypeError):
        return False
    return len(raw) == 26 and now <= struct.unpack(">I", raw[:4])[0]


def stream_url(public_base: str, token: str, sample_rate: int = 16000) -> str:
    """The token rides in the PATH: on the 17:07 UTC call (4 Nov 2026) Exotel opened the stream with the query string dropped (no `t`, no `sample-rate`), so the call was refused `bad_token`. A path
    survives that. `?t=` is still accepted on the stream (the 13:29 UTC call kept its query)."""
    base = public_base.rstrip("/")
    base = "wss://" + base.split("://", 1)[1] if "://" in base else "wss://" + base
    return f"{base}{STREAM_PATH}/{token}?sample-rate={sample_rate}"


def fingerprint(secret: bytes, value: str) -> str:
    """A call id in the log as 8 hex characters of an HMAC with the stream secret: two log lines (or a Call SID from the dashboard) can be compared, the id itself is never written."""
    if not value:
        return "-"
    return hmac.new(secret, b"fp:" + value.encode("utf-8"), hashlib.sha256).hexdigest()[:8] + f"/{len(value)}"


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

    async def get(self, call_sid: str, *, retries_s: tuple[float, ...] = LOOKUP_RETRIES_S) -> ProviderCall | None:
        """A 404 is asked again after a short wait (the record of a call that has just been answered can lag behind its stream); anything else is final."""
        if not call_sid or not all(c.isalnum() or c in "-_" for c in call_sid) or len(call_sid) > 80:
            return None
        response = None
        for attempt, wait in enumerate((0.0, *retries_s)):
            if wait:
                await asyncio.sleep(wait)
            try:
                response = await self._client.get(f"{self._url}/{call_sid}.json", auth=self._auth)
            except httpx.HTTPError as exc:
                log.warning("exotel_call_check_unreachable %s", exc.__class__.__name__)
                return None
            log.info("exotel_call_check attempt=%d status=%s", attempt + 1, response.status_code)
            if response.status_code != 404:
                break
        if response is None or response.status_code != 200:
            log.warning("exotel_call_check_status %s", response.status_code if response is not None else "none")
            return None
        try:
            call = response.json().get("Call") or {}
        except ValueError:
            return None
        return ProviderCall(status=str(call.get("Status") or "").lower(), from_number=normalise(call.get("From")), to_number=normalise_line(call.get("To")))


# ---------------------------------------------------------------------------------------------------------------------------------- the shared trial number (sandbox only)
@dataclass(frozen=True)
class TrialRule:
    """Exotel's SHARED trial number (sandbox only; owner, 4 Nov 2026). It answers with a PIN prompt and routes the call into our flow, and the caller's number may arrive altered (roaming: Exotel did
    not recognise the registered phone, so it asked for the PIN). On THAT number only, and only in sandbox mode, the caller is NOT checked. A call is admitted when ALL hold:
      * our per-call signed token (checked before admit);
      * the start message's account_sid = ours (stack191);
      * its app id = ours when Exotel names one (it names none: then it is not a condition; a different one is refused);
      * no other call open; at most `max_calls_per_day` a day (India time);
      * Exotel's own record of the CallSid, read with OUR key under OUR account (asked again on a 404), exists and the call has not ended. That proves the call went through our flow.
    The call is cut at `max_call_s`. `caller` is only compared for the log (yes / no), never a condition. Every other number keeps the strict rule (the sandbox list, Exotel's record, the same caller).
    The counts are this server's (staging runs at most two instances)."""

    number: str           # normalised (+91...)
    account_sid: str
    app_id: str = ""      # empty: no app id to compare
    caller: str | None = None   # normalised; for the log only
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
    """The rule from the settings, or None without the number or our account (then the trial number gets the strict rule like every other number)."""
    n = normalise_line(number)
    if not (n and account_sid):
        return None
    return TrialRule(number=n, account_sid=account_sid, app_id=app_id.strip(), caller=normalise(caller), max_calls_per_day=max(0, max_calls_per_day), max_call_s=max(30, min(max_call_s, 180)))


def _match(ours: str | None, theirs: str) -> str:
    if not theirs:
        return "absent"
    if not ours:
        return "unknown"
    return "yes" if hmac.compare_digest(ours.encode("utf-8"), theirs.encode("utf-8")) else "no"


def number_shape(raw: str | None) -> str:
    """What a caller number LOOKS like, never its digits: "absent", or e.g. "plus12" / "zero11" / "digits10", with "+letters" when it holds letters (a masked caller id)."""
    text = (raw or "").strip()
    if not text:
        return "absent"
    digits = sum(ch.isdigit() for ch in text)
    lead = "plus" if text.startswith("+") else "zero" if text.startswith("0") else "digits"
    return f"{lead}{digits}" + ("+letters" if any(ch.isalpha() for ch in text) else "")


def caller_diagnosis(raw: str | None, ours: str | None) -> str:
    """For the log: the caller compared with our number (yes / no / absent), its shape, and whether it reads as an Indian number. Never a digit of it."""
    caller = normalise(raw or "")
    match = "absent" if not (raw or "").strip() else ("unknown" if not ours else ("yes" if caller == ours else "no"))
    return f"caller_matches={match} caller_shape={number_shape(raw)} caller_india={'yes' if caller and caller.startswith('+91') else 'no'}"


ENDED = frozenset({"completed", "failed", "busy", "no-answer", "no_answer", "canceled", "cancelled"})


# ---------------------------------------------------------------------------------------------------------------------------------- the decision before any audio
@dataclass(frozen=True)
class Admitted:
    tenant_id: uuid.UUID
    talk: bool
    rule: str = "exotel_lookup"   # which rule admitted the call: exotel_lookup | trial_pin_path
    max_call_s: int | None = None   # a tighter cut than the deployment's, when the rule has one


async def admit(start: exotel.Start, settings: gate.Settings, *, find_line: Callable[[str], dict[str, Any] | None], calls: ExotelCalls | None, active_calls: int,
                now: datetime, hours: gate.Hours | None = None, our_sid: str | None = None, trial: TrialRule | None = None, trial_count: DayCount | None = None,
                trial_by_url: bool = False) -> Admitted | gate.Refused:
    """Steps 2 to 4 of the module note; on the shared trial number in sandbox mode, the trial rule (TrialRule) instead. Refusals are the gate's closed words.

    The call is on the trial number when the start message's `to` is it, OR when the stream-url request named it as its `To` (`trial_by_url`: proven by the signed token's mark). The 10:15 UTC call
    of 5 Nov 2026 had `To` = the trial number on the stream-url request but `to` = the line it landed on in the start message, and was refused `no_such_line`."""
    caller, line_no = normalise(start.from_number), normalise_line(start.to_number)   # our line may be a landline (040...)
    by_to = trial is not None and line_no == trial.number
    on_trial = trial is not None and (by_to or trial_by_url)
    ours = trial.caller if trial is not None and trial.caller else (next(iter(sorted(settings.sandbox_numbers)), None) if settings.sandbox_numbers else None)
    log.info("exotel_start fields=%s custom=%s account_matches=%s app_id_matches=%s trial_number=%s to_shape=%s %s", ",".join(start.fields) or "-", ",".join(sorted(start.custom)) or "-",
             _match(our_sid, start.account_sid), _match(trial.app_id if trial and trial.app_id else None, start.app_id), "to" if by_to else "url" if on_trial else "no",
             number_shape(start.to_number), caller_diagnosis(start.from_number, ours))
    if settings.mode == "off":
        return gate.Refused("telephony_off")
    if on_trial and trial is not None:   # the trial number's own line, whatever the start message's `to` says
        return await _admit_trial(start, settings, trial, trial_count, find_line=find_line, calls=calls, line_no=trial.number, active_calls=active_calls, now=now, hours=hours)
    if line_no is None:
        return gate.Refused("bad_number")
    if caller is None:
        return gate.Refused("bad_number")
    if settings.mode == "sandbox" and caller not in settings.sandbox_numbers:
        return gate.Refused("not_on_sandbox_list")
    found = await asyncio.to_thread(find_line, line_no)
    if not found:
        return gate.Refused("no_such_line")
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


async def _admit_trial(start: exotel.Start, settings: gate.Settings, trial: TrialRule, count: DayCount | None, *, find_line: Callable[[str], dict[str, Any] | None], calls: ExotelCalls | None,
                       line_no: str, active_calls: int, now: datetime, hours: gate.Hours | None) -> Admitted | gate.Refused:
    if settings.mode != "sandbox":
        return gate.Refused("trial_not_sandbox")
    if _match(trial.account_sid, start.account_sid) != "yes":
        return gate.Refused("trial_account")
    if trial.app_id and _match(trial.app_id, start.app_id) == "no":   # checked when Exotel names an app id; its start message names none (owner: then not a condition), a DIFFERENT one is refused
        return gate.Refused("trial_app_id")
    if active_calls >= trial.max_concurrent:
        return gate.Refused("trial_busy")
    if count is None or count.count(now) >= trial.max_calls_per_day:
        return gate.Refused("trial_day_limit")
    found = await asyncio.to_thread(find_line, line_no)
    if not found:
        return gate.Refused("no_such_line")
    if calls is None:
        return gate.Refused("telephony_off")
    record = await calls.get(start.call_sid)   # under OUR account with OUR key, asked again on a 404: the CallSid is stack191's
    if record is None or record.status in ENDED:
        log.warning("exotel_call_not_confirmed rule=trial_pin_path status=%s", record.status if record else "none")
        return gate.Refused("not_approved")
    log.info("exotel_call_record status=%s record_%s", record.status or "-", caller_diagnosis(record.from_number, trial.caller))
    decision = gate.check_inbound(settings, gate.InboundFacts(to_number=line_no, now=now, line_known=True, inbound_on=bool(found.get("inbound_on")), hours=hours, active_calls_total=active_calls,
                                                              from_number=None))   # the caller is not a condition on the trial number (its number may arrive altered)
    if isinstance(decision, gate.Refused):
        return decision
    count.add(now)
    return Admitted(tenant_id=uuid.UUID(str(found["tenant_id"])), talk=decision.talk, rule="trial_pin_path", max_call_s=trial.max_call_s)


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
            "duration_s": round(duration_s, 1), "cost_paise_estimate": cost_paise, "outcome": outcome, "end": line.end_reason,
            # how it ended and what went each way (5 Nov 2026): names and numbers only
            "end_how": line.end_how, "stop_reason": line.stop_reason, "close_code": getattr(getattr(line, "_wire", None), "close_code", None), "events": dict(sorted(line.events.items())),
            "bytes_in": line.bytes_in, "bytes_out": line.bytes_out, "first_out_ms": None if line.first_out_s is None else round(line.first_out_s * 1000)}


def log_call(numbers: dict[str, Any]) -> None:
    log.info("phone_call_numbers %s", json.dumps(numbers, sort_keys=True))


def now_utc() -> datetime:
    return datetime.now(UTC)


def monotonic() -> float:
    return time.time()
