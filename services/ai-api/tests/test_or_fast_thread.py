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
