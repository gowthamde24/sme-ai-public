"""Exotel's Voicebot applet -> our phone assistant, INBOUND only (app/telephony/inbound.py has the rules). Two public addresses (no sign-in: Exotel cannot sign in; the token and Exotel's own confirmation are the
fence):

  GET|POST /v1/telephony/exotel/stream-url   -> 200 {"url": "wss://.../v1/telephony/exotel/stream?sample-rate=8000&t=<token>"}; 403 {"error": ...} while inbound is off or the caller is not on the sandbox list
  WS       /v1/telephony/exotel/stream?t=...  the call itself

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import logging
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import timedelta, timezone
from typing import Any

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from starlette.websockets import WebSocketDisconnect

from app.browser_voice.audio import OUT_RATE
from app.browser_voice.limits import Ledger
from app.browser_voice.routes import OWNER_SILENCE_MS, stt_mode_for
from app.browser_voice.runtime import BrowserVoice
from app.browser_voice.session import Parts
from app.connectors.phone import normalise, normalise_line
from app.conversation.fallback import FallbackTts
from app.conversation.pronounce import default_pronunciations
from app.conversation.providers import (
    REPLY_MAX_TOKENS,
    AnthropicStream,
    SarvamChatStream,
    SarvamRealtimeStt,
)
from app.errors import ApiError
from app.telephony import exotel, gate, inbound, persona
from app.telephony.call_session import CallPlan, run_call
from app.telephony.greeting_audio import GREETINGS
from app.telephony.inbound_store import InboundStore
from app.telephony.opening_store import OpeningStore, opening_path
from app.voice.budget import PER_CALL, Hold, VoiceBudget

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
    call_summaries: bool = False   # the short summary, outcome and name after each call (owner, 7 Nov 2026): on in the real wiring; off in tests, so no test ever asks a real model
    english_lines: bool = False   # the English line under each non-English caption (owner, 7 Nov 2026): on in the real wiring; off in tests, so no test ever asks a real model
    url_format: str = "json"   # EXOTEL_STREAM_URL_FORMAT: json ({"url": ...}, the documented form) | text (the bare wss address)
    parts_for: Callable[[Any, str, str, str], tuple[Parts, str]] | None = None   # tests: fake recogniser, voice and model
    last_numbers: dict[str, Any] | None = None   # the numbers of the last call (the log line's), for the sandbox report
    our_sid: str | None = None   # EXOTEL_SID: the start message's account_sid is compared with it (yes / no in the log, never the value)
    trial: inbound.TrialRule | None = None   # the shared trial number's rule (sandbox only; app/telephony/inbound.py TrialRule)
    trial_count: inbound.DayCount = field(default_factory=inbound.DayCount)
    budget: VoiceBudget | None = None   # our cap on Cartesia (app/voice/budget.py); None only where no database is wired (tests that do not test it)
    opening_store: OpeningStore | None = None   # the opening kept across restarts (Supabase Storage, `call-openings`); None: memory only
    outbound: Any = None   # app/telephony/plivo_outbound.PlivoOutbound: places a call (phase B); None: this deployment places none
    outbound_repo: Any = None   # app/telephony/plivo_outbound.PostgrestOutboundRepo: ends a placed call nobody answered (phase B)
    plivo: Any = None   # app/telephony/plivo_routes.PlivoConfig when Plivo calls are switched on here; None: the Plivo addresses answer "off"



@dataclass(frozen=True)
class OutboundCall:
    """What makes a call OUTBOUND (job 3 phase B): its row already exists (it was begun when the call was placed), the words of its purpose, and the opening the business chose. Everything else is the same pipeline."""

    row_id: uuid.UUID
    language: str
    purpose: str                    # one of the gate's purposes (visit_reminder, payment_reminder, ...)
    goal: str | None = None         # the sentence the assistant is given as the goal of the call (None: the purpose's own)
    opening_line: str | None = None # the opening with placeholders ({assistant} {business}), or None: the standard outbound opening

class StarletteWire:
    """Exotel's WebSocket as the phone line's wire (text frames)."""

    def __init__(self, ws: WebSocket) -> None:
        self._ws = ws
        self.close_code: int | None = None   # the WebSocket close code when the provider closed it (for the end-of-call log)
        self.close_reason: str | None = None   # the text of the provider's close frame as a closed word (never free text); None when it sent none (code 1005)
        self.opened = time.monotonic()   # when the stream was opened: Exotel counts the call from here, our own duration from admission

    async def send_text(self, data: str) -> None:
        await self._ws.send_text(data)

    async def receive_text(self) -> str | None:
        try:
            message = await self._ws.receive()
        except (WebSocketDisconnect, RuntimeError):
            return None
        if message.get("type") == "websocket.disconnect":
            code = message.get("code")
            self.close_code = code if isinstance(code, int) else None
            self.close_reason = exotel.closed_word(message.get("reason") if isinstance(message.get("reason"), str) else None)
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
    flow_ms = inbound.exotel_flow_ms(params.get("Created"), params.get("CurrentTime"))
    log.info("exotel_flow_timing flow_ms=%s", "unknown" if flow_ms is None else flow_ms)   # Exotel's own time from the call's start to asking us (its connect and its flow)
    if service is None or service.gate_settings.mode == "off" or not service.secret:   # (no Exotel secret: this deployment answers Plivo only)
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
    to_trial = service.trial is not None and normalise_line(inbound.first(params, "To", "to")) == service.trial.number
    log.info("exotel_stream_url to_is_trial=%s callto_is_trial=%s", "yes" if to_trial else "no",
             "yes" if service.trial is not None and normalise_line(params.get("CallTo", "")) == service.trial.number else "no")
    token = inbound.mint(service.secret, inbound.monotonic(), call_sid, inbound.TRIAL_MARK if to_trial else "")
    url = inbound.stream_url(service.public_base, token)
    log.info("exotel_stream_url issued format=%s token_in=path url_chars=%d", service.url_format, len(url))
    if service.url_format == "text":
        return PlainTextResponse(url)
    return JSONResponse({"url": url})


def visit_label(slot: dict[str, Any]) -> str:
    """A slot as the assistant says it: "Tue 3 Nov 10:00" (India time)."""
    from datetime import date

    try:
        day = date.fromisoformat(str(slot.get("date")))
        return f"{day.strftime('%a')} {day.day} {day.strftime('%b')} {slot.get('start')}"
    except ValueError:
        return str(slot.get("start") or "")


def phone_parts(bv: BrowserVoice, business: str, language: str, llm_choice: str, training: dict[str, Any] | None = None, visit_labels: tuple[str, ...] = (), assistant: str | None = None,
                corrections: tuple[str, ...] = (), outbound: OutboundCall | None = None) -> tuple[Parts, str]:
    """The Live-talk parts for a phone caller: the recogniser in the CALL's language (te-IN on a Telugu line; owner, 6 Nov 2026: "auto" let a caller's "hello" turn a Telugu call English),
    following the call when it switches (app/telephony/language_rule.py), the workspace's default voices, the phone model (Haiku unless TELEPHONY_LLM=sarvam),
    the phone persona's system prompt (approved facts only: none yet for an inbound sandbox call, so it answers what it can and offers to pass on the rest) and the inbound opening line, which says it is an AI."""
    if llm_choice == "sarvam":
        llm: Any = SarvamChatStream(bv.sarvam_key, max_tokens=REPLY_MAX_TOKENS, client=bv.client)
        model = "sarvam-105b"
    else:
        llm, model = AnthropicStream(bv.anthropic_key or "", max_tokens=REPLY_MAX_TOKENS, client=bv.client), bv.fast_model
    from app.talk_training.guard import GuardedTts
    from app.talk_training.prompt import greeting as trained_greeting

    def opening_for(lang: str) -> str:
        if outbound is not None:   # we rang them: no \"you rang us\" greeting; the owner's opening (or the standard one) that still says it is an AI
            return persona.opening_line(lang, business=business, assistant=assistant, customer=None, owner_line=outbound.opening_line, inbound=False)
        return persona.opening_line(lang, business=business, assistant=assistant, customer=None, inbound=True, greeting=trained_greeting(training, lang))

    # the never-say list is a HARD rule: every sentence is checked by code before the voice speaks it
    tts: Any = GuardedTts(FallbackTts(bv.config, bv.factory, chosen={}, gender="female", pronunciations=default_pronunciations()), (training or {}).get("never_say") or [])
    parts = Parts(
        stt_for=lambda lang: SarvamRealtimeStt(bv.sarvam_key, language=lang, silence_ms=OWNER_SILENCE_MS, mode=stt_mode_for(lang, bv.stt_modes)),
        tts=tts,
        llm=llm,
        system_for=lambda lang: persona.system_prompt(business=business, assistant=assistant or persona.DEFAULT_ASSISTANT, language=lang, purpose=outbound.purpose if outbound else "inbound", goal=outbound.goal if outbound else None, facts=[], customer_first_name=None, training=training, visit_slots=visit_labels,
                                                      corrections=corrections, opening=opening_for(lang)),
        greeting_for=opening_for,
        models={"fast": model, "strong": model},
        voice_for=lambda lang: bv.config.resolve(lang, None, "female").id,
        voice_name=lambda lang: bv.config.resolve(lang, None, "female").name,
        fillers=bv.fillers,
    )
    return parts, model


