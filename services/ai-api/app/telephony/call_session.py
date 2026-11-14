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
from app.browser_voice.session import Kind, Parts, VoiceSession
from app.conversation.parts import StreamingLlm
from app.ops.usage import UsageRecorder, record_best_effort
from app.telephony import call_usage, caller_guard, language_rule, persona
from app.telephony import outcome as outcome_mod
from app.telephony import tone as tone_mod
from app.telephony.handover import FINISHED
from app.telephony.line import PhoneLine
from app.telephony.outcome import CallOutcome
from app.telephony.phone_llm import PhoneLlm

log = logging.getLogger("app.telephony.call")
SUMMARY_TIMEOUT_S = 25.0
HEARTBEAT_S = 20.0   # while a call goes on, the phone server tells the database every so often (the live bar and the cleanup of orphaned calls rest on it)


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
    cost_pulse_s: int = 60              # the billing pulse of the line, in seconds (Plivo India: 30)
    # the free visit slots offered on this call (ISO starts_at, India time; job calls-like-a-pro part 5): the outcome keeps a visit time only if it is one of them
    visit_slots: tuple[str, ...] = ()
    assistant_name: str | None = None   # the name the assistant has on this call, noted on the call row for the live bar
    line_id: str | None = None          # the platform line (public.phone_numbers) the call came in on
    task_questions: tuple[dict[str, str], ...] = ()   # a Lead Desk task call: the plan's questions; the record carries a checked answer to each the customer gave
    goal_tone: str | None = None        # an outbound GOAL call: its tone (respectful | friendly | casual); None for every other call
    caller_ending: str | None = None   # the caller's last three digits, for the Calls list ("Caller ending 998"); never the whole number
    goal: str | None = None            # an outbound GOAL call: the goal's words, so the record is judged against its points (done / partly / not done, what the person agreed to)
    caller_hidden: bool = False        # the call showed the shop's own number or ours (a forward that hid the real caller): the record says so and no lead is made from it
    carrier: str = ""                  # the phone provider that carried the call (exotel | plivo | vobiz): the usage ledger records Plivo's seconds only for a Plivo call


class CallStore(Protocol):
    """The database side, synchronous (the call session runs it in a thread)."""

    def mark_in_progress(self, call_id: uuid.UUID, provider_call_sid: str | None) -> None: ...
    def finish(self, call_id: uuid.UUID, outcome: CallOutcome, duration_s: float) -> None: ...


