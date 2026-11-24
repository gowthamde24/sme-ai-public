# ruff: noqa: E501
"""The VoiceLink WebSocket-bot route (24 Nov 2026; docs/contracts/ and reports/voicelink-adapter-notes.md). VoiceLink connects to the bot's `websocket_url` when a call reaches one of our DIDs; the line then speaks base64 A-law (app/telephony/voicelink.py).

What decides a call, in order (a refusal is a closed word, as for Exotel and Plivo): the address token in the path (a secret of ours that sits only in the bot's URL: VoiceLink signs nothing) -> `start` (a codec we read) -> telephony not off -> the DID VoiceLink says it dialled is
one of OUR lines and a VoiceLink one (a row of public.phone_numbers, provider voicelink, written by the operator) -> sandbox: the caller is on the list -> the gate says yes (hours, concurrency) -> the shared pipeline (`run_admitted`, provider `voicelink`).

Off by default: the route answers nothing unless VOICELINK_WS_TOKEN is set (at least 32 characters, in Secret Manager). A call VoiceLink places for us (`add_lead`, from the task dialer through `PlivoOutbound` + `VoicelinkCaller`) opens the same socket with our row id in `custom_parameters`: it is admitted only if that row is a VoiceLink call of ours that
is still waiting. VoiceLink also posts call events (call.initiated / answered / ended / completed) to `/webhook/{token}`: an outbound call nobody picked up is closed from there. UNVERIFIED until the first real call: the shape of the
events (from VoiceLink's public documentation), whether our marks come back as `mark`, `transfer`, and which of `from` / `to` the start of a call we placed carries."""

from __future__ import annotations

import asyncio
import dataclasses
import hmac
import json
import logging
import uuid
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse

from app.connectors.phone import normalise, normalise_line
from app.errors import not_found
from app.telephony import gate, inbound, voicelink
from app.telephony.inbound_routes import (
    InboundService,
    OutboundCall,
    StarletteWire,
    _close,
    _prepare,
    _service,
    run_admitted,
)
from app.telephony.plivo_outbound import (
    LANGUAGES,
    PENDING,
    TEST_GOAL,
    finish_after_hangup,
    frame_goal,
    opening_for,
)
from app.telephony.wire import VOICELINK

log = logging.getLogger("app.telephony.voicelink")
router = APIRouter(prefix="/v1/telephony/voicelink", tags=["telephony"])
PROVIDER = "voicelink"
MIN_TOKEN = 32
PURPOSES = ("sales_followup", "payment_reminder", "admission_followup", "visit_reminder", "event_reminder")
MAX_WEBHOOK_BYTES = 64_000


