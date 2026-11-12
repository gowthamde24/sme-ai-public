"""The Calls page under /v1/tenants/{tenant_id}/calls (job phone-calls part 6). The contract is docs/contracts/calls.md.

  GET  /calls?state=live|finished|all&limit&cursor   Owner, Admin, Sales: live calls first, then finished, newest first; poll every `poll_after_s`
  GET  /calls/{id}                                    the call; the transcript (turn by turn) for Owner and Admin only
  POST /calls/{id}/hang-up                            Owner, Admin: end a live call

Sandbox calls say `sandbox: true`; no audio is ever kept (`recorded` is always false). The transcript and the summary are never logged.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import asyncio
import logging
import time
import uuid
from contextlib import suppress
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response, WebSocket
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.talk_training import introduce
from app.talk_training.routes import training_for
from app.telephony.models import (
    CallDetailOut,
    CallsOut,
    CorrectionIn,
    CorrectionOut,
    PlaceIn,
    PlaceOut,
    TakeOverSettingIn,
    TakeOverSettingOut,
    TestNumbersOut,
    TurnOut,
)
from app.telephony.plivo_api import PlivoError
from app.telephony.plivo_outbound import OutboundRefused
from app.telephony.repository import CallStateError
from app.telephony.service import CallsService
from app.telephony.tone import tone_keyword
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/calls", tags=["calls"])
log = logging.getLogger("app.telephony.routes")
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


def _service(runtime: Runtime) -> CallsService:
    if runtime.calls is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    return runtime.calls


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _audit_event(runtime: Runtime, ctx: TenantContext, call_id: uuid.UUID, event: str, **detail: int) -> bool:
    """Write the audit entry of a take-over session event (job TO). True when written; False (logged by class only) when the database could not take it."""
    try:
        _service(runtime).takeover_event(ctx.principal.token, ctx.tenant.id, call_id, event, **detail)
        return True
    except Exception as exc:  # noqa: BLE001 - only the class is logged, never a word of the call
        log.error("takeover_audit_failed event=%s %s", event, exc.__class__.__name__)
        return False


def _takeover_gate(runtime: Runtime, ctx: TenantContext) -> Any:
    """A memo of the business's take-over switch for ONE request: the database is asked at most once, and only when every other condition already holds. Fails closed."""
    box: list[bool] = []

    def enabled() -> bool:
        if not box:
            box.append(_service(runtime).takeover_enabled(ctx.principal.token, ctx.tenant.id))
        return box[0]

    return enabled


def _can_take_over(runtime: Runtime, ctx: TenantContext, call: Any, enabled: Any) -> bool:
    """Take over (the WebSocket below) works for a call that is live and answered, whose line this server holds, for an Owner or Admin, in a business that has switched take-over ON (job TO; default OFF).
    With one server that is every live answered call."""
    live = runtime.live_calls
    if live is None or ctx.role not in (Role.OWNER, Role.ADMIN) or not call.live or call.answered_at is None:
        return False
    parsed = parse_uuid(call.id)
    return parsed is not None and live.line_of(ctx.tenant.id, parsed) is not None and bool(enabled())


@router.get("", response_model=CallsOut)
def list_calls(ctx: Reader, runtime: RuntimeDep, response: Response, state: Literal["live", "finished", "all"] = "all", limit: Annotated[int, Query(ge=1, le=100)] = 50, cursor: str | None = None) -> CallsOut:
    response.headers["Cache-Control"] = "no-store"
    before: datetime | None = None
    if cursor:
        try:
            before = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(422, "validation_error", "That page marker is not valid.") from None
    out = _service(runtime).list(ctx.principal.token, ctx.tenant.id, state, limit, before)
    enabled = _takeover_gate(runtime, ctx)
    for item in out.items:
        item.can_take_over = _can_take_over(runtime, ctx, item, enabled)
    return out


def _chosen_introduce(chosen: Any, runtime: Runtime, ctx: TenantContext) -> tuple[str, str | None]:
    """The (kind, text) an Owner test call is placed with: the Owner's choice for this call, else the default."""
    pick = introduce.Introduce(chosen.kind, chosen.text) if chosen is not None else _default_introduce(runtime, ctx)
    return pick.kind, pick.text


def _default_introduce(runtime: Runtime, ctx: TenantContext) -> introduce.Introduce:
    """The Owner's own test call, nothing chosen for this call (11 Nov 2026: a test call must not open "from <the business>" by default): the Owner's SAVED choice when it is not the business default, else the Owner's own name,
    else the business. A real customer or Lead Desk call never reads this: it keeps the business name. The name comes from the Owner's profile, never from a goal."""
    try:
        saved = introduce.from_doc(training_for(runtime, ctx).get("introduce_as"))
    except Exception:   # noqa: BLE001 - an unreadable setting is the default
        saved = introduce.Introduce()
    if saved.kind != "business":
        return saved
    try:
        name = introduce.owner_name(runtime.workspace.my_profile(ctx.principal.token, ctx.tenant.id)) if runtime.workspace is not None else None
    except Exception:   # noqa: BLE001 - no profile, no name
        name = None
    return introduce.Introduce("owner", name) if name else introduce.Introduce()


