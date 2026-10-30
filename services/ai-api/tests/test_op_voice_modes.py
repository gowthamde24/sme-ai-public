"""The three ways of talking to the assistant (owner, 30 Oct 2026): typed text, DICTATE (words only: live partials and a final transcript fill the text box; the assistant is never called, nothing is spoken, no turn is stored)
and LIVE TALK (hands-free: listens again after every spoken reply, barge-in cuts the voice, ends after about 30 s of silence or on stop). Typed, dictated and live turns are ONE conversation thread."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import patch

from app.browser_voice import session as session_module
from app.browser_voice.limits import Ledger, Limits, Usage
from app.browser_voice.llm import AskTurns
from app.browser_voice.session import Parts, VoiceSession
from app.conversation.fakes import FakeLlm, FakeTts
from tests.test_dv_browser_voice import TENANT, USER, FakeSocket, arun, fake_parts, until


def session_in(sock: FakeSocket, parts: Parts, **kw: Any) -> VoiceSession:
    limits = Limits(greeting=False)
    return VoiceSession(sock, parts, tenant_id=TENANT, user_id=USER, language="en", limits=limits, ledger=Ledger(limits), usage=Usage(), **kw)


class CountingLlm(FakeLlm):
    def __init__(self) -> None:
        super().__init__(("Never called in dictate. ",))
        self.calls = 0

    async def stream(self, system: str, messages: list[dict[str, str]], model: str):  # type: ignore[no-untyped-def]
        self.calls += 1
        async for piece in super().stream(system, messages, model):
            yield piece


@arun
async def test_dictate_sends_words_only_and_never_calls_the_assistant_or_the_voice() -> None:
    sock, llm, tts = FakeSocket(), CountingLlm(), FakeTts(chunks=3, chunk_ms=100)
    parts = fake_parts(llm=llm, tts=tts, greeting="Hello there")
    session = session_in(sock, parts, mode="dictate")
    with patch.object(session_module, "DICTATE_SILENCE_S", 0.6):
        run = asyncio.ensure_future(session.run())
        sock.feed_speech()
        assert await asyncio.wait_for(run, timeout=6) == "idle", "four seconds (here 0.6) without a sound after a final transcript ends it"
    types = sock.types()
    assert sock.json[0]["type"] == "ready" and sock.json[0]["mode"] == "dictate"
    finals = [m for m in sock.json if m["type"] == "transcript" and m["final"]]
    assert [m["text"] for m in finals] == ["what time do you open?"], "the final transcript fills the text box"
    assert {"type": "limit", "reason": "idle", "fatal": True} in sock.json
    assert llm.calls == 0
    assert not sock.audio, "no audio is sent"
    assert not {"voice", "audio_end", "timings", "intent"} & set(types), "no voice, no turn, no router"
    assert not [m for m in sock.json if m["type"] == "caption" and m["who"] == "assistant"], "nothing from the assistant, not even the greeting"
    assert session.usage.turns == 0 and session.usage.chars() == 0 and session.usage.stt_seconds > 0.5, "only recognition seconds are used"


@arun
async def test_dictate_ends_on_stop_and_never_runs_longer_than_its_cap() -> None:
    sock = FakeSocket()
    session = session_in(sock, fake_parts(), mode="dictate")
    run = asyncio.ensure_future(session.run())
    sock.inbox.put_nowait(("text", {"type": "stop"}))
    assert await asyncio.wait_for(run, timeout=3) == "client"
    sock2 = FakeSocket()
    session2 = session_in(sock2, fake_parts(), mode="dictate")
    with patch.object(session_module, "DICTATE_MAX_S", 0.8):
        assert await asyncio.wait_for(session2.run(), timeout=4) == "idle", "silence for the whole cap ends it"
    assert {"type": "limit", "reason": "idle", "fatal": True} in sock2.json


@arun
async def test_dictate_keeps_listening_for_a_second_sentence_within_the_pause() -> None:
    sock = FakeSocket()
    session = session_in(sock, fake_parts(), mode="dictate")
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: len([m for m in sock.json if m["type"] == "transcript" and m["final"]]) >= 1)
    sock.feed_speech()
    await until(lambda: len([m for m in sock.json if m["type"] == "transcript" and m["final"]]) >= 2)
    sock.inbox.put_nowait(("close", None))
    await run


@arun
async def test_live_talk_listens_again_after_every_reply() -> None:
    sock = FakeSocket()
    session = session_in(sock, fake_parts())
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: sock.types().count("timings") >= 1)
    sock.feed_speech()
    await until(lambda: sock.types().count("timings") >= 2)
    sock.inbox.put_nowait(("text", {"type": "stop"}))
    assert await run == "client"
    assert session.usage.turns == 2


@arun
async def test_live_talk_ends_after_the_silence_limit() -> None:
    sock = FakeSocket()
    session = session_in(sock, fake_parts(), idle_s=0.5)
    assert await asyncio.wait_for(session.run(), timeout=4) == "idle"
    assert {"type": "limit", "reason": "idle", "fatal": True} in sock.json
    assert session_module.LIVE_IDLE_S == 30.0, "about 30 s by default"


@arun
async def test_in_one_thread_every_live_turn_goes_through_the_written_chats_turn() -> None:
    """one_thread: the router sends small talk too to the strong tier (the written chat's turn: its router, history and stored thread), and `ready` carries the thread id."""
    sock = FakeSocket()
    parts = fake_parts(model="fast-model")
    parts.one_thread, parts.conversation_id = True, "00000000-0000-4000-8000-000000000001"
    session = session_in(sock, parts)
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: "timings" in sock.types())
    sock.inbox.put_nowait(("close", None))
    await run
    assert sock.json[0]["conversation_id"] == "00000000-0000-4000-8000-000000000001"
    assert next(m for m in sock.json if m["type"] == "timings")["tier"] == "strong"


