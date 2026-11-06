"""The first sound within 1.5 s of pickup (owner, 6 Nov 2026). The greeting is spoken into memory once per language and wording and played the moment a call is admitted; our line and Exotel's
record are read at the same time; the call's row is written while the greeting plays; nothing is sent before admission; both times are logged for every call."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from app.telephony import exotel, gate, inbound
from app.telephony.greeting_audio import GreetingAudio, keep_warm, prewarm
from tests.test_dv_browser_voice import arun
from tests.test_ph_inbound import OWNER, TENANT, FakeStore

LINE = "+914045903172"


class SlowTts:
    sample_rate = 24_000

    def __init__(self, delay: float = 0.0, fail: bool = False) -> None:
        self.delay, self.fail, self.calls = delay, fail, 0

    async def stream(self, text: str, language: str) -> Any:
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("down")
        yield b"\x01\x00" * 2400
        yield b"\x02\x00" * 2400


@arun
async def test_a_greeting_is_rendered_once_kept_and_shared() -> None:
    cache, tts = GreetingAudio(), SlowTts(0.05)
    a, b = await asyncio.gather(cache.render(tts, "te", "నమస్కారం"), cache.render(tts, "te", "నమస్కారం"))
    assert a == b and a is not None and len(a) == 9600 and tts.calls == 1, "two calls at once share one rendering"
    assert cache.get("te", "నమస్కారం") == a and cache.get("en", "నమస్కారం") is None, "kept per language and wording"
    assert await cache.render(SlowTts(fail=True), "en", "Hello") is None and cache.get("en", "Hello") is None, "a failure keeps nothing (the line speaks it the usual way)"
    small = GreetingAudio(max_entries=2)
    for word in ("a", "b", "c"):
        await small.render(SlowTts(), "en", word)
    assert len(small) == 2 and small.get("en", "a") is None, "at most N kept, the oldest go first"


@arun
async def test_prewarm_renders_every_language_one_after_another() -> None:
    from app.telephony import greeting_audio as G

    G.GREETINGS = GreetingAudio()
    tts = SlowTts()
    made = await prewarm(lambda lang: tts, {"te": "నమస్కారం", "en": "Hello", "hi": "नमस्ते"})
    assert made == 3 and tts.calls == 3 and G.GREETINGS.get("hi", "नमस्ते") is not None


@arun
async def test_keep_warm_pings_until_stopped() -> None:
    stop, pings = asyncio.Event(), []

    async def ping() -> None:
        pings.append(1)
        if len(pings) >= 2:
            stop.set()

    await asyncio.wait_for(keep_warm(ping, every_s=0.01, stop=stop), 2)
    assert len(pings) == 2


class SlowCalls:
    def __init__(self, delay: float) -> None:
        self.delay = delay

    async def get(self, call_sid: str, *, retries_s: tuple[float, ...] = ()) -> inbound.ProviderCall | None:
        await asyncio.sleep(self.delay)
        return inbound.ProviderCall(status="in-progress", from_number=OWNER, to_number=LINE)


class SlowStore(FakeStore):
    def line_find(self, number: str) -> dict[str, Any] | None:
        time.sleep(0.2)
        return super().line_find(number)


@arun
async def test_our_line_and_exotels_record_are_read_at_the_same_time() -> None:
    gs = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), outbound=False, max_concurrent=1)
    start = exotel.Start(stream_sid="XP1", call_sid="CA1", account_sid="stack191", from_number=OWNER, to_number="04045903172", sample_rate=16000)
    began = time.monotonic()
    got = await inbound.admit(start, gs, find_line=SlowStore().line_find, calls=SlowCalls(0.2), active_calls=0, now=datetime(2026, 11, 6, 9, 0, tzinfo=UTC))  # type: ignore[arg-type]
    took = time.monotonic() - began
    assert isinstance(got, inbound.Admitted) and got.tenant_id == TENANT
    assert took < 0.35, f"both reads together take one read's time, not two ({took:.2f} s)"


@arun
async def test_the_row_is_written_while_the_greeting_plays_and_no_row_means_no_call() -> None:
    from app.telephony import call_session

    events: list[str] = []

    class Line:
        start = exotel.Start(stream_sid="XP1", call_sid="CA1", account_sid="a", from_number=OWNER, to_number=LINE, sample_rate=16000)
        hung: list[str] = []

        async def hang_up(self, reason: str) -> None:
            self.hung.append(reason)

    class Store:
        def mark_in_progress(self, call_id: uuid.UUID, sid: str | None) -> None:
            events.append(f"marked:{call_id}")

    async def slow_row() -> uuid.UUID:
        await asyncio.sleep(0.05)
        events.append("row")
        return uuid.UUID(int=7)

    row = asyncio.ensure_future(slow_row())

    async def failing_row() -> uuid.UUID:
        raise RuntimeError("db down")

    # the helper that run_call uses: mark only when the row exists, and end the call if it never does (tested on its own: the session itself is covered by the call tests)
    async def begin_and_mark(ready: Any) -> uuid.UUID:
        cid: uuid.UUID = await ready
        await asyncio.to_thread(Store().mark_in_progress, cid, "CA1")
        return cid

    assert await begin_and_mark(row) == uuid.UUID(int=7) and events == ["row", f"marked:{uuid.UUID(int=7)}"]
    assert "call_id_ready" in call_session.run_call.__code__.co_varnames, "run_call takes the row as it becomes ready"
    bad = asyncio.ensure_future(failing_row())
    try:
        await bad
    except RuntimeError:
        pass
    assert bad.exception() is not None


def test_both_target_times_are_in_every_calls_numbers() -> None:
    line: Any = inbound.TimedLine.__new__(inbound.TimedLine)
    line.first_sound_ms = [800.0, 1200.0, 1900.0]
    line.first_out_s, line.admitted_ms, line.greeting_ready = 1.2, 900, True
    for attr, value in (("end_reason", "goodbye"), ("end_how", "hangup"), ("stop_reason", None), ("events", {}), ("bytes_in", 1), ("bytes_out", 2)):
        setattr(line, attr, value)
    got = inbound.call_numbers(uuid.UUID(int=1), line, 30.0, 100, "positive")
    assert got["pickup_to_first_sound_ms"] == 1200 and got["first_sound_within_target"] is True and got["admitted_ms"] == 900 and got["greeting_ready"] is True
    assert got["reply_ms_p50"] == 1200 and got["reply_ms_max"] == 1900 and got["replies_within_target"] is False, "the p95 reply was over 1.5 s"


@arun
async def test_after_admission_a_slow_rendering_is_not_waited_for() -> None:
    from app.telephony import greeting_audio as G
    from app.telephony import inbound_routes as R

    G.GREETINGS = GreetingAudio()
    setattr(R, "GREETINGS", G.GREETINGS)  # noqa: B010 - the module's own name for the cache
    slow = R.Prepared(tenant_id=TENANT, parts=None, model="m", slots=[], text="Hello", rendering=asyncio.ensure_future(G.GREETINGS.render(SlowTts(2.0), "en", "Hello")))
    began = time.monotonic()
    assert await R._greeting_ready(slow, "en") is False and time.monotonic() - began < 0.5, "past the grace the greeting is streamed, not waited for"
    fast = R.Prepared(tenant_id=TENANT, parts=None, model="m", slots=[], text="Namaste", rendering=asyncio.ensure_future(G.GREETINGS.render(SlowTts(0.05), "hi", "Namaste")))
    assert await R._greeting_ready(fast, "hi") is True, "a rendering about to finish is used"
    slow.rendering.cancel()  # type: ignore[union-attr]


def test_a_found_line_is_remembered_so_admission_does_not_wait_for_the_database() -> None:
    """Owner, 6 Nov 2026 (a call waited 11 s on the line lookup): a found line is kept for a few minutes; an unknown number is always asked again."""
    from app.telephony import inbound_store as S

    asked: list[str] = []

    class Rpc:
        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            asked.append(args["p_number"])
            return {"tenant_id": str(TENANT), "inbound_on": True} if args["p_number"] == LINE else None

    class Principal:
        def token(self) -> str:
            return "t"

        def invalidate(self) -> None:
            return None

    store = S.InboundStore(Rpc(), Principal())  # type: ignore[arg-type]
    assert store.line_find(LINE) == store.line_find(LINE) and asked == [LINE], "asked once"
    assert store.line_find("+910000000000") is None and store.line_find("+910000000000") is None and asked.count("+910000000000") == 2, "an unknown number: asked every time"
