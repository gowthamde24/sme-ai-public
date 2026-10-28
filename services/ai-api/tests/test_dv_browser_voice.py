"""The browser voice (job DV): the pieces with fakes (no socket, no key), the session against a fake socket, the route against the app's test client."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import functools
import json
import time
import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from starlette.websockets import WebSocketDisconnect

from app.browser_voice import routes as bv_routes
from app.browser_voice.audio import BrowserPlayout, FrameBus
from app.browser_voice.limits import Ledger, Limits, Usage
from app.browser_voice.llm import (
    AskLlm,
    AskTurns,
    CaptionLlm,
    TieredLlm,
    cut_for_speech,
    parse_sse,
    speakable,
)
from app.browser_voice.runtime import BrowserVoice
from app.browser_voice.session import Kind, Parts, VoiceSession
from app.conversation.fakes import FakeLlm, FakeStt, FakeTts, silence, tone
from app.conversation.voices import default_config
from tests.fakes import TENANT_A, auth, make_client


def arun(fn: Callable[..., Any]) -> Callable[..., None]:
    """The suite has no async plugin: an async test runs on its own event loop."""

    @functools.wraps(fn)
    def run() -> None:
        asyncio.run(fn())

    return run


TENANT = uuid.UUID(int=0xA)
USER = uuid.UUID(int=0x1000)


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ---- the small pure parts ---------------------------------------------------------------------------------------------------------------------------


def test_written_text_becomes_something_to_say() -> None:
    assert speakable("**Two** saree orders [1]\n- Lakshmi (source 3)\n# Done") == "Two saree orders Lakshmi Done"


def test_a_long_answer_is_cut_at_a_sentence_and_the_rest_is_kept_for_the_screen() -> None:
    text = "First sentence here. Second sentence goes on and on. " * 12
    say, rest = cut_for_speech(text, 120)
    assert say.endswith(".") and len(say) <= 120 + 1 and rest and say + " " + rest == text.strip()
    assert cut_for_speech("Short one.", 120) == ("Short one.", "")
    only, rest2 = cut_for_speech("A" * 300 + ". tail", 100)  # one long sentence: the first whole sentence is still said
    assert only.endswith(".") and rest2 == "tail"


def test_server_sent_events_are_read() -> None:
    assert parse_sse(sse("text", {"type": "text", "delta": "hi"})) == ("text", {"type": "text", "delta": "hi"})
    assert parse_sse("event: text\ndata: not json\n\n") is None


def test_the_frame_bus_drops_our_own_echo_but_keeps_a_pre_roll() -> None:
    now = [0.0]
    bus = FrameBus(lambda: now[0])
    for i in range(10):
        now[0] = i * 0.1
        bus.push(bytes([i]) * 4)
    now[0] = 1.0
    assert bus.drop_before(0.3) == 7  # frames older than 0.7 s go; the last three stay


@arun
async def test_the_playout_knows_when_the_browser_is_still_playing() -> None:
    sent: list[bytes] = []
    stops: list[int] = []
    now = [0.0]

    async def audio(b: bytes) -> None:
        sent.append(b)

    async def stop() -> None:
        stops.append(1)

    out = BrowserPlayout(audio, stop, lambda: now[0])
    await out.write(b"\x00\x00" * 24000)  # one second at 24 kHz
    assert out.active
    now[0] = 1.5
    assert not out.active
    await out.write(b"\x00\x00" * 24000)
    await out.stop()
    assert not out.active and stops == [1] and len(sent) == 2


# ---- the ledger ------------------------------------------------------------------------------------------------------------------------------------


def test_one_session_at_a_time_a_rate_and_a_day() -> None:
    day = ["d1"]
    now = [0.0]
    ledger = Ledger(Limits(day_seconds=100, day_tts_chars=50, sessions_per_minute=2), clock=lambda: now[0], today=lambda: day[0])
    assert ledger.admit(TENANT) is None
    assert ledger.admit(TENANT) == "busy"
    ledger.release(TENANT)
    assert ledger.admit(TENANT) is None
    ledger.release(TENANT)
    assert ledger.admit(TENANT) == "rate_limited"
    now[0] = 61
    assert ledger.admit(TENANT) is None
    ledger.release(TENANT)
    ledger.add_seconds(TENANT, 100)
    assert ledger.admit(TENANT) == "daily_limit" and ledger.seconds_left(TENANT) == 0
    day[0] = "d2"
    assert ledger.admit(TENANT) is None, "a new day, a new allowance"
    other = uuid.UUID(int=0xB)
    ledger.release(TENANT)
    ledger.add_chars(other, 50)
    assert ledger.admit(other) == "daily_limit" and ledger.chars_left(other) == 0


# ---- Ask as the strong tier ------------------------------------------------------------------------------------------------------------------------


def ask_stream(blocks: list[str]) -> Callable[[uuid.UUID, uuid.UUID, str], Any]:
    def open_stream(conversation_id: uuid.UUID, message_id: uuid.UUID, text: str) -> Any:
        return iter(blocks)

    return open_stream


@arun
async def test_ask_answers_are_spoken_short_with_the_rest_and_the_sources_on_the_screen() -> None:
    seen: list[tuple[str, dict[str, Any]]] = []
    long_answer = "The saree costs 2,600 rupees. " + "More detail follows here. " * 40
    blocks = [sse("step", {"type": "step", "step": "looking"}), sse("text", {"type": "text", "delta": long_answer}), sse("source", {"type": "source", "kind": "item", "id": "x"}), sse("done", {"type": "done"})]
    llm = AskLlm(AskTurns(ask_stream(blocks)), lambda k, d: seen.append((k, d)), limit=40)
    spoken = [p async for p in llm.stream("", [{"role": "user", "content": "price of saree?"}], "ask")]
    assert spoken == ["The saree costs 2,600 rupees."]
    kinds = [k for k, _ in seen]
    assert kinds == ["step", "source", "caption", "caption", "reply"], "(job EA) a plain answer ends with the typed reply"
    assert seen[2][1]["spoken"] is True and seen[3][1]["spoken"] is False


@arun
async def test_an_ask_refusal_is_shown_and_nothing_is_said() -> None:
    seen: list[tuple[str, dict[str, Any]]] = []
    blocks = [sse("error", {"type": "error", "code": "budget", "message": "The AI is resting until tomorrow."})]
    llm = AskLlm(AskTurns(ask_stream(blocks)), lambda k, d: seen.append((k, d)))
    assert [p async for p in llm.stream("", [{"role": "user", "content": "x"}], "ask")] == []
    assert seen[0][0] == "error" and seen[0][1]["code"] == "budget"


@arun
async def test_the_fast_tier_shows_what_it_says_as_captions() -> None:
    seen: list[tuple[str, dict[str, Any]]] = []
    llm = CaptionLlm(FakeLlm(("We open at nine. ", "Come any time.")), lambda k, d: seen.append((k, d)))
    assert "".join([p async for p in llm.stream("", [], "m")]) == "We open at nine. Come any time."
    assert [d["text"] for _, d in seen] == ["We open at nine. ", "Come any time."] and all(k == "caption" and d["spoken"] for k, d in seen)


@arun
async def test_the_router_models_pick_the_tier() -> None:
    fast, ask = FakeLlm(("ok. ",)), FakeLlm(("from ask. ",))
    asked: list[int] = []
    tiered = TieredLlm(fast, ask, lambda: asked.append(1))
    assert [p async for p in tiered.stream("", [], "claude-haiku-5-5")] == ["ok. "]
    assert [p async for p in tiered.stream("", [], "ask")] == ["from ask. "] and asked == [1]


# ---- the session against a fake socket --------------------------------------------------------------------------------------------------------------


class FakeSocket:
    def __init__(self) -> None:
        self.inbox: asyncio.Queue[tuple[Kind, Any]] = asyncio.Queue()
        self.json: list[dict[str, Any]] = []
        self.audio: list[tuple[float, bytes]] = []
        self.stop_times: list[float] = []

    async def send_json(self, message: dict[str, Any]) -> None:
        self.json.append(message)
        if message.get("type") == "audio_stop":
            self.stop_times.append(time.perf_counter())

    async def send_bytes(self, data: bytes) -> None:
        self.audio.append((time.perf_counter(), data))

    async def receive(self) -> tuple[Kind, Any]:
        return await self.inbox.get()

    def feed_speech(self, speech_ms: int = 600, quiet_ms: int = 600) -> None:
        for _ in range(speech_ms // 20):
            self.inbox.put_nowait(("bytes", tone(20)))
        for _ in range(quiet_ms // 20):
            self.inbox.put_nowait(("bytes", silence(20)))

    def types(self) -> list[str]:
        return [m["type"] for m in self.json]


def fake_parts(llm: Any = None, tts: Any = None, greeting: str | None = None, model: str = "fast-model") -> Parts:
    return Parts(
        stt_for=lambda language: FakeStt("what time do you open?", silence_ms=300),
        tts=tts or FakeTts(chunks=3, chunk_ms=100),
        llm=llm or FakeLlm(("We open at nine. ", "Come any time.")),
        system_for=lambda language: "system",
        greeting_for=lambda language: greeting,
        models={"fast": model, "strong": "ask"},
    )


def session_of(sock: FakeSocket, parts: Parts, limits: Limits | None = None, ledger: Ledger | None = None, usage: Usage | None = None) -> VoiceSession:
    lim = limits or Limits(greeting=False)
    return VoiceSession(sock, parts, tenant_id=TENANT, user_id=USER, language="en", limits=lim, ledger=ledger or Ledger(lim), usage=usage or Usage())


async def until(predicate: Callable[[], bool], seconds: float = 3.0) -> None:
    end = time.perf_counter() + seconds
    while not predicate():
        assert time.perf_counter() < end, "timed out"
        await asyncio.sleep(0.01)


@arun
async def test_a_turn_is_heard_answered_aloud_captioned_and_counted() -> None:
    sock, usage = FakeSocket(), Usage()
    session = session_of(sock, fake_parts(), usage=usage)
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: "timings" in sock.types())
    sock.inbox.put_nowait(("close", None))
    assert await run == "client"
    ready = sock.json[0]
    assert ready["type"] == "ready" and ready["audio_in"]["sample_rate"] == 16000 and ready["audio_out"]["sample_rate"] == 24000
    captions = [(m["who"], m["text"]) for m in sock.json if m["type"] == "caption"]
    assert ("user", "what time do you open?") in captions
    assert sock.audio, "the answer was sent as binary audio"
    assert "audio_end" in sock.types()
    assert usage.turns == 1 and usage.chars() > 0 and usage.stt_seconds > 0.5
    timing = next(m for m in sock.json if m["type"] == "timings")
    assert timing["tier"] == "fast" and timing["after_final_ms"] is not None and timing["interrupted"] is False


@arun
async def test_barge_in_stops_the_voice_and_the_model_within_200_ms() -> None:
    sock = FakeSocket()
    llm = FakeLlm(("A long answer, ", "that keeps going, ", "and going. "), gap=0.2)
    tts = FakeTts(chunks=20, chunk_ms=100, chunk_gap=0.05)
    session = session_of(sock, fake_parts(llm=llm, tts=tts))
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: len(sock.audio) >= 2)
    asked_at = time.perf_counter()
    sock.inbox.put_nowait(("text", {"type": "barge_in"}))
    await until(lambda: "interrupted" in sock.types())
    assert sock.stop_times and sock.stop_times[0] - asked_at < 0.2
    interrupted = next(m for m in sock.json if m["type"] == "interrupted")
    assert interrupted["ms"] < 200
    sent_after = len(sock.audio)
    await asyncio.sleep(0.3)
    assert len(sock.audio) == sent_after, "no more audio of the old answer after the stop"
    assert llm.cancelled
    sock.inbox.put_nowait(("close", None))
    await run
    assert session.usage.interrupts == 1


@arun
async def test_a_barge_in_while_nothing_plays_is_harmless() -> None:
    sock = FakeSocket()
    session = session_of(sock, fake_parts())
    run = asyncio.ensure_future(session.run())
    sock.inbox.put_nowait(("text", {"type": "barge_in"}))
    await until(lambda: "interrupted" in sock.types())
    assert next(m for m in sock.json if m["type"] == "interrupted")["ms"] == 0
    sock.inbox.put_nowait(("close", None))
    await run


@arun
async def test_the_session_has_a_hard_length() -> None:
    sock = FakeSocket()
    session = session_of(sock, fake_parts(), limits=Limits(session_seconds=1, greeting=False))
    assert await asyncio.wait_for(session.run(), timeout=5) == "session"
    assert {"type": "limit", "reason": "session", "fatal": True} in sock.json


@arun
async def test_the_days_talking_time_ends_a_session() -> None:
    sock = FakeSocket()
    limits = Limits(day_seconds=1, greeting=False)
    ledger = Ledger(limits)
    session = session_of(sock, fake_parts(), limits=limits, ledger=ledger)
    assert await asyncio.wait_for(session.run(), timeout=6) == "daily_limit"
    assert ledger.admit(TENANT) == "daily_limit"


@arun
async def test_the_greeting_is_the_opening_line_and_barge_in_cuts_it() -> None:
    sock = FakeSocket()
    tts = FakeTts(chunks=30, chunk_ms=100, chunk_gap=0.05)
    session = session_of(sock, fake_parts(tts=tts, greeting="Hello, this is Vijaya from Tenant A."), limits=Limits(greeting=True))
    run = asyncio.ensure_future(session.run())
    await until(lambda: len(sock.audio) >= 2)
    assert ("assistant", "Hello, this is Vijaya from Tenant A.") in [(m["who"], m["text"]) for m in sock.json if m["type"] == "caption"]
    sock.inbox.put_nowait(("text", {"type": "barge_in"}))
    await until(lambda: "interrupted" in sock.types())
    sock.inbox.put_nowait(("close", None))
    await run
    assert tts.characters == len("Hello, this is Vijaya from Tenant A.")


@arun
async def test_the_language_can_change_between_turns() -> None:
    sock = FakeSocket()
    seen: list[str] = []
    parts = fake_parts()

    def remember(language: str) -> str:
        seen.append(language)
        return "system"

    parts.system_for = remember
    session = session_of(sock, parts)
    run = asyncio.ensure_future(session.run())
    sock.inbox.put_nowait(("text", {"type": "set_language", "language": "hi"}))
    sock.inbox.put_nowait(("text", {"type": "set_language", "language": "xx"}))  # unknown: ignored
    await until(lambda: {"type": "language", "language": "hi"} in sock.json)
    assert seen[-1] == "hi" and session.language == "hi"
    sock.inbox.put_nowait(("close", None))
    await run


@arun
async def test_a_failing_model_is_an_error_message_not_a_dead_session() -> None:
    class Broken:
        async def stream(self, system: str, messages: list[dict[str, str]], model: str):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")
            yield ""

    sock = FakeSocket()
    session = session_of(sock, fake_parts(llm=Broken()))
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: any(m["type"] == "error" for m in sock.json))
    err = next(m for m in sock.json if m["type"] == "error")
    assert err["fatal"] is False and "boom" not in json.dumps(sock.json)
    sock.inbox.put_nowait(("close", None))
    await run
    assert session.usage.errors == 1


def test_the_usage_line_has_ids_and_numbers_only(caplog: pytest.LogCaptureFixture) -> None:
    sock = FakeSocket()
    usage = Usage()

    async def go() -> None:
        session = session_of(sock, fake_parts(), usage=usage)
        run = asyncio.ensure_future(session.run())
        sock.feed_speech()
        await until(lambda: "timings" in sock.types())
        sock.inbox.put_nowait(("close", None))
        await run

    with caplog.at_level("INFO", logger="app.browser_voice"):
        asyncio.run(go())
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("browser_voice_usage"))
    assert f"tenant={TENANT}" in line and "stt_seconds=" in line and "chars_" in line and "turns=1" in line
    assert "what time" not in caplog.text and "We open" not in caplog.text


# ---- the route -------------------------------------------------------------------------------------------------------------------------------------


def bv_of(limits: Limits | None = None) -> BrowserVoice:
    lim = limits or Limits(greeting=False)
    return BrowserVoice(config=default_config(), factory=lambda choice, language: FakeTts(), sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=lim, ledger=Ledger(lim), allowed_origins=("https://staging.stack19.com",), client=httpx.AsyncClient())


def token_of(user: str) -> str:
    return auth(user)["Authorization"].split(" ", 1)[1]


def first_fatal(ws: Any) -> tuple[dict[str, Any], int]:
    message = ws.receive_json()
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    return message, closed.value.code


def test_the_route_is_off_until_it_is_configured() -> None:
    client, _ = make_client()
    with client.websocket_connect(f"/v1/tenants/{TENANT_A.id}/voice-chat") as ws:
        message, code = first_fatal(ws)
    assert message["code"] == "unavailable" and message["fatal"] is True and code == 4503


def test_no_start_message_no_token_a_bad_token_a_stranger_and_a_viewer_are_all_refused() -> None:
    client, _ = make_client(browser_voice=bv_of())
    url = f"/v1/tenants/{TENANT_A.id}/voice-chat"
    with client.websocket_connect(url) as ws:
        ws.send_json({"type": "hello"})
        assert first_fatal(ws)[1] == 4401
    with client.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": "not.a.token"})
        assert first_fatal(ws) [1] == 4401
    with client.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": token_of("outsider")})
        assert first_fatal(ws)[1] == 4404
    with client.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": token_of("a_viewer")})
        assert first_fatal(ws)[1] == 4403
    with client.websocket_connect("/v1/tenants/not-a-uuid/voice-chat") as ws:
        ws.send_json({"type": "start", "access_token": token_of("a_owner")})
        assert first_fatal(ws)[1] == 4404


def test_a_foreign_origin_is_refused() -> None:
    client, _ = make_client(browser_voice=bv_of())
    with client.websocket_connect(f"/v1/tenants/{TENANT_A.id}/voice-chat", headers={"origin": "https://evil.example"}) as ws:
        message, code = first_fatal(ws)
    assert message["code"] == "forbidden" and code == 4403


def test_a_member_talks_and_hears_the_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bv_routes, "build_parts", lambda bv, runtime, ctx, emit, on_ask: fake_parts())
    bv = bv_of()
    client, _ = make_client(browser_voice=bv)
    with client.websocket_connect(f"/v1/tenants/{TENANT_A.id}/voice-chat", headers={"origin": "https://staging.stack19.com"}) as ws:
        ws.send_json({"type": "start", "access_token": token_of("a_sales"), "language": "te"})
        assert ws.receive_json()["type"] == "ready"
        for _ in range(30):
            ws.send_bytes(tone(20))
        for _ in range(30):
            ws.send_bytes(silence(20))
        got_audio, got_timings = False, False
        for _ in range(60):
            message = ws.receive()
            if message.get("bytes"):
                got_audio = True
            elif message.get("text") and json.loads(message["text"])["type"] == "timings":
                got_timings = True
                break
        ws.send_json({"type": "stop"})
    assert got_audio and got_timings
    assert bv.ledger.admit(TENANT_A.id) is None, "the workspace is free again once the session ended"


def test_a_second_session_of_the_same_workspace_is_busy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bv_routes, "build_parts", lambda bv, runtime, ctx, emit, on_ask: fake_parts())
    client, _ = make_client(browser_voice=bv_of())
    url = f"/v1/tenants/{TENANT_A.id}/voice-chat"
    with client.websocket_connect(url) as first:
        first.send_json({"type": "start", "access_token": token_of("a_owner")})
        assert first.receive_json()["type"] == "ready"
        with client.websocket_connect(url) as second:
            second.send_json({"type": "start", "access_token": token_of("a_admin")})
            message, code = first_fatal(second)
        assert message["code"] == "busy" and code == 4429
        first.send_json({"type": "stop"})


def test_the_latency_script_reads_percentiles_like_the_reports() -> None:
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[3] / "scripts" / "browser_voice_latency.py"
    spec = importlib.util.spec_from_file_location("bv_latency", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    import sys

    sys.path.insert(0, str(path.parent))
    spec.loader.exec_module(module)
    values = [float(v) for v in range(100, 1100, 100)]
    assert module.percentile(values, 50) == 500.0 and module.percentile(values, 95) == 1000.0 and module.percentile([42.0], 95) == 42.0


def test_the_fast_tiers_prompt_builds_for_every_language_of_the_browser_voice() -> None:
    """Found on staging: the prompt was given a language NAME and the register block refused it; the route tests had replaced the parts builder, so nothing exercised this."""
    from app.browser_voice.routes import system_prompt
    from app.browser_voice.session import LANGUAGES

    for language in LANGUAGES:
        for mention in (True, False):
            text = system_prompt(business="Tenant A", assistant="Vijaya", language=language, opening_line="Hello from Tenant A.", mention_ai=mention)
            assert "Tenant A" in text and "Hello from Tenant A." in text and "HOW TO SOUND ON A CALL" in text
    assert "Speak Telugu." in system_prompt(business="B", assistant="V", language="te", opening_line="x", mention_ai=True)


def test_the_real_parts_builder_works_for_a_workspace_in_every_language() -> None:
    """build_parts with a stand-in workspace (the opening line, the voice choices): the greeting, the prompt and the tiers are made without a network."""
    from types import SimpleNamespace

    from app.auth.deps import TenantContext
    from app.auth.jwt import Principal
    from app.browser_voice.routes import build_parts
    from app.tenancy.models import Role

    workspace = SimpleNamespace(
        voice_choices=lambda token, tenant: {"choices": {"te": "te-sindhu"}},
        opening=lambda token, tenant: {"mention_ai": True, "lines": [], "campaign_overrides": []},
    )
    runtime = SimpleNamespace(workspace=workspace, assistant_settings=None)
    ctx = TenantContext(principal=Principal(user_id=USER, token="t"), tenant=TENANT_A, role=Role.OWNER)
    parts = build_parts(bv_of(), runtime, ctx, lambda kind, data: None, lambda: None)  # type: ignore[arg-type]
    for language in ("te", "en", "hi", "kn"):
        assert "Tenant A" in parts.system_for(language) and parts.greeting_for(language)
    assert parts.voice_for("te") == "te-sindhu" and parts.voice_for("en") == "en-janvi" and parts.voice_for("hi") == "hi-sanya", "the filler bank is keyed by the catalogue voice that speaks each language"
    assert parts.models["strong"] == "ask" and parts.models["fast"] == "m"

# ---- durable daily caps (follow-up) ----------------------------------------------------------------------------------------------------------------


class FakeStore:
    """The two database functions, in memory, with the same bounds."""

    def __init__(self) -> None:
        self.seconds, self.chars, self.sessions = 0, 0, 0
        self.adds: list[tuple[int, int, int]] = []
        self.fail = False

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("down")
        return {"seconds": self.seconds, "tts_chars": self.chars, "sessions": self.sessions}

    def add(self, token: str, tenant_id: uuid.UUID, seconds: int, chars: int, sessions: int) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("down")
        assert 0 <= seconds <= 600 and 0 <= chars <= 6000 and 0 <= sessions <= 1
        self.adds.append((seconds, chars, sessions))
        self.seconds, self.chars, self.sessions = self.seconds + seconds, self.chars + chars, self.sessions + sessions
        return self.get(token, tenant_id)


def test_two_instances_share_one_count_through_the_database() -> None:
    store = FakeStore()
    limits = Limits(day_seconds=100, day_tts_chars=1000)
    a, b = Ledger(limits, store), Ledger(limits, store)
    assert a.admit(TENANT, "t") is None
    a.add_seconds(TENANT, 70)
    a.add_chars(TENANT, 400)
    a.flush(TENANT, "t")
    assert store.seconds == 70 and store.chars == 400 and store.sessions == 1
    assert b.admit(TENANT, "t") is None, "70 of 100 seconds used: another instance still admits"
    b.add_seconds(TENANT, 40)
    b.flush(TENANT, "t")
    assert store.seconds == 110
    a.release(TENANT)
    assert a.admit(TENANT, "t") == "daily_limit", "the first instance reads the other's use before it admits"


def test_a_long_backlog_goes_to_the_database_in_bounded_pieces() -> None:
    store = FakeStore()
    ledger = Ledger(Limits(day_seconds=100000, day_tts_chars=100000), store)
    ledger.add_seconds(TENANT, 1500)
    ledger.add_chars(TENANT, 13000)
    ledger.flush(TENANT, "t")
    assert sum(a[0] for a in store.adds) == 1500 and sum(a[1] for a in store.adds) == 13000 and all(a[0] <= 600 and a[1] <= 6000 for a in store.adds)


def test_a_database_that_is_down_never_stops_a_session_and_nothing_is_lost() -> None:
    store = FakeStore()
    ledger = Ledger(Limits(day_seconds=100, day_tts_chars=1000), store)
    store.fail = True
    assert ledger.admit(TENANT, "t") is None, "memory carries on"
    ledger.add_seconds(TENANT, 30)
    ledger.flush(TENANT, "t")
    assert store.seconds == 0 and ledger.seconds_left(TENANT) == 70
    store.fail = False
    ledger.flush(TENANT, "t")
    assert store.seconds == 30 and store.sessions == 1, "the unwritten numbers went in on the next try"


def test_the_store_calls_the_two_database_functions_with_the_members_token() -> None:
    from app.browser_voice.store import PostgrestUsageStore

    calls: list[tuple[str, str, dict[str, Any]]] = []

    class Rpc:
        def object(self, token: str, name: str, params: dict[str, Any]) -> dict[str, Any]:
            calls.append((token, name, params))
            return {}

    store = PostgrestUsageStore("http://x", "k", rpc=Rpc())  # type: ignore[arg-type]
    store.get("tok", TENANT)
    store.add("tok", TENANT, 5, 7, 1)
    assert calls == [("tok", "browser_voice_usage_get", {"p_tenant_id": str(TENANT)}), ("tok", "browser_voice_usage_add", {"p_tenant_id": str(TENANT), "p_seconds": 5, "p_chars": 7, "p_sessions": 1})]


# ---- the filler bank (follow-up) --------------------------------------------------------------------------------------------------------------------


def test_every_catalogue_voice_has_its_pre_rendered_one_moment_lines() -> None:
    from app.conversation.fillers import BANK_LINES, FillerBank

    cfg, bank = default_config(), FillerBank.from_disk(seed=1)
    for voice in cfg.catalogue.values():
        audio = bank._audio.get((voice.language, voice.id))  # noqa: SLF001
        assert audio is not None, f"no filler lines rendered for {voice.id}"
        assert list(audio) == list(BANK_LINES[voice.language]) and 3 <= len(audio) <= 4
        for text, pcm in audio.items():
            seconds = len(pcm) / 2 / 24000
            assert len(pcm) % 2 == 0 and 0.8 <= seconds <= 3.5, f"{voice.id}: '{text}' is {seconds:.1f} s"
    assert "ఒక్క నిమిషం అండీ, check చేసి చెప్తాను." in BANK_LINES["te"], "the approved Telugu wording of native-lines/te.md"


def test_the_filler_never_repeats_twice_in_a_row() -> None:
    from app.conversation.fillers import FillerBank

    bank = FillerBank.from_disk(seed=3)
    picks = [bank.pick("en", "en-janvi")[0] for _ in range(12)]  # type: ignore[index]
    assert all(a != b for a, b in zip(picks, picks[1:], strict=False))


@arun
async def test_when_ask_is_slow_a_filler_in_the_chosen_voice_is_said_after_700_ms() -> None:
    from app.conversation.fillers import FillerBank

    bank = FillerBank.from_disk(seed=2)
    sock = FakeSocket()
    parts = fake_parts(llm=FakeLlm(("Here is the answer. ",), first_token_delay=1.3))
    parts.fillers = bank
    parts.voice_for = lambda language: {"en": "en-janvi"}.get(language, "")
    session = session_of(sock, parts)
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: "timings" in sock.types(), seconds=6)
    sock.inbox.put_nowait(("close", None))
    await run
    lengths = {len(pcm) for pcm in bank._audio[("en", "en-janvi")].values()}  # noqa: SLF001
    sent = [len(b) for _, b in sock.audio]
    assert sent[0] in lengths, "the first audio the browser got was a filler line, not silence"
    timing = next(m for m in sock.json if m["type"] == "timings")
    assert timing["after_final_ms"] is not None and timing["first_sound_ms"] < timing["after_final_ms"] + 1500