@dataclass
class Prepared:
    tenant_id: uuid.UUID | None
    parts: Any
    model: str
    slots: list[dict[str, Any]]
    text: str | None = None
    rendering: "asyncio.Future[bytes | None] | None" = None


async def _prepare(service: InboundService, bv: Any, start: Any, outbound: OutboundCall | None = None) -> Prepared | None:
    """While the call is checked: which workspace the line is (a read), its training and visit slots (reads), the voice, and the greeting's rendering started. Never writes, never sends audio."""
    line_no = normalise_line(start.to_number)
    if line_no is None:
        return None
    found = await inbound.find_line_quick(service.store.line_find, line_no)
    if not found or not found.get("tenant_id"):
        return None
    return await _prepare_for(service, bv, uuid.UUID(str(found["tenant_id"])), business=found.get("business"), assistant=found.get("assistant"), outbound=outbound)


async def _prepare_for(service: InboundService, bv: Any, tenant: uuid.UUID, *, business: str | None = None, assistant: str | None = None, outbound: OutboundCall | None = None) -> Prepared:
    """`business` and `assistant` are the workspace's own names (the line lookup; owner, 6 Nov 2026); without them the deployment's TELEPHONY_INBOUND_BUSINESS and the default assistant name."""
    language = outbound.language if outbound else service.language
    business = (business or "").strip() or service.business
    assistant = (assistant or "").strip() or None
    async def read(name: str, default: Any) -> Any:
        fn = getattr(service.store, name, None)
        if fn is None:
            return default
        try:
            return await asyncio.to_thread(fn, tenant)
        except Exception as exc:  # noqa: BLE001 - a call without the training or the slots still follows every platform rule
            log.warning("exotel_inbound %s_unreadable %s", name, exc.__class__.__name__)
            return default

    training, slots, corrections = await asyncio.gather(read("talk_training", None), read("visit_slots", []), read("call_corrections", []))
    slots = list(slots or [])
    labels = tuple(visit_label(sl) for sl in slots)
    if service.parts_for is None:
        parts, model = phone_parts(bv, business, language, service.llm_choice, training, labels, assistant=assistant, corrections=tuple(corrections or ()), **({"outbound": outbound} if outbound is not None else {}))
    else:
        parts, model = service.parts_for(bv, business, language, service.llm_choice)
    text = parts.greeting_for(language)
    rendering: asyncio.Future[bytes | None] | None = None   # never rendered ahead (no credits spent outside a real call): the greeting this call speaks is kept for the next one
    parts.greeting_audio = GREETINGS.get
    parts.greeting_keep = GREETINGS.keep
    store = service.opening_store
    if text and store is not None:
        # the opening kept ready across restarts (owner, 6 Nov 2026; app/telephony/opening_store.py): read while the call is admitted (a read only), stored when a call has just spoken it
        voice_for = getattr(parts, "voice_for", None)
        voice = str(voice_for(language)) if callable(voice_for) else ""
        path = opening_path(tenant, language, voice, text)
        if GREETINGS.get(language, text) is None:
            try:
                pcm = await asyncio.wait_for(asyncio.to_thread(store.get, path), OPENING_READ_S)
            except Exception:  # noqa: BLE001 - not ready in time: the opening is streamed
                pcm = None
            if pcm:
                GREETINGS.keep(language, text, pcm, rate=OUT_RATE, engine="cartesia")

        def keep_and_store(language: str, said: str, pcm: bytes, *, rate: int, engine: str = "") -> bool:
            kept = GREETINGS.keep(language, said, pcm, rate=rate, engine=engine)
            if kept and language == language and said == text:
                asyncio.ensure_future(asyncio.to_thread(store.put, path, pcm))   # after the call spoke it: never before admission
            return kept

        parts.greeting_keep = keep_and_store
    return Prepared(tenant_id=tenant, parts=parts, model=model, slots=slots, text=text, rendering=rendering)