def test_the_voice_joins_the_thread_the_web_is_already_in() -> None:
    seen: list[uuid.UUID] = []

    def open_stream(conversation_id: uuid.UUID, message_id: uuid.UUID, text: str) -> Any:
        seen.append(conversation_id)
        return iter(())

    thread = uuid.uuid4()
    joined = AskTurns(open_stream, thread)
    joined.open("hello")
    joined.open("and again")
    assert seen == [thread, thread] and joined.conversation_id == thread
    assert AskTurns(open_stream).conversation_id != thread, "without an id a new conversation starts"


def test_the_start_message_takes_a_conversation_id_and_refuses_a_bad_one() -> None:
    from tests.fakes import TENANT_A, make_client
    from tests.test_dv_browser_voice import bv_of, first_fatal, token_of

    client, _ = make_client(browser_voice=bv_of())
    with client.websocket_connect(f"/v1/tenants/{TENANT_A.id}/voice-chat") as ws:
        ws.send_json({"type": "start", "access_token": token_of("a_owner"), "mode": "dictate", "conversation_id": "not-a-uuid"})
        message, code = first_fatal(ws)
    assert message["code"] == "validation_error" and message["fatal"] is True and code == 4400


def test_the_real_parts_join_the_given_thread_and_use_the_written_chats_turn() -> None:
    from types import SimpleNamespace

    from app.auth.deps import TenantContext
    from app.auth.jwt import Principal
    from app.browser_voice.routes import build_parts
    from app.tenancy.models import Role
    from tests.fakes import TENANT_A
    from tests.test_dv_browser_voice import bv_of

    workspace = SimpleNamespace(voice_choices=lambda token, tenant: {"choices": {}}, opening=lambda token, tenant: {"mention_ai": True, "lines": [], "campaign_overrides": []})
    runtime = SimpleNamespace(workspace=workspace, assistant_settings=None)
    ctx = TenantContext(principal=Principal(user_id=USER, token="t"), tenant=TENANT_A, role=Role.OWNER)
    thread = uuid.uuid4()
    parts = build_parts(bv_of(), runtime, ctx, lambda kind, data: None, lambda: None, thread)  # type: ignore[arg-type]
    assert parts.one_thread is True and parts.conversation_id == str(thread)
    assert build_parts(bv_of(), runtime, ctx, lambda kind, data: None, lambda: None).conversation_id != str(thread)  # type: ignore[arg-type]


def test_a_chosen_dictation_language_pins_the_recogniser_and_auto_detects_otherwise() -> None:
    from types import SimpleNamespace

    from app.auth.deps import TenantContext
    from app.auth.jwt import Principal
    from app.browser_voice.routes import build_parts
    from app.tenancy.models import Role
    from tests.fakes import TENANT_A
    from tests.test_dv_browser_voice import bv_of

    workspace = SimpleNamespace(voice_choices=lambda token, tenant: {"choices": {}}, opening=lambda token, tenant: {"mention_ai": True, "lines": [], "campaign_overrides": []})
    runtime = SimpleNamespace(workspace=workspace, assistant_settings=None)
    ctx = TenantContext(principal=Principal(user_id=USER, token="t"), tenant=TENANT_A, role=Role.OWNER)
    auto = build_parts(bv_of(), runtime, ctx, lambda kind, data: None, lambda: None).stt_for("te")  # type: ignore[arg-type]
    pinned = build_parts(bv_of(), runtime, ctx, lambda kind, data: None, lambda: None, None, "te").stt_for("en")  # type: ignore[arg-type]
    assert auto._language == "auto" and auto._mode == "transcribe"  # type: ignore[attr-defined]
    assert pinned._language == "te" and pinned._mode == "transcribe", "pinned to Telugu: native script from the first word (the mode follows the pinned language)"  # type: ignore[attr-defined]


def test_the_recogniser_mode_is_a_per_language_setting_with_the_owner_decided_defaults() -> None:
    from app.browser_voice.routes import STT_MODES, parse_stt_modes, stt_mode_for

    assert {language: stt_mode_for(language) for language in ("te", "kn", "en", "ta", "hi", "ml")} == {
        "te": "transcribe", "kn": "transcribe", "en": "transcribe", "ta": "transcribe", "hi": "verbatim", "ml": "verbatim",
    }
    assert parse_stt_modes("") == STT_MODES
    assert parse_stt_modes("hi=transcribe, ml = codemix")["hi"] == "transcribe" and parse_stt_modes("hi=transcribe, ml=codemix")["ml"] == "codemix"
    assert parse_stt_modes("xx=verbatim,te=nonsense,garbage") == STT_MODES, "an unknown language or mode is ignored"
    assert stt_mode_for("hi", {"hi": "transcribe"}) == "transcribe"