@dataclass(frozen=True)
class VoicelinkConfig:
    ws_token: str   # the secret address token of our WebSocket bot (VOICELINK_WS_TOKEN)
    public_base: str = ""   # PUBLIC_BASE_URL: the address VoiceLink is told in the dynamic inbound-call answer

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
    began = inbound.monotonic()
    if start.custom.get("call") or start.custom.get("tenant"):   # a call WE placed (add_lead)
        return await _outbound(service, bv, live, wire, line, start, began)
    decision = await admit(start, service.gate_settings, find_line=service.store.line_find, active_calls=live.count() if live is not None else 0, now=inbound.now_utc())
    if isinstance(decision, gate.Refused):
        return await _refuse(wire, line, decision.reason)
    preparing = asyncio.ensure_future(_prepare(service, bv, start))
    line.admitted_ms = round((inbound.monotonic() - began) * 1000)
    await run_admitted(service, bv, live, wire, line, start, decision, preparing, provider=PROVIDER)


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def _outbound(service: InboundService, bv: Any, live: Any, wire: Any, line: Any, start: Any, began: float) -> None:
    """A call WE placed: VoiceLink dialled the person and, now that they answered, opened our bot. Admitted only when its row is a VoiceLink call of ours that is still waiting (a replay or a stranger has no such row), the
    workspace's VoiceLink line is one of the two numbers of the call, and the sandbox/concurrency rules of the gate hold again (the gate decided when the call was placed; the answer is what opens the audio)."""
    custom = start.custom
    row, tenant = _uuid(custom.get("call")), _uuid(custom.get("tenant"))
    language, purpose, kind = custom.get("lang", ""), custom.get("p", ""), custom.get("k", "")
    if service.gate_settings.mode == "off":
        return await _refuse(wire, line, "telephony_off")
    if row is None or tenant is None or language not in LANGUAGES or purpose not in PURPOSES or kind not in ("test", "goal", "task"):
        return await _refuse(wire, line, "bad_request")
    ours = None
    callee = None
    for mine, other in ((start.to_number, start.from_number), (start.from_number, start.to_number)):   # which of the two numbers is OUR line is not documented: the one that is a VoiceLink line of THIS workspace
        line_no = normalise_line(mine)
        if line_no is None:
            continue
        with suppress(Exception):
            found = await inbound.find_line_quick(service.store.line_find, line_no)
            if found and found.get("provider") == PROVIDER and str(found.get("tenant_id")) == str(tenant):
                ours, callee = line_no, normalise(other)
                break
    if ours is None or callee is None:
        return await _refuse(wire, line, "no_such_line")
    if service.gate_settings.mode == "sandbox" and callee not in service.gate_settings.sandbox_numbers:
        return await _refuse(wire, line, "not_on_sandbox_list")
    repo, token = getattr(service, "outbound_repo", None), getattr(service.store, "scheduler_token", None)
    state = None
    if repo is not None and token is not None:
        with suppress(Exception):
            state = await asyncio.to_thread(repo.state, token(), tenant, row)
    if state is None or state.get("direction") != "outbound" or state.get("provider") != PROVIDER or state.get("state") not in ("queued", "ringing"):
        return await _refuse(wire, line, "no_admission")
    if live is not None and live.count() >= service.gate_settings.max_concurrent:
        return await _refuse(wire, line, "too_many_calls")
    typed = PENDING.take(row) if kind in ("goal", "task") else None
    if kind == "goal" and typed is None:
        return await _refuse(wire, line, "goal_missing")   # a call that is meant to carry the owner's goal never runs without it
    goal = TEST_GOAL if kind == "test" else frame_goal(typed) if typed else None
    questions = PENDING.take_questions(row) if kind in ("goal", "task") else ()
    tone, owner_test, intro = PENDING.take_extras(row) if kind in ("goal", "task") else ("friendly", False, None)
    person = PENDING.take_person(row) if kind in ("goal", "task") else (None, None)
    job = PENDING.take_job(row) if kind in ("goal", "task") else None
    outbound = OutboundCall(row_id=row, language=language, purpose=purpose, goal=goal, opening_line=opening_for(kind, language, tone), kind=kind, tone=tone, owner_test=owner_test, introduce=intro, person_name=person[0], person_gender=person[1], questions=questions, job=job)
    full = dataclasses.replace(start, from_number=callee, to_number=ours)   # the pipeline reads the call as "the person -> our line", like every other provider
    decision = inbound.Admitted(tenant_id=tenant, talk=True, rule="voicelink_outbound")
    preparing = asyncio.ensure_future(_prepare(service, bv, full, outbound))
    line.admitted_ms = round((inbound.monotonic() - began) * 1000)
    log.info("voicelink_outbound admitted call_fp=%s", str(row)[:8])
    await run_admitted(service, bv, live, wire, line, full, decision, preparing, provider=PROVIDER, outbound=outbound)


