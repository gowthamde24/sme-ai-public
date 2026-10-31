"""Casual Live turns on the fast tier, in the SAME conversation thread (owner decision, 31 Oct 2026). Against fakes: the stored thread, the cost, the refusal, and the router."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from app.agents.errors import AgentDbError
from app.browser_voice.fast_thread import FastThread
from app.conversation.fakes import FakeLlm
from tests.test_dv_browser_voice import arun

TENANT = uuid.UUID(int=0xA)
THREAD = uuid.UUID(int=0xC1)


class FakeDb:
    def __init__(self, rows: list[dict[str, Any]] | None = None, *, fail_begin: Exception | None = None, fail_reserve: Exception | None = None) -> None:
        self.rows = list(rows or [])
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_begin, self.fail_reserve = fail_begin, fail_reserve
        self.closed = False
        self.done = asyncio.Event()

    def begin_message(self, **kw: Any) -> dict[str, Any]:
        self.calls.append(("begin", kw))
        if self.fail_begin:
            raise self.fail_begin
        self.rows.append({"seq": len(self.rows) + 1, "role": "user", "body": kw["text"], "language": kw["language"]})
        return {"seq": len(self.rows)}

    def history(self, conversation_id: uuid.UUID, before_seq: int, limit: int) -> list[dict[str, Any]]:
        self.calls.append(("history", {"conversation_id": conversation_id, "limit": limit}))
        return self.rows[-limit:]

    def reserve_cost(self, key: str, **kw: Any) -> None:
        self.calls.append(("reserve", kw))
        if self.fail_reserve:
            raise self.fail_reserve

    def save_reply(self, **kw: Any) -> dict[str, Any]:
        self.calls.append(("save", kw))
        return {}

    def record_usage(self, key: str, usage: Any) -> None:
        self.calls.append(("usage", {"usage": usage}))

    def finish(self, status: str, code: str | None) -> None:
        self.calls.append(("finish", {"status": status, "code": code}))

    def close(self) -> None:
        self.closed = True

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]


def make(db: FakeDb, llm: FakeLlm | None = None, language: str = "en", allow: tuple[str, ...] = ()) -> tuple[FastThread, list[tuple[str, dict[str, Any]]], list[dict[str, Any]]]:
    seen: list[tuple[str, dict[str, Any]]] = []
    prompts: list[dict[str, Any]] = []
    inner = llm or FakeLlm(("Hello there. ", "How can I help?"))
    original = inner.stream

    def spy(system: str, messages: list[dict[str, str]], model: str) -> Any:
        prompts.append({"system": system, "messages": messages, "model": model})
        return original(system, messages, model)

    inner.stream = spy   # type: ignore[method-assign]
    ft = FastThread(fast=inner, open_db=lambda: db, tenant_id=TENANT, conversation_id=lambda: THREAD, language=lambda: language, emit=lambda k, d: seen.append((k, d)),
                    refuse=lambda exc: {"code": getattr(exc, "code", "x"), "message": "refused"}, allow_address=lambda: allow, input_micros_per_mtok=1_000_000, output_micros_per_mtok=5_000_000)
    return ft, seen, prompts


async def settle(db: FakeDb) -> None:
    for _ in range(200):
        if db.closed:
            return
        await asyncio.sleep(0.01)


@arun
async def test_a_casual_turn_is_stored_in_the_same_thread_and_the_reply_is_streamed() -> None:
    db = FakeDb([{"seq": 1, "role": "user", "body": "show me today's leads", "language": "en"}, {"seq": 2, "role": "assistant", "body": "Three new leads came in.", "language": "en"}])
    ft, _, prompts = make(db)
    pieces = [p async for p in ft.stream("system prompt", [{"role": "user", "content": "thanks, how are you?"}], "claude-haiku-5-5")]
    assert pieces == ["Hello there. ", "How can I help?"]
    await settle(db)
    begin = next(c[1] for c in db.calls if c[0] == "begin")
    assert begin["conversation_id"] == THREAD and begin["tenant_id"] == TENANT and begin["text"] == "thanks, how are you?" and begin["light"] is True
    assert prompts[0]["model"] == "claude-haiku-5-5" and prompts[0]["system"] == "system prompt"
    assert prompts[0]["messages"] == [{"role": "user", "content": "show me today's leads"}, {"role": "assistant", "content": "Three new leads came in."}, {"role": "user", "content": "thanks, how are you?"}], "the thread's earlier messages (typed or spoken) are the model's context, the new words once"
    save = next(c[1] for c in db.calls if c[0] == "save")
    assert save["text"] == "Hello there. How can I help?" and save["language"] == "en"
    assert db.names()[-2:] == ["usage", "finish"] and next(c[1] for c in db.calls if c[0] == "finish")["status"] == "succeeded" and db.closed
    assert next(c[1] for c in db.calls if c[0] == "reserve")["max_output_tokens"] > 0


@arun
async def test_the_first_message_of_a_thread_has_no_history_and_the_new_words_are_not_doubled() -> None:
    db = FakeDb()
    ft, _, prompts = make(db)
    [p async for p in ft.stream("s", [{"role": "user", "content": "hello"}], "m")]
    assert prompts[0]["messages"] == [{"role": "user", "content": "hello"}]


@arun
async def test_a_reply_that_is_cut_by_the_caller_is_stored_as_far_as_it_went() -> None:
    db = FakeDb()
    ft, _, _ = make(db, FakeLlm(("First part. ", "Second part. ", "Third part."), gap=0.2))
    gen = ft.stream("s", [{"role": "user", "content": "tell me"}], "m")
    assert await gen.__anext__() == "First part. "
    await gen.aclose()  # type: ignore[attr-defined]  # the caller spoke over it
    await settle(db)
    assert next(c[1] for c in db.calls if c[0] == "save")["text"] == "First part."
    assert db.closed


@arun
async def test_the_stored_reply_has_no_gendered_address_and_no_internal_name() -> None:
    db = FakeDb()
    ft, _, _ = make(db, FakeLlm(("Sure sir, ", "WhatsApp customer 84407a is waiting.")))
    [p async for p in ft.stream("s", [{"role": "user", "content": "hi"}], "m")]
    await settle(db)
    saved = next(c[1] for c in db.calls if c[0] == "save")["text"]
    assert "sir" not in saved.lower() and "84407a" not in saved
    db2 = FakeDb()
    ft2, _, _ = make(db2, FakeLlm(("Sure sir.",)), allow=("sir",))
    [p async for p in ft2.stream("s", [{"role": "user", "content": "hi"}], "m")]
    await settle(db2)
    assert "sir" in next(c[1] for c in db2.calls if c[0] == "save")["text"], "a word the person chose for themselves is kept"


@arun
async def test_a_refused_turn_says_why_and_nothing_is_spoken() -> None:
    class Cap(AgentDbError):
        code = "budget"

    db = FakeDb(fail_begin=Cap())
    ft, seen, _ = make(db)
    assert [p async for p in ft.stream("s", [{"role": "user", "content": "hi"}], "m")] == []
    assert seen and seen[0][0] == "error" and db.closed
    db2 = FakeDb(fail_reserve=Cap())
    ft2, seen2, _ = make(db2)
    assert [p async for p in ft2.stream("s", [{"role": "user", "content": "hi"}], "m")] == []
    assert seen2 and seen2[0][0] == "error" and ("finish", {"status": "failed", "code": "budget"}) in db2.calls and "save" not in db2.names()


@arun
async def test_the_cost_is_recorded_from_the_prices() -> None:
    db = FakeDb()
    ft, _, _ = make(db)
    [p async for p in ft.stream("s" * 3000, [{"role": "user", "content": "hi"}], "m")]
    await settle(db)
    usage = next(c[1] for c in db.calls if c[0] == "usage")["usage"]
    assert usage.input_tokens > 900 and usage.output_tokens > 0 and usage.cost_micros >= usage.input_tokens


@arun
async def test_a_thread_that_cannot_be_read_does_not_silence_the_turn() -> None:
    class Unreadable(FakeDb):
        def history(self, *a: Any, **k: Any) -> list[dict[str, Any]]:
            raise AgentDbError()

    db = Unreadable()
    ft, _, prompts = make(db)
    assert [p async for p in ft.stream("s", [{"role": "user", "content": "hi"}], "m")]
    assert prompts[0]["messages"] == [{"role": "user", "content": "hi"}]


@arun
async def test_the_router_sends_casual_turns_to_the_fast_tier_and_the_rest_to_the_written_chat_turn() -> None:
    from app.browser_voice.session import Parts
    from tests.test_dv_browser_voice import FakeSocket, fake_parts, session_of

    for fast_smalltalk, expected in ((True, {"hello how are you": "fast", "tell me a joke": "fast", "show me the pending leads": "strong"}), (False, {"hello how are you": "strong", "show me the pending leads": "strong"})):
        parts: Parts = fake_parts()
        parts.one_thread = True
        parts.fast_smalltalk = fast_smalltalk
        session = session_of(FakeSocket(), parts)
        for text, tier in expected.items():
            assert session._route(text, True, 1) == tier, (fast_smalltalk, text)   # noqa: SLF001
        await asyncio.sleep(0)


@arun
async def test_the_model_starts_while_the_database_is_still_storing_the_words_but_nothing_is_spoken_before_that_is_done() -> None:
    import threading
    import time

    gate = threading.Event()

    class Slow(FakeDb):
        def begin_message(self, **kw: Any) -> dict[str, Any]:
            gate.wait(2.0)
            return super().begin_message(**kw)

    db = Slow()
    started: list[float] = []
    llm = FakeLlm(("Hello there. ",))
    original = llm.stream

    def spy(system: str, messages: list[dict[str, str]], model: str) -> Any:
        started.append(time.perf_counter())
        return original(system, messages, model)

    llm.stream = spy   # type: ignore[method-assign]
    ft, _, _ = make(db, llm)
    ft._cache, ft.stale = [], False   # noqa: SLF001  (a session that has read its thread)
    t0 = time.perf_counter()
    gen = ft.stream("s", [{"role": "user", "content": "hi"}], "m")
    first = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.3)
    assert started and started[0] - t0 < 0.2, "the model was asked at once"
    assert not first.done(), "…but not a word is spoken until the words are stored"
    gate.set()
    assert await asyncio.wait_for(first, 3) == "Hello there. "
    async for _ in gen:
        pass


@arun
async def test_the_thread_is_read_once_then_kept_in_memory_until_another_path_adds_to_it() -> None:
    db = FakeDb([{"seq": 1, "role": "user", "body": "typed earlier", "language": "en"}, {"seq": 2, "role": "assistant", "body": "typed answer", "language": "en"}])
    ft, _, prompts = make(db)
    [p async for p in ft.stream("s", [{"role": "user", "content": "one"}], "m")]
    [p async for p in ft.stream("s", [{"role": "user", "content": "two"}], "m")]
    assert sum(1 for c in db.calls if c[0] == "history") == 1, "the second turn did not read the thread again"
    assert prompts[1]["messages"][-3:] == [{"role": "user", "content": "one"}, {"role": "assistant", "content": "Hello there. How can I help?"}, {"role": "user", "content": "two"}]
    ft.mark_stale()   # the written chat's turn added messages
    [p async for p in ft.stream("s", [{"role": "user", "content": "three"}], "m")]
    assert sum(1 for c in db.calls if c[0] == "history") == 2


# ---- audio pacing (standard B1: the server sends at most 300 ms ahead) ------------------------------------------------------------------------------


@arun
async def test_paced_audio_never_runs_more_than_the_allowed_time_ahead_of_the_browser() -> None:
    from app.browser_voice.audio import BrowserPlayout

    now = [0.0]
    sent: list[tuple[float, int]] = []
    ahead_seen: list[float] = []

    async def audio(b: bytes) -> None:
        sent.append((now[0], len(b)))

    async def stop() -> None:
        pass

    async def sleep(seconds: float) -> None:
        now[0] += seconds   # the browser plays while we wait

    out = BrowserPlayout(audio, stop, lambda: now[0], ahead_s=0.3, sleep=sleep)
    second = b"\x00\x00" * 24000   # one second at 24 kHz
    await out.write(second)
    ahead_seen.append(out.unplayed_seconds())
    assert max(n for _, n in sent) <= 4800, "sent in slices of 100 ms"
    assert out.unplayed_seconds() <= 0.3 + 0.1 + 1e-6, "never more than the allowance plus one slice ahead of the browser"
    assert now[0] >= 0.55, "a second of audio takes about a second to go out, minus what may be ahead"
    out2 = BrowserPlayout(audio, stop, lambda: now[0])
    before = len(sent)
    await out2.write(second)
    assert len(sent) == before + 1 and out2.unplayed_seconds() == 1.0, "unpaced (the phone loop): as before"


@arun
async def test_a_stop_after_paced_audio_cuts_off_at_most_the_allowance() -> None:
    from app.browser_voice.audio import BrowserPlayout

    now = [0.0]

    async def audio(b: bytes) -> None:
        pass

    async def stop() -> None:
        pass

    async def sleep(seconds: float) -> None:
        now[0] += seconds

    out = BrowserPlayout(audio, stop, lambda: now[0], ahead_s=0.3, sleep=sleep)
    await out.write(b"\x00\x00" * 24000 * 3)
    assert out.unplayed_seconds() <= 0.4 + 1e-6


# ---- A3: speculative start -----------------------------------------------------------------------------------------------------------------------------


class SpecLlm:
    """A fast tier that can start before the words are final: counts what was started, served and cancelled."""

    def __init__(self) -> None:
        self.started: list[str] = []
        self.served: list[str] = []
        self.cancelled: list[str] = []
        self.streamed: list[str] = []

    def stream(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
        self.streamed.append(messages[-1]["content"])
        return FakeLlm(("Sure. ", "Here you go."), gap=0.01).stream(system, messages, model)

    def speculate(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
        text = messages[-1]["content"]
        self.started.append(text)
        outer = self

        class Spec:
            def __init__(self) -> None:
                self.text = text

            def stream(self) -> Any:
                outer.served.append(text)
                return FakeLlm(("Early ", "answer."), gap=0.01).stream(system, messages, model)

            async def cancel(self) -> None:
                outer.cancelled.append(text)

        return Spec()


class PartialsStt:
    """Partials, a pause, optionally more partials, then the final (a real recogniser's order)."""

    sample_rate = 16000

    def __init__(self, partials: list[tuple[float, str]], final: str, quiet: float = 0.4) -> None:
        self.partials, self.final, self.quiet = partials, final, quiet

    async def events(self, frames: Any) -> Any:
        from app.conversation.parts import SttEvent

        yield SttEvent("speech_start")
        for wait, text in self.partials:
            await asyncio.sleep(wait)
            yield SttEvent("partial", text)
        await asyncio.sleep(self.quiet)
        yield SttEvent("speech_end")
        yield SttEvent("final", self.final)


def spec_conversation(stt: Any, llm: SpecLlm, allowed: bool = True) -> Any:
    from app.conversation.fakes import FakePlayout, FakeTts
    from app.conversation.parts import Session
    from app.conversation.pipeline import Conversation

    conv = Conversation(stt=stt, llm=llm, tts=FakeTts(chunks=3, chunk_ms=50), playout=FakePlayout(rate=16000), session=Session(system="s", language="en"), models={"fast": "f", "strong": "s"},
                        router=lambda text, tools, turn: "fast", can_speculate=(lambda text: allowed))
    conv.STABLE_S = 0.05
    return conv


class Src2:
    speech_ended_at = None

    async def frames(self) -> Any:
        if False:
            yield b""


@arun
async def test_a_reply_started_on_a_stable_finished_looking_partial_is_used_when_the_final_is_the_same_words() -> None:
    from app.conversation.parts import TurnTimings

    llm = SpecLlm()
    conv = spec_conversation(PartialsStt([(0.05, "what is the"), (0.1, "what is the price of this saree")], "What is the price of this saree?"), llm)
    tm = TurnTimings()
    text = await conv.listen(Src2(), tm)
    assert text == "What is the price of this saree?" and llm.started == ["what is the price of this saree"]
    done = await conv.respond(text or "", tm)
    assert llm.served == ["what is the price of this saree"] and llm.streamed == [] and not llm.cancelled
    assert done.reply_text.startswith("Early") and done.speculative and conv.speculations == {"started": 1, "used": 1, "dropped": 0}


@arun
async def test_a_reply_started_early_is_thrown_away_when_the_caller_goes_on() -> None:
    from app.conversation.parts import TurnTimings

    llm = SpecLlm()
    conv = spec_conversation(PartialsStt([(0.05, "what is the price of this saree"), (0.2, "what is the price of this saree in blue")], "What is the price of this saree in blue?", quiet=0.1), llm)
    tm = TurnTimings()
    text = await conv.listen(Src2(), tm)
    await conv.respond(text or "", tm)
    assert llm.started == ["what is the price of this saree", "what is the price of this saree in blue"] and llm.cancelled == ["what is the price of this saree"], "the first early start was dropped when they went on"
    assert llm.served == ["what is the price of this saree in blue"] and llm.streamed == [], "…and the one started on the longer words was kept when the final confirmed them"
    assert conv.speculations == {"started": 2, "used": 1, "dropped": 1}


@arun
async def test_nothing_is_started_early_for_words_that_look_unfinished_or_for_the_written_chat_tier() -> None:
    from app.conversation.parts import TurnTimings

    llm = SpecLlm()
    conv = spec_conversation(PartialsStt([(0.05, "I want to know about the")], "I want to know about the blue saree"), llm)
    await conv.listen(Src2(), TurnTimings())
    assert llm.started == [], "an unfinished thought is not answered, early or late"
    llm2 = SpecLlm()
    conv2 = spec_conversation(PartialsStt([(0.05, "show me the pending leads for today")], "Show me the pending leads for today."), llm2, allowed=False)
    await conv2.listen(Src2(), TurnTimings())
    assert llm2.started == [], "business questions go to the written chat's turn, which writes at once: never early"


@arun
async def test_an_early_start_writes_nothing_to_the_thread_until_it_is_confirmed() -> None:
    db = FakeDb()
    ft, _, _ = make(db)
    ft._cache, ft.stale = [], False   # noqa: SLF001
    spec = ft.speculate("s", [{"role": "user", "content": "how are you today"}], "m")
    assert spec is not None
    await asyncio.sleep(0.05)
    await spec.cancel()
    await asyncio.sleep(0.05)
    assert db.calls == [], "a dropped early start leaves no message, no run and no cost in the thread"
    spec2 = ft.speculate("s", [{"role": "user", "content": "how are you today"}], "m")
    assert spec2 is not None
    pieces = [p async for p in spec2.stream()]
    await settle(db)
    assert pieces and db.names().count("begin") == 1 and "save" in db.names()
    ft.stale = True
    assert ft.speculate("s", [{"role": "user", "content": "x y z"}], "m") is None, "a thread that has to be read again is not worth an early start"


@arun
async def test_the_early_start_also_fires_at_the_recogniser_s_end_of_speech_even_when_the_words_were_never_stable() -> None:
    from app.conversation.parts import SttEvent, TurnTimings

    class Quick:
        sample_rate = 16000

        async def events(self, frames: Any) -> Any:
            yield SttEvent("speech_start")
            yield SttEvent("partial", "what is the price of this saree")   # no stable moment: the end of speech follows at once
            yield SttEvent("speech_end")
            await asyncio.sleep(0.05)   # the final transcript is still being made
            yield SttEvent("final", "What is the price of this saree?")

    llm = SpecLlm()
    conv = spec_conversation(Quick(), llm)
    conv.STABLE_S = 5.0
    tm = TurnTimings()
    text = await conv.listen(Src2(), tm)
    assert llm.started == ["what is the price of this saree"], "started at speech_end, before the final"
    await conv.respond(text or "", tm)
    assert llm.served == ["what is the price of this saree"] and llm.streamed == [] and conv.speculations["used"] == 1
