"""Exotel's Voicebot applet -> our phone assistant, INBOUND only (app/telephony/inbound.py has the rules). Two public addresses (no sign-in: Exotel cannot sign in; the token and Exotel's own confirmation are the
fence):

  GET|POST /v1/telephony/exotel/stream-url   -> 200 {"url": "wss://.../v1/telephony/exotel/stream?sample-rate=16000&t=<token>"}; 403 {"error": ...} while inbound is off or the caller is not on the sandbox list
  WS       /v1/telephony/exotel/stream?t=...  the call itself

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import logging
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from starlette.websockets import WebSocketDisconnect

from app.browser_voice.limits import Ledger
from app.browser_voice.routes import OWNER_SILENCE_MS, stt_mode_for
from app.browser_voice.runtime import BrowserVoice
from app.browser_voice.session import Parts
from app.connectors.phone import normalise
from app.conversation.fallback import FallbackTts
from app.conversation.pronounce import default_pronunciations
from app.conversation.providers import AnthropicStream, SarvamChatStream, SarvamRealtimeStt
from app.errors import ApiError
from app.telephony import gate, inbound, persona
from app.telephony.call_session import CallPlan, run_call
from app.telephony.inbound_store import InboundStore

log = logging.getLogger("app.telephony.inbound")
router = APIRouter(prefix="/v1/telephony/exotel", tags=["telephony"])


@dataclass
class InboundService:
    """Built by app/main.py only when TELEPHONY_MODE is sandbox or live AND the stream secret, the public address and the scheduler account are configured; None otherwise (both addresses answer 'off')."""

    secret: bytes
    public_base: str
    gate_settings: gate.Settings
    store: InboundStore
    calls: inbound.ExotelCalls | None
    cost_paise_per_minute: int
    language: str = "en"
    llm_choice: str = "haiku"
    business: str = "the business"   # what the opening line names (TELEPHONY_INBOUND_BUSINESS; the scheduler account does not read workspace names)
    max_call_s: int = 300
    url_format: str = "json"   # EXOTEL_STREAM_URL_FORMAT: json ({"url": ...}, the documented form) | text (the bare wss address)
    parts_for: Callable[[Any, str, str, str], tuple[Parts, str]] | None = None   # tests: fake recogniser, voice and model
    last_numbers: dict[str, Any] | None = None   # the numbers of the last call (the log line's), for the sandbox report
    our_sid: str | None = None   # EXOTEL_SID: the start message's account_sid is compared with it (yes / no in the log, never the value)
    trial: inbound.TrialRule | None = None   # the shared trial number's rule (sandbox only; app/telephony/inbound.py TrialRule)
    trial_count: inbound.DayCount = field(default_factory=inbound.DayCount)


class StarletteWire:
    """Exotel's WebSocket as the phone line's wire (text frames)."""

    def __init__(self, ws: WebSocket) -> None:
        self._ws = ws

    async def send_text(self, data: str) -> None:
        await self._ws.send_text(data)

    async def receive_text(self) -> str | None:
        try:
            message = await self._ws.receive()
        except (WebSocketDisconnect, RuntimeError):
            return None
        if message.get("type") == "websocket.disconnect":
            return None
        text = message.get("text")
        if text is None and message.get("bytes") is not None:
            text = bytes(message["bytes"]).decode("utf-8", "replace")
        return text if isinstance(text, str) else ""

    async def close(self) -> None:
        with suppress(Exception):
            await self._ws.close()


def _service(app: Any) -> InboundService | None:
    runtime = getattr(app.state, "runtime", None)
    return getattr(runtime, "phone_inbound", None) if runtime is not None else None


async def _params(request: Request) -> dict[str, str]:
    params = {k: str(v) for k, v in request.query_params.items()}
    if request.method == "POST":
        with suppress(Exception):
            form = await request.form()
            params.update({k: str(v) for k, v in form.items()})
    return params


@router.api_route("/stream-url", methods=["GET", "POST"])
async def stream_url(request: Request) -> Response:
    """Exotel asks once per call. A caller who is named and is not on the sandbox list never gets a token (the gate decides again on the stream, with Exotel's own confirmation).
    The answer is `{"url": "wss://..."}` (JSON, the documented form) unless EXOTEL_STREAM_URL_FORMAT=text, which answers the bare address as text/plain (the other reading of Exotel's docs)."""
    service = _service(request.app)
    params = await _params(request)
    # what Exotel sends, NAMES only (never a value: a caller's number is in there): to learn the request's shape on the first real calls
    log.info("exotel_stream_url request method=%s headers=%s params=%s", request.method, ",".join(sorted(k.lower() for k in request.headers.keys())), ",".join(sorted(params)) or "-")
    if service is None or service.gate_settings.mode == "off":
        log.info("exotel_stream_url refused=off")
        raise ApiError(403, "telephony_off", "Phone calls are not answered here.")
    raw_caller = inbound.first(params, "CallFrom", "From", "from")
    caller = normalise(raw_caller)
    ours = service.trial.caller if service.trial is not None and service.trial.caller else next(iter(sorted(service.gate_settings.sandbox_numbers)), None)
    log.info("exotel_stream_url %s from_vs_callfrom=%s", inbound.caller_diagnosis(raw_caller, ours),
             "same" if normalise(params.get("From", "")) == normalise(params.get("CallFrom", "")) else "differ")
    # the shared trial number may pass on an altered caller number (the stream decides there, without the caller); every other number: a named caller off the sandbox list gets no address
    if caller is not None and service.trial is None and service.gate_settings.mode == "sandbox" and caller not in service.gate_settings.sandbox_numbers:
        log.info("exotel_stream_url refused=not_on_sandbox_list")
        raise ApiError(403, "not_on_sandbox_list", "This number is not answered here.")
    call_sid = inbound.first(params, "CallSid", "call_sid", "CallSID")
    log.info("exotel_stream_url call_sid_fp=%s", inbound.fingerprint(service.secret, call_sid))
    # the shared trial number is in `To` here, while the start message's `to` is the line the call landed on (5 Nov 2026): the token carries "this call came in on the trial number", signed
    to_trial = service.trial is not None and normalise(inbound.first(params, "To", "to")) == service.trial.number
    log.info("exotel_stream_url to_is_trial=%s callto_is_trial=%s", "yes" if to_trial else "no",
             "yes" if service.trial is not None and normalise(params.get("CallTo", "")) == service.trial.number else "no")
    token = inbound.mint(service.secret, inbound.monotonic(), call_sid, inbound.TRIAL_MARK if to_trial else "")
    url = inbound.stream_url(service.public_base, token)
    log.info("exotel_stream_url issued format=%s token_in=path url_chars=%d", service.url_format, len(url))
    if service.url_format == "text":
        return PlainTextResponse(url)
    return JSONResponse({"url": url})


def phone_parts(bv: BrowserVoice, business: str, language: str, llm_choice: str) -> tuple[Parts, str]:
    """The Live-talk parts for a phone caller: the recogniser in auto (the caller may answer in any of the six languages), the workspace's default voices, the phone model (Haiku unless TELEPHONY_LLM=sarvam),
    the phone persona's system prompt (approved facts only: none yet for an inbound sandbox call, so it answers what it can and offers to pass on the rest) and the inbound opening line, which says it is an AI."""
    if llm_choice == "sarvam":
        llm: Any = SarvamChatStream(bv.sarvam_key, client=bv.client)
        model = "sarvam-105b"
    else:
        llm, model = AnthropicStream(bv.anthropic_key or "", client=bv.client), bv.fast_model
    tts = FallbackTts(bv.config, bv.factory, chosen={}, gender="female", pronunciations=default_pronunciations())
    parts = Parts(
        stt_for=lambda lang: SarvamRealtimeStt(bv.sarvam_key, language="auto", silence_ms=OWNER_SILENCE_MS, mode=stt_mode_for(lang, bv.stt_modes)),
        tts=tts,
        llm=llm,
        system_for=lambda lang: persona.system_prompt(business=business, assistant=None, language=lang, purpose="inbound", facts=[], customer_first_name=None),
        greeting_for=lambda lang: persona.opening_line(lang, business=business, assistant=None, customer=None, inbound=True),
        models={"fast": model, "strong": model},
        voice_for=lambda lang: bv.config.resolve(lang, None, "female").id,
        voice_name=lambda lang: bv.config.resolve(lang, None, "female").name,
        fillers=bv.fillers,
    )
    return parts, model


async def _close(wire: Any) -> None:
    with suppress(Exception):
        out = wire.close()
        if asyncio.iscoroutine(out):
            await out


async def _refuse(wire: Any, line: Any, reason: str) -> None:
    log.info("exotel_inbound refused=%s", reason)
    with suppress(Exception):
        await line.hang_up("stopped")
    await _close(wire)


@router.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    await _stream(ws, "")


@router.websocket("/stream/{token}")
async def stream_with_token(ws: WebSocket, token: str) -> None:
    """The token in the path (the address the Voicebot URL answers): it survives a provider that drops the query string."""
    await _stream(ws, token)


async def _stream(ws: WebSocket, path_token: str) -> None:
    runtime = getattr(ws.app.state, "runtime", None)
    log.info("exotel_stream open headers=%s params=%s path_token=%s", ",".join(sorted(k.lower() for k in ws.headers.keys())), ",".join(sorted(ws.query_params.keys())) or "-",
             "yes" if path_token else "no")
    await ws.accept()
    await handle(_service(ws.app), getattr(runtime, "browser_voice", None) if runtime is not None else None, getattr(runtime, "live_calls", None) if runtime is not None else None,
                 path_token or ws.query_params.get("t") or "", StarletteWire(ws))


async def handle(service: InboundService | None, bv: Any, live: Any, token: str, wire: Any, *, open_timeout: float = 10.0) -> None:
    """One call, from the token to the last log line (the module note of app/telephony/inbound.py has the order of the checks)."""
    if service is None or bv is None or not inbound.fresh(token, inbound.monotonic()):
        log.info("exotel_inbound refused=%s", "off" if service is None or bv is None else "bad_token")
        return await _close(wire)
    line = inbound.TimedLine(wire)
    start = await line.open(open_timeout)
    if start is None:
        log.info("exotel_inbound refused=no_start")
        return await _close(wire)
    log.info("exotel_stream start call_sid_fp=%s stream_sid_fp=%s", inbound.fingerprint(service.secret, start.call_sid), inbound.fingerprint(service.secret, start.stream_sid))
    mark = inbound.verify_mark(service.secret, token, inbound.monotonic(), start.call_sid)
    if mark is None:
        return await _refuse(wire, line, "bad_token")
    decision = await inbound.admit(start, service.gate_settings, find_line=service.store.line_find, calls=service.calls, active_calls=live.count() if live is not None else 0, now=inbound.now_utc(),
                                   our_sid=service.our_sid, trial=service.trial, trial_count=service.trial_count, trial_by_url=mark == inbound.TRIAL_MARK)
    if isinstance(decision, gate.Refused):
        return await _refuse(wire, line, decision.reason)
    log.info("exotel_inbound admitted rule=%s", decision.rule)
    tenant = decision.tenant_id
    max_call_s = min(service.max_call_s, decision.max_call_s) if decision.max_call_s else service.max_call_s
    try:
        call_id = await asyncio.to_thread(service.store.begin, tenant, service.language)
    except Exception as exc:  # noqa: BLE001 - no row, no call
        log.warning("exotel_inbound begin_failed %s", exc.__class__.__name__)
        return await _refuse(wire, line, "begin_failed")
    parts, model = (service.parts_for or phone_parts)(bv, service.business, service.language, service.llm_choice)
    plan = CallPlan(call_id=call_id, tenant_id=tenant, direction="inbound", language=service.language, business=service.business, max_call_s=max_call_s,
                    cost_paise_per_minute=service.cost_paise_per_minute)
    if live is not None:
        live.add(tenant, call_id, line)
    began = inbound.monotonic()
    outcome_name: str | None = None
    cost = 0
    try:
        result = await run_call(plan, line, parts, service.store.for_call(tenant), ledger=Ledger(bv.limits), model=model)
        outcome_name, cost = result.outcome or result.state, result.cost_paise
    except Exception as exc:  # noqa: BLE001 - only the class is kept
        log.error("exotel_inbound crashed %s", exc.__class__.__name__)
    finally:
        if live is not None:
            live.remove(call_id)
        service.last_numbers = inbound.call_numbers(call_id, line, inbound.monotonic() - began, cost, outcome_name)
        inbound.log_call(service.last_numbers)
        await _close(wire)