def _custom(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        with suppress(ValueError):
            value = json.loads(value)
    return value if isinstance(value, dict) else {}


def _status_word(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-").replace(" ", "-")[:30]


def _finish_unanswered(service: InboundService, tenant: uuid.UUID, row: uuid.UUID, call_status: str) -> str | None:
    repo, token = getattr(service, "outbound_repo", None), getattr(service.store, "scheduler_token", None)
    if repo is None or token is None:
        return None
    try:
        return finish_after_hangup(repo, token(), tenant, row, call_status)
    except Exception as exc:  # noqa: BLE001 - only the class is logged; VoiceLink is answered 200 anyway
        log.error("voicelink_outbound finish_failed %s", exc.__class__.__name__)
        return None


def _mark_ringing(service: InboundService, tenant: uuid.UUID, row: uuid.UUID, provider_call_id: str) -> None:
    repo, token = getattr(service, "outbound_repo", None), getattr(service.store, "scheduler_token", None)
    if repo is None or token is None or not provider_call_id:
        return
    try:
        state = repo.state(token(), tenant, row)
        if state is not None and state.get("state") in ("queued", "ringing"):
            repo.ringing(token(), tenant, row, provider_call_id[:100])
    except Exception as exc:  # noqa: BLE001
        log.error("voicelink_outbound ringing_failed %s", exc.__class__.__name__)


@router.post("/webhook/{token}")
async def webhook(request: Request, token: str) -> JSONResponse:
    """VoiceLink's call events (call.initiated / answered / ended / completed; they sign nothing, so the secret token in the address is the credential). A call WE placed carries our row in `customParameters`:
    `initiated` records VoiceLink's call id on it, `ended` closes it when nobody answered or our socket never took it. An answered call is finished by its own call session, never from here."""
    service = _service(request.app)
    config = getattr(service, "voicelink", None) if service is not None else None
    if service is None or config is None or not config.accepts(token):
        raise not_found()
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BYTES:
        return JSONResponse({"ok": False}, status_code=413)
    try:
        body = json.loads(raw)
    except ValueError:
        return JSONResponse({"ok": False}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"ok": False}, status_code=400)
    event = str(body.get("event") or "")[:30]
    call_id = str(body.get("callId") or "")[:100]
    custom = _custom(body.get("customParameters"))
    row, tenant = _uuid(custom.get("call")), _uuid(custom.get("tenant"))
    status = _status_word(body.get("callStatus"))
    key = config.fingerprint_key()
    log.info("voicelink_webhook event=%s call_fp=%s direction=%s status=%s duration=%s ours=%s", event, inbound.fingerprint(key, call_id), str(body.get("direction") or "")[:10], status, str(body.get("duration") or "")[:8], row is not None)
    if row is not None and tenant is not None:
        if event == "call.initiated":
            await asyncio.to_thread(_mark_ringing, service, tenant, row, call_id)
        elif event == "call.ended":
            ended = await asyncio.to_thread(_finish_unanswered, service, tenant, row, status)
            if ended:
                log.info("voicelink_outbound ended call_fp=%s state=%s", str(row)[:8], ended)
    return JSONResponse({"ok": True})


@router.post("/inbound_call/{token}")
async def inbound_call(request: Request, token: str) -> JSONResponse:
    """VoiceLink's DYNAMIC inbound routing (their "Dynamic WebSocket & Webhook for Incoming Call"): asked once per call, we answer where to stream and where to report. The static bot address works without this;
    this is for a number that VoiceLink is told to ask us. The answer is the same two addresses, both carrying the secret token."""
    service = _service(request.app)
    config = getattr(service, "voicelink", None) if service is not None else None
    if service is None or config is None or not config.accepts(token) or not config.public_base:
        raise not_found()
    try:
        body = json.loads(await request.body())
    except ValueError:
        body = {}
    call_id = str(body.get("callId") or "")[:100] if isinstance(body, dict) else ""
    base = config.public_base.rstrip("/")
    ws_base = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    log.info("voicelink_inbound_call call_fp=%s", inbound.fingerprint(config.fingerprint_key(), call_id))
    return JSONResponse({"ws_url": f"{ws_base}/v1/telephony/voicelink/ws/{token}?call_id={call_id}", "webhook_url": f"{base}/v1/telephony/voicelink/webhook/{token}"})


async def _refuse(wire: Any, line: Any, reason: str) -> None:
    log.info("voicelink_inbound refused=%s", reason)
    with suppress(Exception):
        await line.hang_up("stopped")
    await _close(wire)


__all__ = ["router", "handle", "admit", "VoicelinkConfig"]
