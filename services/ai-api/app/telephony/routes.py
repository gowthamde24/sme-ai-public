"""The Calls page under /v1/tenants/{tenant_id}/calls (job phone-calls part 6). The contract is docs/contracts/calls.md.

  GET  /calls?state=live|finished|all&limit&cursor   Owner, Admin, Sales: live calls first, then finished, newest first; poll every `poll_after_s`
  GET  /calls/{id}                                    the call; the transcript (turn by turn) for Owner and Admin only
  POST /calls/{id}/hang-up                            Owner, Admin: end a live call

Sandbox calls say `sandbox: true`; no audio is ever kept (`recorded` is always false). The transcript and the summary are never logged.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import asyncio
import uuid
from contextlib import suppress
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response, WebSocket
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.telephony.models import CallDetailOut, CallsOut, CorrectionIn, CorrectionOut, TurnOut
from app.telephony.repository import CallStateError
from app.telephony.service import CallsService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/calls", tags=["calls"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


def _service(runtime: Runtime) -> CallsService:
    if runtime.calls is None:
        raise ApiError(503, "calls_unavailable", "Calls are not available right now.")
    return runtime.calls


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _can_take_over(runtime: Runtime, ctx: TenantContext, call: Any) -> bool:
    """Take over (the WebSocket below) works for a call that is live and answered, whose line this server holds, for an Owner or Admin. With one server that is every live answered call."""
    live = runtime.live_calls
    if live is None or ctx.role not in (Role.OWNER, Role.ADMIN) or not call.live or call.answered_at is None:
        return False
    parsed = parse_uuid(call.id)
    return parsed is not None and live.line_of(ctx.tenant.id, parsed) is not None


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
    for item in out.items:
        item.can_take_over = _can_take_over(runtime, ctx, item)
    return out


@router.get("/{call_id}", response_model=CallDetailOut)
def get_call(call_id: str, ctx: Reader, runtime: RuntimeDep, response: Response) -> CallDetailOut:
    response.headers["Cache-Control"] = "no-store"
    cid = _id(call_id)
    out = _service(runtime).get(ctx.principal.token, ctx.tenant.id, cid)
    out.can_take_over = _can_take_over(runtime, ctx, out)
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
        raise ApiError(409, "call_not_here", "That call is not on this server, or it has already ended.")
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
    line = live.line_of(ctx.tenant.id, cid)
    if line is None:
        return await refuse(4409, "call_not_here")
    caller = line.take_over()
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
        with suppress(Exception):
            await ws.close()
