# ruff: noqa: E501
"""The VoiceLink WebSocket-bot route (24 Nov 2026; docs/contracts/ and reports/voicelink-adapter-notes.md). VoiceLink connects to the bot's `websocket_url` when a call reaches one of our DIDs; the line then speaks base64 A-law (app/telephony/voicelink.py).

What decides a call, in order (a refusal is a closed word, as for Exotel and Plivo): the address token in the path (a secret of ours that sits only in the bot's URL: VoiceLink signs nothing) -> `start` (a codec we read) -> telephony not off -> the DID VoiceLink says it dialled is
one of OUR lines and a VoiceLink one (a row of public.phone_numbers, provider voicelink, written by the operator) -> sandbox: the caller is on the list -> the gate says yes (hours, concurrency) -> the shared pipeline (`run_admitted`, provider `voicelink`).

Off by default: the route answers nothing unless VOICELINK_WS_TOKEN is set (at least 32 characters, in Secret Manager). INBOUND ONLY for now: a call VoiceLink places for us (`add_lead`) is refused until the reseller client and the outbound path are built. UNVERIFIED until the first real call
(owner's purchase planned for 28 Nov 2026): the shape of the events (from VoiceLink's public documentation), whether our marks come back as `mark`, and `transfer`."""

from __future__ import annotations

import asyncio
import hmac
import logging
import uuid
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, WebSocket

from app.connectors.phone import normalise, normalise_line
from app.telephony import gate, inbound, voicelink
from app.telephony.inbound_routes import (
    InboundService,
    StarletteWire,
    _close,
    _prepare,
    _service,
    run_admitted,
)
from app.telephony.wire import VOICELINK

log = logging.getLogger("app.telephony.voicelink")
router = APIRouter(prefix="/v1/telephony/voicelink", tags=["telephony"])
PROVIDER = "voicelink"
MIN_TOKEN = 32


@dataclass(frozen=True)
class VoicelinkConfig:
    ws_token: str   # the secret address token of our WebSocket bot (VOICELINK_WS_TOKEN)

    def accepts(self, token: str) -> bool:
        return len(self.ws_token) >= MIN_TOKEN and hmac.compare_digest(self.ws_token.encode(), token.encode())

    def fingerprint_key(self) -> bytes:
        return self.ws_token.encode()


async def admit(start: Any, settings: gate.Settings, *, find_line: Any, active_calls: int, now: Any, hours: Any = None) -> inbound.Admitted | gate.Refused:
    """The VoiceLink counterpart of inbound.admit (which confirms the call with Exotel's own record: VoiceLink has none we can ask, so the secret address token is the confirmation)."""
    if settings.mode == "off":
        return gate.Refused("telephony_off")
    caller, line_no = normalise(start.from_number), normalise_line(start.to_number)
    if caller is None or line_no is None:
        return gate.Refused("bad_number")
    if settings.mode == "sandbox" and caller not in settings.sandbox_numbers:
        return gate.Refused("not_on_sandbox_list")
    found = await inbound.find_line_quick(find_line, line_no)
    if not found or found.get("provider") != PROVIDER:
        return gate.Refused("no_such_line")
    decision = gate.check_inbound(settings, gate.InboundFacts(to_number=line_no, now=now, line_known=True, inbound_on=bool(found.get("inbound_on")), hours=hours, active_calls_total=active_calls, from_number=caller))
    if isinstance(decision, gate.Refused):
        return decision
    return inbound.Admitted(tenant_id=uuid.UUID(str(found["tenant_id"])), talk=decision.talk, rule="voicelink_token")


@router.websocket("/ws/{token}")
async def stream(ws: WebSocket, token: str) -> None:
    runtime = getattr(ws.app.state, "runtime", None)
    log.info("voicelink_stream open")
    await ws.accept()
    await handle(_service(ws.app), getattr(runtime, "browser_voice", None) if runtime is not None else None, getattr(runtime, "live_calls", None) if runtime is not None else None, token, StarletteWire(ws))


async def handle(service: InboundService | None, bv: Any, live: Any, token: str, wire: Any, *, open_timeout: float = 10.0) -> None:
    """One VoiceLink call, from the address token to the last log line."""
    config = getattr(service, "voicelink", None) if service is not None else None
    if service is None or config is None or bv is None or not config.accepts(token):
        log.info("voicelink_inbound refused=%s", "off" if service is None or config is None or bv is None else "bad_token")
        return await _close(wire)
    line = inbound.TimedLine(wire, proto=VOICELINK)
    start = await line.open(open_timeout)
    if start is None:
        log.info("voicelink_inbound refused=no_start")
        return await _close(wire)
    key = config.fingerprint_key()
    log.info("voicelink_stream start call_fp=%s stream_fp=%s rate=%d", inbound.fingerprint(key, start.call_sid), inbound.fingerprint(key, start.stream_sid), start.sample_rate)
    if start.encoding != voicelink.ENCODING:
        return await _refuse(wire, line, "unsupported_encoding")
    if start.custom.get("call") or start.custom.get("tenant"):   # a call WE placed (add_lead): not built yet; never guessed
        return await _refuse(wire, line, "outbound_not_built")
    began = inbound.monotonic()
    decision = await admit(start, service.gate_settings, find_line=service.store.line_find, active_calls=live.count() if live is not None else 0, now=inbound.now_utc())
    if isinstance(decision, gate.Refused):
        return await _refuse(wire, line, decision.reason)
    preparing = asyncio.ensure_future(_prepare(service, bv, start))
    line.admitted_ms = round((inbound.monotonic() - began) * 1000)
    await run_admitted(service, bv, live, wire, line, start, decision, preparing, provider=PROVIDER)


async def _refuse(wire: Any, line: Any, reason: str) -> None:
    log.info("voicelink_inbound refused=%s", reason)
    with suppress(Exception):
        await line.hang_up("stopped")
    await _close(wire)


__all__ = ["router", "handle", "admit", "VoicelinkConfig"]