@router.get("/test-numbers", response_model=TestNumbersOut)
def test_numbers(ctx: OwnerOnly, runtime: RuntimeDep, response: Response) -> TestNumbersOut:
    """The phones a test call may go to (the deployment's sandbox list), masked: an id to send as `to_id`, and the country code and last five digits to show. The full number never leaves the server."""
    response.headers["Cache-Control"] = "no-store"
    placer = getattr(runtime.phone_inbound, "outbound", None) if runtime.phone_inbound is not None else None
    if placer is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    default = _default_introduce(runtime, ctx)
    return TestNumbersOut.model_validate({"items": placer.test_numbers(), "default_introduce_as": {"kind": default.kind, "text": default.text}})


def _pack_tone(runtime: Runtime, ctx: TenantContext) -> str:
    """No explicit tone and no tone word in the goal: the tone in force for the workspace's calls to customers (the Owner's saved tone, else the old address setting mapped, else the business type's default: respectful for a school), as its parents will hear it."""
    from app.telephony import tone as tone_mod

    pack_default = "friendly"
    try:
        if runtime.packs is not None and runtime.pack_registry is not None:
            pack_default = runtime.pack_registry.call_tone(str(runtime.packs.workspace_pack(ctx.principal.token, ctx.tenant.id).get("pack_id") or "") or None)
    except Exception as exc:  # noqa: BLE001 - only the class is logged
        logging.getLogger("app.telephony.routes").warning("pack tone lookup failed %s", exc.__class__.__name__)
    try:
        doc: dict[str, Any] | None = training_for(runtime, ctx)
    except Exception:  # noqa: BLE001 - an unreadable setting is the business type's default
        doc = None
    return tone_mod.effective_tone(doc, pack_default)[0]


@router.post("/place", response_model=PlaceOut, status_code=202)
def place_call(ctx: OwnerOnly, runtime: RuntimeDep, body: PlaceIn) -> PlaceOut:
    """The Owner places a TEST call from the business's own Plivo line to a phone on the deployment's sandbox list (their own). The gate decides first: a call it refuses is dialled never and is kept as a refused call with its
    reason (409 call_not_allowed, `reason` a closed word). Phase B places calls to the owner's own phones only; nothing here reaches a business or a customer."""
    placer = getattr(runtime.phone_inbound, "outbound", None) if runtime.phone_inbound is not None else None
    if placer is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    to = body.to
    if body.to_id is not None:
        to = placer.number_for_id(body.to_id)
        if to is None:
            raise ApiError(422, "validation_error", "That number is not in the list.", extra={"fields": ["to_id"]})
    assert to is not None  # noqa: S101 - the model allows exactly one of `to` and `to_id`
    chosen_intro = _chosen_introduce(body.introduce_as, runtime, ctx)
    # 12 Nov 2026: what the form sent and what the call will use (kinds only, never the text): form=absent means the form sent nothing and the Owner's default was used
    log.info("call_place introduce_form=%s introduce_used=%s tone_sent=%s", body.introduce_as.kind if body.introduce_as is not None else "absent", chosen_intro[0], body.tone or "absent")
    try:
        placed = placer.place(ctx.principal.token, ctx.tenant.id, to, language=body.language, business=ctx.tenant.name, goal=body.goal, tone=body.tone or tone_keyword(body.goal) or _pack_tone(runtime, ctx), owner_test=True,
                              introduce=chosen_intro)
    except OutboundRefused as refused:
        raise ApiError(409, "call_not_allowed", "That call is not allowed.", extra={"reason": refused.reason}) from None
    except PlivoError:
        raise ApiError(502, "call_provider_failed", "The call could not be placed.") from None
    return PlaceOut(call_id=str(placed.call_id), state=placed.state)


@router.get("/take-over-setting", response_model=TakeOverSettingOut)
def get_takeover_setting(ctx: Reader, runtime: RuntimeDep, response: Response) -> TakeOverSettingOut:
    """Is live take-over switched on for this business? Default OFF. Owner, Admin and Sales read it; only the Owner changes it."""
    response.headers["Cache-Control"] = "no-store"
    return _service(runtime).takeover_setting(ctx.principal.token, ctx.tenant.id)