def assistant_of(info: dict[str, Any] | None) -> str | None:
    """The name the workspace gave its assistant (the line lookup carries it); None when it has none, then the call says "Priya"."""
    name = str((info or {}).get("assistant") or "").strip()
    return name[:40] or None


def caller_ending(number: str | None) -> str | None:
    """The last three digits of the caller's number: all the Calls list ever shows of it."""
    digits = "".join(c for c in str(number or "") if c.isdigit())
    return digits[-3:] if len(digits) >= 6 else None


def text_model(bv: Any, *, max_tokens: int) -> tuple[Any, str]:
    """A short text request after or beside a call (the record of the call, an English line), on the fast model. (None, "") when no key is set."""
    from app.conversation.providers import AnthropicStream, SarvamChatStream

    if getattr(bv, "turn_model", "") == "sarvam" and getattr(bv, "sarvam_key", ""):
        return SarvamChatStream(bv.sarvam_key, max_tokens=max_tokens, client=bv.client), "sarvam-105b"
    if not getattr(bv, "anthropic_key", ""):
        return None, ""
    return AnthropicStream(bv.anthropic_key, max_tokens=max_tokens, client=bv.client), bv.fast_model


def english_lines(bv: Any) -> Any:
    """The English line under each non-English caption (owner, 7 Nov 2026), by the fast model; None when no model key is set. (No temperature setting: this model refuses one, "`temperature` is deprecated for this model", so the strict prompt and clean_translation do that job.)"""
    from app.telephony.translate import LineTranslator

    llm, model = text_model(bv, max_tokens=400)
    return LineTranslator(llm, model) if llm is not None else None