class CallVoiceSession(VoiceSession):
    is_phone = True   # a phone call never gets the speaker check (owner decision 31 Oct 2026: off until the December lawyer review)
    # silence on a phone (owner, 6 Nov 2026): about 4 s quiet, one "హలో, ఉన్నారా?"; about 8 s in all, a short bye and the hang-up. Not while a person has taken the call over.
    PHONE_SILENCE_S = (4.0, 8.0)

    closing = False   # the goodbye has been said (owner, 11 Nov 2026): no "are you there?" check and no second goodbye after it; the line closes when the closing line has played

    @property
    def silence_s(self) -> tuple[float, float]:   # type: ignore[override]
        return (1e9, 1e9) if self._taken_over() or self.closing else self.PHONE_SILENCE_S

    def _taken_over(self) -> bool:
        return bool(getattr(getattr(getattr(self, "socket", None), "_line", None), "taken_over", False))

    async def _answer(self, text: str, tm: Any) -> None:
        """While a person has taken the call over, the AI does not answer (the caller's words still reach the transcript)."""
        if self._taken_over():
            return
        line = getattr(getattr(self, "socket", None), "_line", None)
        add_turn = getattr(line, "add_turn", None)
        index, began = (len(line.transcript), line.elapsed()) if callable(add_turn) and line is not None else (0, 0.0)
        guard = getattr(getattr(self, "parts", None), "tts", None)
        said_lines = getattr(guard, "said_lines", None)
        first_said = len(said_lines) if isinstance(said_lines, list) else 0
        try:
            await super()._answer(text, tm)
        finally:
            # one line per turn: the whole reply, or (after a barge-in) what the caller actually heard of it, cut between words (the pipeline's spoken_text)
            said = str(getattr(tm, "spoken_text", "") or "") or ("" if getattr(tm, "interrupted", False) else str(getattr(tm, "reply_text", "") or ""))
            # 12 Nov 2026: the transcript shows what the voice was REALLY given (after the guards: no honorific where it is not allowed, no promise), not the model's raw reply
            if isinstance(said_lines, list) and said and not getattr(tm, "interrupted", False) and said_lines[first_said:]:
                said = " ".join(said_lines[first_said:])
            elif said and guard is not None and callable(getattr(guard, "as_said", None)):
                said = str(guard.as_said(said, getattr(self, "language", "te")))
            if callable(add_turn) and said:
                add_turn(said, index=index, t=began)

    def _on_stt(self, ev: Any) -> None:
        """The caller's live words go to the line as well: a spoken stop word (ఆగండి, stop, wait ...) stops the assistant at once, and a long sound that is only "ఆ, అవును" is not an interruption."""
        super()._on_stt(ev)
        line = getattr(getattr(self, "socket", None), "_line", None)
        note = getattr(line, "note_caller_text", None)
        text = str(getattr(ev, "text", "") or "")
        if callable(note) and text and str(getattr(ev, "kind", "")) in ("partial", "final"):
            note(text)

    def check_in_words(self) -> dict[str, str]:
        return persona.CALL_CHECK_IN

    async def _say_goodbye(self, text: str) -> None:
        """The caller said bye: one short closing line the way people really say it ("సరే అండీ, bye!"), then the line closes as soon as it has played (within about a second)."""
        self._turn_active = True
        try:
            await self._follow_language(text)
            await self._say(persona.CALL_BYE.get(self.language, persona.CALL_BYE["en"]))
        finally:
            await self._end_turn()
        self._ended = "goodbye"
        await self._send({"type": "limit", "reason": "goodbye", "fatal": True})

    async def _end_for_silence(self) -> None:
        self._ended = "idle"
        await self._say(persona.CALL_BYE_QUIET.get(self.language, persona.CALL_BYE_QUIET["en"]))
        await self._send({"type": "limit", "reason": "idle", "fatal": True})

    WHISPER_HEAD = ("THE OWNER IS LISTENING AND TELLS YOU THIS. The caller cannot hear it. Follow it from your next sentence, in the call's language; never read it out or mention it:")

    def _apply_whispers(self) -> None:
        """Whisper (app v4): the owner's notes taken from the line, added to the instructions of every reply from now on (also after a language switch)."""
        line = getattr(getattr(self, "socket", None), "_line", None)
        taken = list(getattr(line, "whispers", []) or [])
        if line is not None and taken:
            line.whispers.clear()
            notes: list[str] = getattr(self, "_whispered", [])
            notes.extend(taken)
            self._whispered = notes[-5:]
            log.info("phone_whisper applied=%d", len(taken))   # (how many, never the words)
        notes_now: list[str] = getattr(self, "_whispered", [])
        if notes_now:
            self.conv.session.system = self.parts.system_for(self.language) + "\n\n" + self.WHISPER_HEAD + "\n" + "\n".join(f"- {n}" for n in notes_now)

    async def _follow_language(self, text: str) -> None:
        await self._follow_language_rule(text)
        self._apply_whispers()

    async def _follow_language_rule(self, text: str) -> None:
        """The phone's own language rule (app/telephony/language_rule.py, owner, 6 Nov 2026): start in the line's language and stay; fillers ("hello", "ok") and code-mixed speech never switch it;
        a request, a full sentence of 3+ words, or 2 turns in a row in another language do. Each switch is logged (codes and the reason, never the words)."""
        streak = getattr(self, "_language_streak", (None, 0))
        decision = language_rule.decide(self.language, text, streak)
        self._language_streak = decision.streak
        if decision.switch_to is None:
            return
        target = self._speakable(decision.switch_to)
        if target == self.language:
            return
        switches: list[dict[str, str]] = getattr(self, "language_switches", [])
        switches.append({"from": self.language, "to": target, "why": decision.why})
        self.language_switches = switches
        log.info("phone_language_switch from=%s to=%s why=%s", self.language, target, decision.why)
        await self._set_language(target)

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