@router.put("/take-over-setting", response_model=TakeOverSettingOut)
def put_takeover_setting(ctx: OwnerOnly, runtime: RuntimeDep, body: TakeOverSettingIn) -> TakeOverSettingOut:
    """The Owner switches live take-over on or off. Every change is in the audit log (who, when, the old and the new value). Nothing is recorded either way."""
    return _service(runtime).set_takeover(ctx.principal.token, ctx.tenant.id, body.enabled)


@router.get("/{call_id}", response_model=CallDetailOut)
def get_call(call_id: str, ctx: Reader, runtime: RuntimeDep, response: Response) -> CallDetailOut:
    response.headers["Cache-Control"] = "no-store"
    cid = _id(call_id)
    out = _service(runtime).get(ctx.principal.token, ctx.tenant.id, cid)
    out.can_take_over = _can_take_over(runtime, ctx, out, _takeover_gate(runtime, ctx))
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        out.transcript = None   # the database already withholds it from Sales; this is the second lock
    else:
        # a live call's lines (app v4 captions): the transcript is saved when the call ends; while it runs on THIS server, the lines so far, with their English as it arrives
        live = runtime.live_calls.line_of(ctx.tenant.id, cid) if runtime.live_calls is not None else None
        if live is not None:
            out.transcript = [TurnOut.model_validate({k: v for k, v in item.items() if k in ("who", "text", "t", "text_en")}) for item in list(live.transcript)]
    return out


@router.post("/{call_id}/handled")
def mark_handled(call_id: str, ctx: Reader, runtime: RuntimeDep) -> dict[str, Any]:
    """A caller asked for a person and the team called them back: the call leaves Today's "Needs you" (Owner, Admin, Sales; once; 404 for another workspace's call)."""
    from app.crm.repository import NotFoundError

    try:
        return _service(runtime).handled(ctx.principal.token, ctx.tenant.id, _id(call_id))
    except NotFoundError:
        raise not_found() from None


class WhisperIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


@router.post("/{call_id}/whisper", status_code=202)
async def whisper(call_id: str, ctx: OwnerAdmin, runtime: RuntimeDep, body: WhisperIn) -> dict[str, str]:
    """Whisper (app v4; Owner, Admin): a note only the AI hears during a live call ("offer the Saturday visit"); it follows it from its next sentence. Nothing is said to the caller and
    nothing is stored. 409 call_not_here when the call is on another server or has ended; 404 for another workspace's call."""
    cid = _id(call_id)
    live = runtime.live_calls
    if live is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    try:
        _service(runtime).get(ctx.principal.token, ctx.tenant.id, cid)   # proves the call is this workspace's
    except CallStateError:
        raise not_found() from None
    if live.line_of(ctx.tenant.id, cid) is None:
        raise ApiError(409, "call_not_here", "That call is not on this server, or it has already ended.")
    if not _audit_event(runtime, ctx, cid, "whisper", text_chars=len(body.text)):   # audited BEFORE it is done, by length only (never the words); no entry, no whisper
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    if not live.whisper(ctx.tenant.id, cid, body.text):
        raise ApiError(409, "call_not_here", "That call is not on this server, or it has already ended.")
    return {"status": "sent"}


@router.post("/{call_id}/correction", response_model=CorrectionOut)
def correct_call(call_id: str, ctx: Reader, runtime: RuntimeDep, body: CorrectionIn) -> CorrectionOut:
    """"Correct it" after a call (app v4; Owner, Admin, Sales): the summary, the answers, and a note about how to talk. The note goes into later calls' instructions, so it may not hold a
    phone number or an e-mail address (422 correction_invalid). 404 for another workspace's call."""
    from app.crm.repository import NotFoundError
    from app.telephony.repository import CorrectionInvalid

    if body.summary is None and body.captured is None and body.note is None:
        raise ApiError(422, "validation_error", "Say what to correct.", extra={"fields": ["summary", "captured", "note"]})
    try:
        return _service(runtime).correct(ctx.principal.token, ctx.tenant.id, _id(call_id), body)
    except NotFoundError:
        raise not_found() from None
    except CorrectionInvalid:
        raise ApiError(422, "correction_invalid", "A note can't hold a phone number or an e-mail address.") from None


