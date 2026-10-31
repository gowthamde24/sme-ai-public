"""One phone call, start to finish (job phone-calls part 3): the Live-talk session over a phone line, with the things only a phone call has.

  * the opening line (which says it is an AI) is the greeting;  the caller is a customer, so the model is the phone persona with approved facts only and no tools (persona.py, phone_llm.py)
  * "do not call me again" in the caller's words, or the key 2: acknowledged, ended, and the number goes on the suppression list (`on_do_not_call`);  the key 1 or a request for a person: acknowledged, ended, the team is told
  * a voicemail or phone-menu greeting in the first lines: the workspace's voicemail action (hang up, or one short message, or retry later)
  * the longest-call limit, silence and goodbye end it like any Live talk;  we always let our last words finish playing before the line is closed
  * afterwards: the outcome (deterministic, then the model's summary if someone really spoke), the cost estimate, the row finished once

Nothing the caller said is logged; the transcript goes to the call row only."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Protocol

from app.browser_voice.limits import Ledger, Limits, Usage
from app.browser_voice.llm import CaptionLlm
from app.browser_voice.session import Kind, Parts, VoiceSession
from app.conversation.parts import StreamingLlm
from app.telephony import outcome as outcome_mod
from app.telephony import persona
from app.telephony.line import PhoneLine
from app.telephony.outcome import CallOutcome
from app.telephony.phone_llm import PhoneLlm

log = logging.getLogger("app.telephony.call")


@dataclass(frozen=True)
class CallPlan:
    call_id: uuid.UUID
    tenant_id: uuid.UUID
    direction: str                  # outbound | inbound
    language: str
    business: str
    max_call_s: int = 180
    voicemail_action: str = "hang_up"   # hang_up | leave_message | retry_later
    cost_paise_per_minute: int = 0


class CallStore(Protocol):
    """The database side, synchronous (the call session runs it in a thread)."""

    def mark_in_progress(self, call_id: uuid.UUID, provider_call_sid: str | None) -> None: ...
    def finish(self, call_id: uuid.UUID, outcome: CallOutcome, duration_s: float) -> None: ...


class CallVoiceSession(VoiceSession):
    is_phone = True   # a phone call never gets the speaker check (owner decision 31 Oct 2026: off until the December lawyer review)

    async def speak_and_hang_up(self, text: str, reason: str) -> None:
        """Stop whatever is being said, say one fixed line, let it finish playing, close the line."""
        await self._barge_in(verify=False)
        self._turn_active = True
        try:
            await self._say(text)
        finally:
            await self._end_turn()
        await self.socket.hang_up(reason)   # type: ignore[attr-defined]


class DtmfSocket:
    """The line, with key presses taken out of the stream and handed to `on_digit`."""

    def __init__(self, line: PhoneLine, on_digit: Callable[[str], None]) -> None:
        self._line, self._on_digit = line, on_digit

    async def send_json(self, message: dict[str, Any]) -> None:
        await self._line.send_json(message)

    async def send_bytes(self, data: bytes) -> None:
        await self._line.send_bytes(data)

    async def receive(self) -> tuple[Kind, Any]:
        while True:
            kind, payload = await self._line.receive()
            if kind == "text" and isinstance(payload, dict) and payload.get("type") == "dtmf":
                self._on_digit(str(payload.get("digit", "")))
                continue
            return kind, payload

    async def hang_up(self, reason: str) -> None:
        await self._line.hang_up(reason)


async def run_call(
    plan: CallPlan,
    line: PhoneLine,
    parts: Parts,
    store: CallStore,
    *,
    ledger: Ledger,
    outcome_llm: StreamingLlm | None = None,
    model: str = "",
    today: Callable[[], str] = lambda: "",
    on_do_not_call: Callable[[], Awaitable[None] | None] | None = None,
    on_handover: Callable[[], Awaitable[None] | None] | None = None,
    clock: Callable[[], float] | None = None,
) -> CallOutcome:
    if line.start is None:
        raise ValueError("the line has not been opened")
    sid = line.start.call_sid or None
    await asyncio.to_thread(store.mark_in_progress, plan.call_id, sid)
    flags = {"voicemail": False, "stop": False, "handover": False}
    acted: list[asyncio.Future[None]] = []
    holder: dict[str, CallVoiceSession] = {}

    def act(coro: Awaitable[None]) -> None:
        acted.append(asyncio.ensure_future(coro))

    def on_event(name: str) -> None:
        """From the phone model, before it replies: the reply of this turn is the last, the line closes when it has played."""
        if flags["stop"] or flags["handover"]:
            return
        if name == "stop":
            flags["stop"] = True
            line.hang_up_after_next_turn("goodbye")
        elif name == "voicemail":
            flags["voicemail"] = True
            if plan.voicemail_action == "leave_message":
                line.hang_up_after_next_turn("stopped")
            else:
                act(line.hang_up("stopped"))

    def on_digit(digit: str) -> None:
        if flags["stop"] or flags["handover"]:
            return
        if digit == "2":
            flags["stop"] = True
            act(holder["s"].speak_and_hang_up(persona.STOP_ACK.get(plan.language, persona.STOP_ACK["en"]), "goodbye"))
        elif digit == "1":
            flags["handover"] = True
            act(holder["s"].speak_and_hang_up(persona.HANDOVER_ACK.get(plan.language, persona.HANDOVER_ACK["en"]), "handover"))

    limits = Limits(session_seconds=plan.max_call_s, greeting=True)
    usage = Usage()
    kwargs: dict[str, Any] = {"clock": clock} if clock is not None else {}
    session = CallVoiceSession(DtmfSocket(line, on_digit), parts, tenant_id=plan.tenant_id, user_id=plan.call_id, language=plan.language, limits=limits, ledger=ledger, usage=usage, token="", mode="live", **kwargs)
    holder["s"] = session
    phone_llm = PhoneLlm(parts.llm, plan.business, lambda: session.language, on_event=on_event, voicemail_action=plan.voicemail_action)
    session.conv.llm = CaptionLlm(phone_llm, session.emit)   # the assistant's sentences reach the line as captions, which is how the transcript is written
    started = (clock or asyncio.get_running_loop().time)()
    try:
        await session.run()
    finally:
        await line.close()
        for fut in acted:
            with suppress(asyncio.CancelledError, Exception):
                await fut
    duration = (clock or asyncio.get_running_loop().time)() - started
    result = outcome_mod.deterministic(answered=True, transcript=line.transcript, end_reason=line.end_reason, voicemail=flags["voicemail"], stop_requested=flags["stop"], handover=flags["handover"])
    result.cost_paise = outcome_mod.cost_paise(duration, plan.cost_paise_per_minute)
    if outcome_llm is not None:
        result = await outcome_mod.from_model(outcome_llm, model, result, plan.language, today())
    try:
        await asyncio.to_thread(store.finish, plan.call_id, result, duration)
    except Exception:   # noqa: BLE001 - the call is over either way; the worker's sweep closes a row that stayed open
        log.warning("phone_call_finish_failed")
    for hook, wanted in ((on_do_not_call, result.do_not_call), (on_handover, result.handover)):
        if wanted and hook is not None:
            with suppress(Exception):
                out = hook()
                if out is not None:
                    await out
    return result