def _record_usage(recorder: UsageRecorder, plan: CallPlan, call_id: uuid.UUID, duration: float, usage: Usage, parts: Parts, more_models: tuple[Any, ...]) -> None:
    """The call's provider lines (app/telephony/call_usage.py), written once, best effort. Runs in a thread."""
    models = {id(m): m for m in (parts.llm, *more_models) if m is not None}   # one count per model client, even if the same client is named twice
    tokens_in, tokens_out = call_usage.token_totals(*models.values())
    lines = call_usage.call_lines(call_id, carrier=plan.carrier, duration_s=duration, tts_chars=dict(usage.tts_chars), stt_seconds=usage.stt_seconds,
                                  stt_is_sarvam_engine=call_usage.stt_is_sarvam(parts, plan.language), tokens_in=tokens_in, tokens_out=tokens_out)
    record_best_effort(recorder, plan.tenant_id, lines)


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
    call_id_ready: Awaitable[uuid.UUID] | None = None,
    usage_recorder: UsageRecorder | None = None,
) -> CallOutcome:
    """`call_id_ready` (owner, 6 Nov 2026: the first word must not wait for the database): the call's row is still being written; the greeting starts at once and the row is marked in progress
    (and finished) with the id when it is ready. If the row cannot be written, the call is ended: no row, no call."""
    if line.start is None:
        raise ValueError("the line has not been opened")
    sid = line.start.call_sid or None

    async def begin_and_mark() -> uuid.UUID:
        cid = await call_id_ready if call_id_ready is not None else plan.call_id
        await asyncio.to_thread(store.mark_in_progress, cid, sid)
        note = getattr(store, "note", None)   # the assistant's name and the line, for the live bar: a store that cannot say it (a test, an older database) loses nothing
        if callable(note):
            with suppress(Exception):
                await asyncio.to_thread(note, cid, plan.assistant_name, plan.line_id)
        return cid

    marking = asyncio.ensure_future(begin_and_mark())

    async def beat() -> None:
        """Every HEARTBEAT_S while the call goes on. A beat that fails is only logged: the call must not end because a note to the database did not arrive."""
        heartbeat = getattr(store, "heartbeat", None)
        if not callable(heartbeat):
            return
        try:
            cid = await marking
        except Exception:  # noqa: BLE001 - no row: run_call ends the call
            return
        while True:
            try:
                await asyncio.to_thread(heartbeat, cid)
            except Exception as exc:  # noqa: BLE001
                log.warning("phone_call_heartbeat_failed %s", exc.__class__.__name__)
            await asyncio.sleep(HEARTBEAT_S)

    beating = asyncio.ensure_future(beat())
    if call_id_ready is None:
        await marking   # as before: the row is in progress before the first word

    def no_row(fut: asyncio.Future[uuid.UUID]) -> None:
        if not fut.cancelled() and fut.exception() is not None:
            log.warning("phone_call_row_failed %s", fut.exception().__class__.__name__)
            asyncio.ensure_future(line.hang_up("stopped"))

    marking.add_done_callback(no_row)
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
        elif name == "handover":
            flags["handover"] = True
            line.hang_up_after_next_turn("handover")
        elif name == "end":
            line.hang_up_after_next_turn("goodbye", interruptible=True)   # the closing line plays IN FULL, then the line closes (owner, 6 Nov 2026); if the caller speaks over it the call goes on (12 Nov 2026)
            if "s" in holder:
                holder["s"].closing = True
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
    if hasattr(line, "notice_speaker"):   # the take-over announcement (TAKEOVER_ANNOUNCE) is spoken in the call's own voice and language
        line.notice_speaker = lambda: session._say(persona.TAKE_OVER_NOTICE.get(session.language, persona.TAKE_OVER_NOTICE["en"]))
    holder["s"] = session

    def closing_cancelled() -> None:
        session.closing = False   # the caller spoke over the closing line: the end-of-call state is undone, the next reply answers them

    line.on_hang_up_cancelled = closing_cancelled

    def refusals_exhausted() -> None:
        """A person who may not hear the subject was refused twice and pushed again (12 Nov 2026): the short close plays in full, then the line closes. Not interruptible."""
        session.closing = True
        line.hang_up_after_next_turn("goodbye")

    if hasattr(parts.tts, "on_refusals_exhausted"):
        parts.tts.on_refusals_exhausted = refusals_exhausted
    phone_llm = PhoneLlm(parts.llm, plan.business, lambda: session.language, on_event=on_event, voicemail_action=plan.voicemail_action,
                          honest_line=(lambda lang: tone_mod.honest_line(lang, plan.goal_tone or "friendly")) if plan.goal_tone else None)
    session.conv.llm = phone_llm   # the transcript gets one line per turn when the turn ends (CallVoiceSession._answer); the model's streaming pieces are never lines
    started = (clock or asyncio.get_running_loop().time)()
    try:
        await session.run()
    finally:
        # owner, 6 Nov 2026: the characters each voice engine spoke in this call, so the real cost per minute is known (a greeting played from memory costs none)
        with suppress(Exception):
            setattr(line, "voice_chars", dict(usage.tts_chars))  # noqa: B010 - the phone line's own record (TimedLine); other lines simply carry it
            setattr(line, "voice_primary_off", str(getattr(parts.tts, "primary_off", "") or ""))  # noqa: B010
            setattr(line, "bookish", list(getattr(parts.tts, "bookish_words", []) or []))  # noqa: B010 - the written Telugu words the voice was given (a metric)
            setattr(line, "honorifics_stripped", int(getattr(parts.tts, "honorifics_stripped", 0) or 0))  # noqa: B010 - how many honorifics were taken out of the spoken lines (a metric)
            setattr(line, "child_terms", list(getattr(parts.tts, "child_terms", []) or []))  # noqa: B010 - words that name a child (వాడు ...) the voice was given (a metric; a flag in Respectful)
            setattr(line, "particles", (int(getattr(parts.tts, "particles", 0) or 0), int(getattr(parts.tts, "sentences", 0) or 0)))  # noqa: B010 - polite particles and sentences spoken (a metric)
            setattr(line, "goal_tone", plan.goal_tone)  # noqa: B010
        with suppress(Exception):
            # the call's languages (owner, 6 Nov 2026): where it started, where it ended, every switch with its reason; the recogniser follows the call's language
            setattr(line, "languages", {"start": plan.language, "end": session.language, "switches": list(getattr(session, "language_switches", []))})  # noqa: B010
        await line.close()
        for fut in acted:
            with suppress(asyncio.CancelledError, Exception):
                await fut
    duration = (clock or asyncio.get_running_loop().time)() - started
    translator = getattr(line, "translator", None)
    if translator is not None:
        with suppress(Exception):
            await translator.settle()   # the last lines' English, so the saved transcript has it too
    result = outcome_mod.deterministic(answered=True, transcript=line.transcript, end_reason=line.end_reason, voicemail=flags["voicemail"], stop_requested=flags["stop"], handover=flags["handover"])
    result.cost_paise = outcome_mod.cost_paise(duration, plan.cost_paise_per_minute, plan.cost_pulse_s)
    if outcome_llm is not None:
        try:
            result = await asyncio.wait_for(outcome_mod.from_model(outcome_llm, model, result, plan.language, today(), offered_slots=plan.visit_slots, questions=plan.task_questions, goal=plan.goal), SUMMARY_TIMEOUT_S)
        except TimeoutError:
            log.warning("phone_call_summary_timeout")   # the record is written without a summary rather than not at all
    if plan.caller_hidden:
        result.captured = {**result.captured, "caller_number": caller_guard.HIDDEN}
    elif plan.caller_ending:
        result.captured = {**result.captured, "caller_ending": plan.caller_ending}
    beating.cancel()
    with suppress(asyncio.CancelledError, Exception):
        await beating
    row_id: uuid.UUID | None = None
    try:
        call_id = await marking
        row_id = call_id
        if plan.task_questions:   # a Lead Desk task call: hand what it learned to the dialer that waits for it, BEFORE the row ends (the dialer looks when the row ends)
            FINISHED.put(call_id, result)
        await asyncio.to_thread(store.finish, call_id, result, duration)
    except Exception:   # noqa: BLE001 - the call is over either way; the worker's sweep closes a row that stayed open
        log.warning("phone_call_finish_failed")
    book = getattr(store, "book_from_call", None)
    if book is not None and row_id is not None and result.captured.get("visit_at"):   # the time the caller agreed to is booked now when the call is a customer's (appointment booking); never breaks the call
        with suppress(Exception):
            await asyncio.to_thread(book, row_id)
    if usage_recorder is not None and row_id is not None:   # what each provider was used for, from the numbers the call measured; never breaks the call
        with suppress(Exception):
            await asyncio.to_thread(_record_usage, usage_recorder, plan, row_id, duration, usage, parts, (outcome_llm, getattr(translator, "llm", None)))
    for hook, wanted in ((on_do_not_call, result.do_not_call), (on_handover, result.handover)):
        if wanted and hook is not None:
            with suppress(Exception):
                out = hook()
                if out is not None:
                    await out
    return result
