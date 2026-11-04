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
from datetime import UTC, datetime
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


# ---------------------------------------------------------------------------------------------------------------------------------- the decision before any audio
@dataclass(frozen=True)
class Admitted:
    tenant_id: uuid.UUID
    talk: bool


async def admit(start: exotel.Start, settings: gate.Settings, *, find_line: Callable[[str], dict[str, Any] | None], calls: ExotelCalls | None, active_calls: int,
                now: datetime, hours: gate.Hours | None = None) -> Admitted | gate.Refused:
    """Steps 2 to 4 of the module note. Refusals are the gate's closed words."""
    caller, line_no = normalise(start.from_number), normalise(start.to_number)
    if settings.mode == "off":
        return gate.Refused("telephony_off")
    if caller is None or line_no is None:
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
