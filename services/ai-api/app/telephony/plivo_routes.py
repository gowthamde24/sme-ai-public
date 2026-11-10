"""Plivo -> our phone assistant, INBOUND (job 3 phase A, 10 Nov 2026). Four public addresses (Plivo cannot sign in; the fence is Plivo's own request signature and a per-call token):

  POST|GET /v1/telephony/plivo/answer           the Application's Answer URL. Plivo asks it once per call. We check Plivo's V3 signature, look the called number up, decide (the gate), and answer with
                                                <Stream bidirectional="true">wss://.../v1/telephony/plivo/stream/<token></Stream>, or <Hangup/> for a call we do not take.
  WS       /v1/telephony/plivo/stream/{token}   the call itself (8 kHz little-endian PCM both ways), run by the SAME pipeline as an Exotel call (app/telephony/inbound_routes.run_admitted)
  POST|GET /v1/telephony/plivo/outbound-answer  the answer URL of a call WE placed (phase B): signed; the call's row, workspace, language and purpose are in the address; opens the same socket
  POST|GET /v1/telephony/plivo/hangup           the Application's Hangup URL: signed; logged by name and number only (cause, source, duration), no phone number; for a call we placed it also ends a row nobody answered
  POST|GET /v1/telephony/plivo/stream-status    the stream's status callback: signed; logged by event name only

What decides a call, in order (a refusal is a closed word, as for Exotel): the request's signature (403, nothing else is read) -> the line (a row of public.phone_numbers, written by the operator) belongs to PLIVO ->
the inbound gate (mode, the line answers inbound calls, the caller is on the sandbox list while the mode is sandbox, the open lines) -> then, on the socket, the token (signed, 120 s, bound to this call's id).
A refused call is answered with <Hangup/> (200), so the caller hears the line drop at once. Nothing the caller said is logged, and no phone number is: the log carries an 8-character fingerprint of the call id.

The WebSocket handshake carries no signature from Plivo, so the per-call token is the fence there; it lives in the path, expires in 120 s and is minted only after the signed answer request passed. It is derived from the Auth Token
(no second secret to keep). The admission of the answer request (workspace, caller's last digits) is kept in memory for those 120 s; the socket asks for it by call id and, without it, refuses.

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import dataclasses
import hashlib
import json
import logging
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import PlainTextResponse, Response

from app.connectors.phone import normalise, normalise_line
from app.errors import ApiError, not_found
from app.telephony import gate, inbound, plivo, plivo_signature
from app.telephony.inbound_routes import (
    InboundService,
    OutboundCall,
    StarletteWire,
    _close,
    _prepare,
    _service,
    caller_ending,
    run_admitted,
)
from app.telephony.plivo_outbound import LANGUAGES, TEST_GOAL, TEST_OPENING, finish_after_hangup
from app.telephony.wire import PLIVO

log = logging.getLogger("app.telephony.plivo")
router = APIRouter(prefix="/v1/telephony/plivo", tags=["telephony"])
PROVIDER = "plivo"
ADMISSION_TTL_S = 120.0
HANGUP_FIELDS = ("CallStatus", "Event", "HangupCauseName", "HangupCauseCode", "HangupSource", "Duration", "BillDuration", "StartTime", "AnswerTime", "EndTime", "Direction")   # never From / To
XML = "text/xml"


@dataclass
class PlivoConfig:
    """What the Plivo routes need, set by the wiring (app/telephony/wiring.py)."""

    auth_token: str                                                  # the main account's Auth Token (Secret Manager: sme-plivo-auth-token); never logged, never returned
    public_base: str                                                 # the address Plivo calls, https, no path (PUBLIC_BASE_URL)
    token_for: Callable[[dict[str, Any]], str | None] | None = None   # the Auth Token of the account a line sits in (a subaccount's), from the line's row; None: the main account's
    max_stream_s: int = 3600

    def token(self, line: dict[str, Any] | None) -> str:
        """The token that signs requests for this line: its own account's when the line names one, else the main account's."""
        if line is not None and line.get("account_ref") and self.token_for is not None:
            return self.token_for(line) or ""
        return self.auth_token

    def ws_secret(self) -> bytes:
        return hashlib.sha256(b"plivo-ws|" + self.auth_token.encode()).digest()

    def __repr__(self) -> str:
        return "PlivoConfig(<token hidden>)"


@dataclass
class Admission:
    line_no: str          # OUR line (the number that rang, or that we rang from)
    caller: str | None    # the other party (the caller, or the person we called); kept in memory only
    tenant_id: uuid.UUID
    at: float = field(default_factory=time.monotonic)
    outbound: OutboundCall | None = None   # set for a call WE placed (its row already exists)


class AdmissionBook:
    """What the signed answer request decided, kept for the socket (one process; ADMISSION_TTL_S)."""

    def __init__(self) -> None:
        self._items: dict[str, Admission] = {}

    def put(self, call_id: str, item: Admission) -> None:
        now = time.monotonic()
        for key in [k for k, v in self._items.items() if now - v.at > ADMISSION_TTL_S]:
            del self._items[key]
        self._items[call_id] = item

    def take(self, call_id: str) -> Admission | None:
        item = self._items.pop(call_id, None)
        return item if item is not None and time.monotonic() - item.at <= ADMISSION_TTL_S else None


BOOK = AdmissionBook()


def _plivo(app: Any) -> tuple[InboundService, PlivoConfig] | None:
    service = _service(app)
    config = getattr(service, "plivo", None) if service is not None else None
    return (service, config) if service is not None and config is not None else None


async def _params(request: Request) -> dict[str, str]:
    params = {k: str(v) for k, v in request.query_params.items()}
    if request.method == "POST":
        raw = (await request.body())[:65536]
        with suppress(Exception):
            if "json" in request.headers.get("content-type", ""):
                doc = json.loads(raw or b"{}")
                params.update({k: str(v) for k, v in doc.items()} if isinstance(doc, dict) else {})
            else:
                params.update(dict(parse_qsl(raw.decode("utf-8", "replace"), keep_blank_values=True)))
    return params


def _signed(request: Request, params: dict[str, str], config: PlivoConfig, token: str) -> bool:
    """Is this request signed by Plivo with `token`? The URL is rebuilt from our public address (the one Plivo was given), the path and the query."""
    url = config.public_base.rstrip("/") + request.url.path + (f"?{request.url.query}" if request.url.query else "")
    form = {k: v for k, v in params.items() if k not in request.query_params} if request.method == "POST" else None
    return plivo_signature.verify(token, request.method, url, request.headers.get("x-plivo-signature-v3-nonce"), request.headers.get("x-plivo-signature-v3"), form)


def _ws_url(config: PlivoConfig, token: str) -> str:
    base = config.public_base.rstrip("/")
    base = "wss://" + base.split("://", 1)[1] if "://" in base else "wss://" + base
    return f"{base}/v1/telephony/plivo/stream/{token}"


def _fp(config: PlivoConfig, value: str) -> str:
    return inbound.fingerprint(config.ws_secret(), value)


def _refuse(config: PlivoConfig, call_id: str, reason: str) -> Response:
    log.info("plivo_answer refused=%s call_fp=%s", reason, _fp(config, call_id))
    return Response(plivo.hangup_xml(), media_type=XML)


@router.api_route("/answer", methods=["GET", "POST"])
async def answer(request: Request) -> Response:
    """Plivo asks us what to do with a call that rang one of our numbers."""
    got = _plivo(request.app)
    if got is None:
        raise not_found()
    service, config = got
    params = await _params(request)
    call_id = params.get("CallUUID", "")
    line_no = normalise_line(params.get("To", ""))
    caller = normalise(params.get("From", ""))
    found: dict[str, Any] | None = None
    if line_no is not None:
        try:
            found = await inbound.find_line_quick(service.store.line_find, line_no)   # a read only
        except Exception as exc:  # noqa: BLE001 - the answer is the same as for an unknown line
            log.warning("plivo_answer line_lookup_failed %s", exc.__class__.__name__)
    if not _signed(request, params, config, config.token(found)):
        log.warning("plivo_answer refused=bad_signature")
        raise ApiError(403, "unauthorized", "Not authorised.")   # nothing else is read from the request
    if service.gate_settings.mode == "off":
        return _refuse(config, call_id, "telephony_off")
    if line_no is None or not call_id or len(call_id) > 100 or (caller is None and service.gate_settings.mode == "sandbox"):   # a sandbox needs a caller it can compare with the list: no number, no call
        return _refuse(config, call_id, "bad_number")
    if not found or not found.get("tenant_id"):
        return _refuse(config, call_id, "no_such_line")
    if found.get("provider") != PROVIDER:
        return _refuse(config, call_id, "line_not_plivo")
    decision = gate.check_inbound(service.gate_settings, gate.InboundFacts(to_number=line_no, now=inbound.now_utc(), line_known=True, inbound_on=bool(found.get("inbound_on")), hours=None,
                                                                         active_calls_total=0, from_number=caller))
    if isinstance(decision, gate.Refused):
        return _refuse(config, call_id, decision.reason)
    live = getattr(getattr(request.app.state, "runtime", None), "live_calls", None)
    if live is not None and live.count() >= service.gate_settings.max_concurrent:
        return _refuse(config, call_id, "too_many_calls")
    BOOK.put(call_id, Admission(line_no, caller, uuid.UUID(str(found["tenant_id"]))))
    token = inbound.mint(config.ws_secret(), inbound.monotonic(), call_id, "")
    log.info("plivo_answer admitted call_fp=%s", _fp(config, call_id))
    xml = plivo.stream_xml(_ws_url(config, token), plivo.DEFAULT_RATE, status_callback=f"{config.public_base.rstrip('/')}/v1/telephony/plivo/stream-status", max_seconds=config.max_stream_s)
    return Response(xml, media_type=XML)


@router.api_route("/hangup", methods=["GET", "POST"])
async def hangup(request: Request) -> PlainTextResponse:
    got = _plivo(request.app)
    if got is None:
        raise not_found()
    service, config = got
    params = await _params(request)
    line_no = normalise_line(params.get("To", "")) if params.get("Direction", "inbound").lower().startswith("in") else None
    found = None
    if line_no is not None:
        with suppress(Exception):
            found = await asyncio.to_thread(service.store.line_find, line_no)
    if not _signed(request, params, config, config.token(found)):
        raise ApiError(403, "unauthorized", "Not authorised.")
    fields = {k: params[k][:40] for k in HANGUP_FIELDS if k in params}
    log.info("plivo_hangup call_fp=%s %s", _fp(config, params.get("CallUUID", "")), json.dumps(fields, sort_keys=True))
    row, tenant = _uuid(params.get("call")), _uuid(params.get("tenant"))
    if row is not None and tenant is not None and params.get("CallStatus"):   # a call WE placed: if nobody answered (or our side never took it), its row ends here
        ended = await asyncio.to_thread(_finish_unanswered, service, tenant, row, params["CallStatus"])
        if ended:
            log.info("plivo_outbound ended call_fp=%s state=%s", str(row)[:8], ended)
    return PlainTextResponse("ok")


def _finish_unanswered(service: InboundService, tenant: uuid.UUID, row: uuid.UUID, call_status: str) -> str | None:
    outbound_repo = getattr(service, "outbound_repo", None)
    token = getattr(service.store, "scheduler_token", None)
    if outbound_repo is None or token is None:
        return None
    try:
        return finish_after_hangup(outbound_repo, token(), tenant, row, call_status)
    except Exception as exc:  # noqa: BLE001 - only the class is logged; the callback is answered 200 anyway
        log.error("plivo_outbound finish_failed %s", exc.__class__.__name__)
        return None


PURPOSES = ("sales_followup", "payment_reminder", "admission_followup", "visit_reminder", "event_reminder")


def _uuid(value: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(value) if value else None
    except ValueError:
        return None


@router.api_route("/outbound-answer", methods=["GET", "POST"])
async def outbound_answer(request: Request) -> Response:
    """Plivo asks what to do with a call WE placed, now that the callee picked up. The address carries the call's row, the workspace, the language, the purpose and the kind (ids and closed words, no number): Plivo signs
    the whole address, so only a request Plivo made for a call we asked for can pass."""
    got = _plivo(request.app)
    if got is None:
        return PlainTextResponse("off", status_code=404)
    service, config = got
    params = await _params(request)
    call_id = params.get("CallUUID", "")
    line_no = normalise_line(params.get("From", ""))   # on a call we placed, From is OUR line
    callee = normalise(params.get("To", ""))
    found = None
    if line_no is not None:
        with suppress(Exception):
            found = await inbound.find_line_quick(service.store.line_find, line_no)
    if not _signed(request, params, config, config.token(found)):
        log.warning("plivo_outbound_answer refused=bad_signature")
        return PlainTextResponse("bad signature", status_code=403)
    row, tenant = _uuid(params.get("call")), _uuid(params.get("tenant"))
    language, purpose = params.get("lang", ""), params.get("p", "")
    if service.gate_settings.mode == "off":
        return _refuse(config, call_id, "telephony_off")
    if row is None or tenant is None or language not in LANGUAGES or purpose not in PURPOSES or not call_id or len(call_id) > 100 or line_no is None or callee is None:
        return _refuse(config, call_id, "bad_request")
    if not found or str(found.get("tenant_id")) != str(tenant) or found.get("provider") != PROVIDER:
        return _refuse(config, call_id, "no_such_line")
    if service.gate_settings.mode == "sandbox" and callee not in service.gate_settings.sandbox_numbers:
        return _refuse(config, call_id, "not_on_sandbox_list")   # the gate checked this when the call was placed; it is checked again, because the answer is what opens the audio
    live = getattr(getattr(request.app.state, "runtime", None), "live_calls", None)
    if live is not None and live.count() >= service.gate_settings.max_concurrent:
        return _refuse(config, call_id, "too_many_calls")
    kind = params.get("k", "")
    outbound = OutboundCall(row_id=row, language=language, purpose=purpose, goal=TEST_GOAL if kind == "test" else None, opening_line=TEST_OPENING.get(language) if kind == "test" else None)
    BOOK.put(call_id, Admission(line_no, callee, tenant, outbound=outbound))
    token = inbound.mint(config.ws_secret(), inbound.monotonic(), call_id, "")
    log.info("plivo_outbound_answer admitted call_fp=%s", _fp(config, call_id))
    xml = plivo.stream_xml(_ws_url(config, token), plivo.DEFAULT_RATE, status_callback=f"{config.public_base.rstrip('/')}/v1/telephony/plivo/stream-status", max_seconds=config.max_stream_s)
    return Response(xml, media_type=XML)


@router.api_route("/stream-status", methods=["GET", "POST"])
async def stream_status(request: Request) -> PlainTextResponse:
    got = _plivo(request.app)
    if got is None:
        raise not_found()
    _, config = got
    params = await _params(request)
    if not _signed(request, params, config, config.token(None)):
        raise ApiError(403, "unauthorized", "Not authorised.")
    line = {k: params[k][:40] for k in ("Event", "StatusReason", "Duration", "Error") if k in params}
    log.info("plivo_stream_status call_fp=%s %s", _fp(config, params.get("CallUUID", "")), json.dumps(line, sort_keys=True))
    return PlainTextResponse("ok")


@router.websocket("/stream/{token}")
async def stream(ws: WebSocket, token: str) -> None:
    runtime = getattr(ws.app.state, "runtime", None)
    log.info("plivo_stream open")
    await ws.accept()
    await handle(_service(ws.app), getattr(runtime, "browser_voice", None) if runtime is not None else None, getattr(runtime, "live_calls", None) if runtime is not None else None,
                 token, StarletteWire(ws))


async def handle(service: InboundService | None, bv: Any, live: Any, token: str, wire: Any, *, open_timeout: float = 10.0) -> None:
    """One Plivo call, from the token to the last log line. The order of the checks: the token is well formed -> `start` -> the token is signed for THIS call -> the answer request's admission -> the shared pipeline."""
    config = getattr(service, "plivo", None) if service is not None else None
    if service is None or config is None or bv is None or not inbound.fresh(token, inbound.monotonic()):
        log.info("plivo_inbound refused=%s", "off" if service is None or config is None or bv is None else "bad_token")
        return await _close(wire)
    line = inbound.TimedLine(wire, proto=PLIVO)
    start = await line.open(open_timeout)
    if start is None:
        log.info("plivo_inbound refused=no_start")
        return await _close(wire)
    if start.encoding != plivo.ENCODING_L16:
        log.info("plivo_inbound refused=unsupported_encoding")
        return await _refuse_socket(wire, line, "bad_number")
    log.info("plivo_stream start call_fp=%s stream_fp=%s rate=%d", _fp(config, start.call_sid), _fp(config, start.stream_sid), start.sample_rate)
    began = inbound.monotonic()
    if inbound.verify_mark(config.ws_secret(), token, inbound.monotonic(), start.call_sid) is None:
        return await _refuse_socket(wire, line, "bad_token")
    admission = BOOK.take(start.call_sid)
    if admission is None:   # the answer request was seen by another server, or too long ago: nothing is guessed
        return await _refuse_socket(wire, line, "no_admission")
    if live is not None and live.count() >= service.gate_settings.max_concurrent:
        return await _refuse_socket(wire, line, "too_many_calls")
    full = dataclasses.replace(start, from_number=admission.caller or "", to_number=admission.line_no)   # Plivo's start has no numbers; the signed answer request had them (kept in memory only)
    decision = inbound.Admitted(tenant_id=admission.tenant_id, talk=True, rule="plivo_signed_answer" if admission.outbound is None else "plivo_outbound_answer")
    preparing = asyncio.ensure_future(_prepare(service, bv, full, admission.outbound))
    line.admitted_ms = round((inbound.monotonic() - began) * 1000)
    log.info("plivo_%s admitted rule=%s", "inbound" if admission.outbound is None else "outbound", decision.rule)
    await run_admitted(service, bv, live, wire, line, full, decision, preparing, provider=PROVIDER, outbound=admission.outbound)


async def _refuse_socket(wire: Any, line: Any, reason: str) -> None:
    log.info("plivo_inbound refused=%s", reason)
    with suppress(Exception):
        await line.hang_up("stopped")
    await _close(wire)


__all__ = ["router", "handle", "PlivoConfig", "BOOK", "caller_ending"]