@router.post("/{call_id}/hang-up", status_code=202)
async def hang_up(call_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, str]:
    cid = _id(call_id)
    live = runtime.live_calls
    if live is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    try:
        _service(runtime).get(ctx.principal.token, ctx.tenant.id, cid)   # proves the call is this workspace's (the database raises "not found" for any other)
    except CallStateError:
        raise not_found() from None
    if not await live.hang_up(ctx.tenant.id, cid):
        # not on a live audio stream here: a call we placed that is still RINGING is ended through Plivo (cancelled), anything else has ended or is on another server
        placer = getattr(runtime.phone_inbound, "outbound", None) if runtime.phone_inbound is not None else None
        done = "not_ringing"
        if placer is not None:
            try:
                done = await run_in_threadpool(placer.cancel, ctx.principal.token, ctx.tenant.id, cid)
            except PlivoError:
                raise ApiError(502, "call_provider_failed", "The call could not be ended just now. Please try again.") from None
        if done != "cancelled":
            raise ApiError(409, "call_not_here", "That call is not on this server, or it has already ended.")
    _audit_event(runtime, ctx, cid, "hang_up")   # after the fact: ending a call is never held up by the audit trail; a failure is logged as an error
    return {"status": "ending"}


@router.websocket("/{call_id}/take-over")
async def take_over(ws: WebSocket, tenant_id: str, call_id: str) -> None:
    """Take over a live call from the app (app v4; Owner, Admin). A browser cannot put a header on a WebSocket, so the FIRST message is {"type": "start", "access_token": ...} (within 10 s).
    Then the AI's voice fades out and it answers no more; the server sends {"type": "ready", ...} and binary frames of the caller's audio (16-bit mono PCM, 16 kHz); the browser sends its
    microphone the same way. {"type": "hand_back"}, or closing the socket, gives the call back to the AI. {"type": "ended"} when the call itself ends. Nothing is recorded."""
    from fastapi.concurrency import run_in_threadpool
    from starlette.websockets import WebSocketDisconnect

    from app.browser_voice.routes import _authenticate

    runtime: Runtime | None = getattr(ws.app.state, "runtime", None)
    await ws.accept()

    async def refuse(code: int, word: str) -> None:
        with suppress(Exception):
            await ws.send_json({"type": "error", "code": word})
            await ws.close(code=code)

    live = getattr(runtime, "live_calls", None) if runtime is not None else None
    if runtime is None or live is None:
        return await refuse(4503, "unavailable")
    bv = getattr(runtime, "browser_voice", None)
    origin = ws.headers.get("origin")
    if origin and bv is not None and bv.allowed_origins and origin not in bv.allowed_origins:
        return await refuse(4403, "forbidden")
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=10.0)
    except (TimeoutError, WebSocketDisconnect, ValueError, RuntimeError):
        return await refuse(4401, "unauthorized")
    token = first.get("access_token") if isinstance(first, dict) else None
    if not isinstance(first, dict) or first.get("type") != "start" or not isinstance(token, str) or not token.strip():
        return await refuse(4401, "unauthorized")
    ctx = await run_in_threadpool(_authenticate, runtime, token.strip(), tenant_id)
    if isinstance(ctx, tuple):
        return await refuse(ctx[0], ctx[1])
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        return await refuse(4403, "forbidden")
    try:
        cid = uuid.UUID(call_id)
        await run_in_threadpool(_service(runtime).get, ctx.principal.token, ctx.tenant.id, cid)   # proves the call is this workspace's
    except Exception:   # noqa: BLE001 - not a call of this workspace (or no such call)
        return await refuse(4404, "not_found")
    if not await run_in_threadpool(_service(runtime).takeover_enabled, ctx.principal.token, ctx.tenant.id):
        return await refuse(4403, "takeover_off")   # the business has not switched live take-over on (job TO; default OFF)
    line = live.line_of(ctx.tenant.id, cid)
    if line is None:
        return await refuse(4409, "call_not_here")
    if not await run_in_threadpool(_audit_event, runtime, ctx, cid, "start"):   # no audit entry, no take-over (the database also refuses a start while the switch is off)
        return await refuse(4503, "unavailable")
    started = time.monotonic()
    caller = line.take_over()
    if _service(runtime).announce_takeover:
        await line.announce()   # TAKEOVER_ANNOUNCE (off by default): the caller hears a short fixed line before the person speaks
    await ws.send_json({"type": "ready", "audio_in": {"format": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "audio_out": {"format": "pcm_s16le", "sample_rate": 16000, "channels": 1}})

    async def to_person() -> None:
        while not line.closed():
            try:
                pcm = await asyncio.wait_for(caller.get(), 0.5)
            except TimeoutError:
                continue
            await ws.send_bytes(pcm)
        with suppress(Exception):
            await ws.send_json({"type": "ended"})

    sender = asyncio.ensure_future(to_person())
    try:
        while not line.closed():
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("bytes"):
                await line.send_owner_audio(message["bytes"])
            elif message.get("text") and '"hand_back"' in message["text"]:
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        line.hand_back()
        sender.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await sender
        await run_in_threadpool(_audit_event, runtime, ctx, cid, "end", duration_s=int(time.monotonic() - started))
        with suppress(Exception):
            await ws.close()