GRACE_S = 0.25
OPENING_READ_S = 0.6


async def _greeting_ready(prepared: Prepared, language: str) -> bool:
    """After admission: is the greeting already in memory? A rendering still under way gets a short grace; past it the line speaks the greeting the usual way (streamed)."""
    if not prepared.text:
        return False
    if prepared.rendering is not None and not prepared.rendering.done():
        with suppress(Exception):
            await asyncio.wait_for(asyncio.shield(prepared.rendering), GRACE_S)
    return GREETINGS.get(language, prepared.text) is not None


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
    if service is None or bv is None or not service.secret or not inbound.fresh(token, inbound.monotonic()):
        log.info("exotel_inbound refused=%s", "off" if service is None or bv is None or not service.secret else "bad_token")
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
    # owner, 6 Nov 2026: the first sound within 1.5 s of pickup. Admission (our line and Exotel's own record, read together) and the PREPARATION of the call (the workspace's training and visit
    # slots, the voice, the greeting rendered into memory) run AT THE SAME TIME. Nothing is written and no audio is sent before the call is admitted.
    began_check = inbound.monotonic()
    admitting = asyncio.ensure_future(inbound.admit(start, service.gate_settings, find_line=service.store.line_find, calls=service.calls, active_calls=live.count() if live is not None else 0,
                                                    now=inbound.now_utc(), our_sid=service.our_sid, trial=service.trial, trial_count=service.trial_count, trial_by_url=mark == inbound.TRIAL_MARK))
    preparing = asyncio.ensure_future(_prepare(service, bv, start))
    decision = await admitting
    if isinstance(decision, gate.Refused):
        preparing.cancel()
        return await _refuse(wire, line, decision.reason)
    line.admitted_ms = round((inbound.monotonic() - began_check) * 1000)
    await run_admitted(service, bv, live, wire, line, start, decision, preparing, provider="exotel")


async def run_admitted(service: InboundService, bv: Any, live: Any, wire: Any, line: Any, start: Any, decision: Any, preparing: "asyncio.Future[Prepared | None]", *, provider: str, outbound: OutboundCall | None = None) -> None:
    """Everything after a call is ADMITTED, for any provider: the voice allowance, the preparation (workspace, training, voice, greeting), the call's row, the call session, and the one line of numbers at the end.
    `provider` is the word the call's row carries (exotel | plivo | vobiz)."""
    if service.english_lines:
        line.translator = english_lines(bv)
    log.info("exotel_inbound admitted rule=%s", decision.rule)
    language = outbound.language if outbound else service.language
    tenant = decision.tenant_id
    # our cap on Cartesia (app/voice/budget.py): the call's allowance is reserved now, AFTER admission (a refused call writes nothing), while the call is being set up and the greeting starts
    budget = service.budget
    reserving: asyncio.Future[Hold] | None = asyncio.ensure_future(asyncio.to_thread(budget.reserve, PER_CALL, "call")) if budget is not None else None
    max_call_s = min(service.max_call_s, decision.max_call_s) if decision.max_call_s else service.max_call_s
    try:
        prepared = await preparing
    except Exception as exc:  # noqa: BLE001 - prepared the slow way below
        log.warning("phone_inbound prepare_failed %s", exc.__class__.__name__)
        prepared = None
    if prepared is None or prepared.tenant_id != tenant:
        again = await _prepare(service, bv, start, outbound)   # the workspace's names come with the line
        prepared = again if again is not None and again.tenant_id == tenant else await _prepare_for(service, bv, tenant, outbound=outbound)
    parts, model, slots = prepared.parts, prepared.model, prepared.slots
    if reserving is not None:
        held = reserving

        async def allowance() -> int:
            return (await held).granted

        set_budget = getattr(parts.tts, "set_primary_budget", None)
        if set_budget is not None:
            set_budget(asyncio.ensure_future(allowance()))
    line.greeting_ready = await _greeting_ready(prepared, language)
    # the call's row is written while the greeting already plays (no row, no call: run_call ends the call if it cannot be written)
    if outbound is not None:   # the row was begun when the call was placed: it only moves from ringing to in progress
        begin_row = asyncio.get_running_loop().create_future()
        begin_row.set_result(outbound.row_id)
    else:
        begin_row = asyncio.ensure_future(asyncio.to_thread(service.store.begin, tenant, language, provider))
    call_id = uuid.uuid4()   # replaced by the row's id for the database; only names this call in memory until then
    number = normalise_line(start.to_number)
    info: dict[str, Any] | None = None
    if number is not None:
        with suppress(Exception):
            info = await asyncio.to_thread(service.store.line_find, number)   # remembered from admission: no new wait
    plan = CallPlan(call_id=call_id, tenant_id=tenant, direction="outbound" if outbound else "inbound", language=language, business=service.business, max_call_s=max_call_s,
                    cost_paise_per_minute=service.cost_paise_per_minute, visit_slots=tuple(str(sl.get("starts_at")) for sl in slots if sl.get("starts_at")),
                    caller_ending=caller_ending(start.from_number), assistant_name=assistant_of(info), line_id=str(info.get("line_id")) if info and info.get("line_id") else None)
    if live is not None:
        live.add(tenant, call_id, line)
        registry, temp_id = live, call_id

        def known(fut: asyncio.Future[uuid.UUID]) -> None:   # (6 Nov 2026: since the row is written in the background, the live call was reachable only by a temporary id)
            if not fut.cancelled() and fut.exception() is None:
                registry.also_known_as(temp_id, fut.result())

        begin_row.add_done_callback(known)
    began = inbound.monotonic()
    outcome_name: str | None = None
    cost = 0
    try:
        summary_llm, summary_model = text_model(bv, max_tokens=500) if service.call_summaries else (None, model)
        result = await run_call(plan, line, parts, service.store.for_call(tenant), ledger=Ledger(bv.limits), model=summary_model, call_id_ready=begin_row, outcome_llm=summary_llm,
                                today=lambda: inbound.now_utc().astimezone(timezone(timedelta(hours=5, minutes=30))).date().isoformat())
        outcome_name, cost = result.outcome or result.state, result.cost_paise
    except Exception as exc:  # noqa: BLE001 - only the class is kept
        log.error("phone_inbound crashed %s", exc.__class__.__name__)
    finally:
        if live is not None:
            live.remove(call_id)
        if begin_row.done() and not begin_row.cancelled() and begin_row.exception() is None:
            call_id = begin_row.result()
            if live is not None:
                live.remove(call_id)
        if reserving is not None and budget is not None:   # what the call did not use goes back to the day
            with suppress(Exception):
                hold = await reserving
                used = int(getattr(parts.tts, "primary_chars", 0) or 0)
                back = await asyncio.to_thread(budget.release, hold, used)
                line.voice_budget = {"granted": hold.granted, "used": used, "day_used": (back or {}).get("day_used", hold.day_used), "day_limit": hold.day_limit}
        service.last_numbers = inbound.call_numbers(call_id, line, inbound.monotonic() - began, cost, outcome_name)
        inbound.log_call(service.last_numbers)
        await _close(wire)
