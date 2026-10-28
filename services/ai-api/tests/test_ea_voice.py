"""Job EA on the voice socket: interim transcripts at most every 250 ms, the same router as the written chat (an `intent` message), a plan said aloud and shown after it, the owner's yes or no (buttons or voice), and a clarifying
question. Fakes only: no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from typing import Any

from app.browser_voice.llm import AskLlm, AskTurns
from app.browser_voice.session import Parts, VoiceSession
from app.conversation.fakes import FakeLlm, FakeStt, FakeTts
from app.conversation.parts import SttEvent
from app.errors import ApiError
from tests.test_dv_browser_voice import FakeSocket, arun, fake_parts, session_of, sse, until

ACTION = uuid.UUID(int=0xBEEF)


def has(sock: FakeSocket, *types: str) -> Callable[[], bool]:
    return lambda: all(t in sock.types() for t in types)


def card(**extra: Any) -> dict[str, Any]:
    return {"type": "confirm_action", "action_id": str(ACTION), "status": "proposed", "title": "Call the new leads", "summary": "Call the new leads. That is 12 people, by phone call. Shall I go ahead?",
            "steps": ["Who: 12 people"], "count": 12, "channel": "call", "estimate": None, "needs_second_factor": False, "can_confirm": True, "expires_at": "2026-10-29T00:00:00Z", **extra}


def ask_blocks(*extra_events: str) -> Any:
    def open_stream(conversation: uuid.UUID, message: uuid.UUID, text: str) -> Any:
        return iter([sse("text", {"type": "text", "delta": "Call the new leads. That is 12 people, by phone call. Shall I go ahead?"}), *extra_events])

    return open_stream


# ---- interim transcripts
@arun
async def test_interim_transcripts_come_at_most_every_250_ms_newest_first_and_never_twice() -> None:
    sock = FakeSocket()
    session = session_of(sock, fake_parts())
    for text in ("wh", "wha", "what", "what time", "what time"):
        session._on_stt(SttEvent("partial", text))   # noqa: SLF001
        await asyncio.sleep(0.03)
    await asyncio.sleep(0.4)
    session._on_stt(SttEvent("partial", "what time do"))   # noqa: SLF001
    await asyncio.sleep(0.05)
    session._on_stt(SttEvent("final", "what time do you open"))   # noqa: SLF001
    await asyncio.sleep(0.05)
    sent = [m for m in sock.json if m["type"] == "transcript"]
    interim = [m for m in sent if not m["final"]]
    assert [m["text"] for m in interim][0] == "wh", "the first partial goes out at once"
    assert [m["text"] for m in interim][1] == "what time", "the window collects the newest, not every one"
    assert len({m["text"] for m in interim}) == len(interim), "never the same text twice"
    assert [m["seq"] for m in sent] == sorted(m["seq"] for m in sent) and len({m["seq"] for m in sent}) == len(sent)
    assert sent[-1] == {**sent[-1], "text": "what time do you open", "final": True}, "ONE final with the settled words"
    assert sum(1 for m in sent if m["final"]) == 1
    gaps = [b["t_ms"] - a["t_ms"] for a, b in zip(interim, interim[1:], strict=False)]
    assert all(g >= 230 for g in gaps[:1]), gaps
    captions = [m for m in sock.json if m["type"] == "caption" and m["who"] == "user"]
    assert captions and captions[-1]["final"] is True, "the caption messages of existing clients still come"


@arun
async def test_a_new_utterance_starts_its_own_clock() -> None:
    sock = FakeSocket()
    session = session_of(sock, fake_parts())
    session._on_stt(SttEvent("partial", "one"))   # noqa: SLF001
    session._on_stt(SttEvent("final", "one two"))   # noqa: SLF001
    await asyncio.sleep(0.05)
    session._on_stt(SttEvent("partial", "three"))   # noqa: SLF001
    await asyncio.sleep(0.05)
    sent = [m for m in sock.json if m["type"] == "transcript"]
    assert sent[-1]["text"] == "three" and sent[-1]["t_ms"] < 100


# ---- the router
@arun
async def test_the_voice_uses_the_same_router_and_says_what_it_decided() -> None:
    for words, kind, tier in (("how are you", "smalltalk", "fast"), ("what is a margin", "general", "fast"), ("how many enquiries today", "business", "strong"), ("call the new leads", "action", "strong")):
        sock = FakeSocket()
        parts = fake_parts()
        parts.stt_for = lambda language, w=words: FakeStt(w, silence_ms=300)   # type: ignore[misc]
        session = session_of(sock, parts)
        run = asyncio.ensure_future(session.run())
        sock.feed_speech()
        await until(has(sock, "timings"))
        sock.inbox.put_nowait(("close", None))
        await run
        intent = next(m for m in sock.json if m["type"] == "intent")
        timing = next(m for m in sock.json if m["type"] == "timings")
        assert intent["kind"] == kind and timing["tier"] == tier, (words, intent, timing)
        assert sock.types().index("intent") < sock.types().index("audio_end"), "the intent comes before the answer"


# ---- a plan, said aloud and shown after it
@arun
async def test_a_plan_is_spoken_then_shown_and_the_next_yes_or_no_is_heard() -> None:
    seen: list[tuple[str, dict[str, Any]]] = []
    ask = AskLlm(AskTurns(ask_blocks(sse("confirm_action", card()), sse("done", {"type": "done", "kind": "confirm_action"}))), lambda k, d: seen.append((k, d)))
    spoken = [p async for p in ask.stream("", [{"role": "user", "content": "call the new leads"}], "ask")]
    assert spoken == ["Call the new leads. That is 12 people, by phone call. Shall I go ahead?"]
    assert [k for k, _ in seen] == ["caption", "confirm_action"], "the plan card follows the spoken plan"
    assert "type" not in seen[1][1] and seen[1][1]["action_id"] == str(ACTION)
    assert not any(k == "reply" for k, _ in seen), "a plan is not a plain answer"


@arun
async def test_a_clarifying_question_is_spoken_then_sent() -> None:
    seen: list[tuple[str, dict[str, Any]]] = []
    ask = AskLlm(AskTurns(lambda c, m, t: iter([sse("text", {"type": "text", "delta": "Which leads: new or old?"}), sse("clarify", {"type": "clarify", "question": "Which leads: new or old?", "action_id": str(ACTION)}), sse("done", {"type": "done", "kind": "clarify"})])), lambda k, d: seen.append((k, d)))
    assert [p async for p in ask.stream("", [{"role": "user", "content": "call"}], "ask")] == ["Which leads: new or old?"]
    assert [k for k, _ in seen] == ["caption", "clarify"] and seen[1][1] == {"question": "Which leads: new or old?", "action_id": str(ACTION)}


@arun
async def test_the_session_remembers_a_waiting_plan_and_the_buttons_answer_it() -> None:
    calls: list[tuple[uuid.UUID, str]] = []

    def confirm(action_id: uuid.UUID, decision: str) -> dict[str, Any]:
        calls.append((action_id, decision))
        return {"action_id": str(action_id), "status": "confirmed", "task": {"id": str(action_id), "status": "approved"}}

    sock = FakeSocket()
    parts = fake_parts()
    parts.confirm = confirm
    session = session_of(sock, parts)
    session.emit("confirm_action", card())
    assert session.pending_action == ACTION
    run = asyncio.ensure_future(session.run())
    sock.inbox.put_nowait(("text", {"type": "confirm", "action_id": str(ACTION), "decision": "yes"}))
    await until(lambda: "action" in sock.types())
    sock.inbox.put_nowait(("close", None))
    await run
    assert calls == [(ACTION, "yes")] and session.pending_action is None
    action = next(m for m in sock.json if m["type"] == "action")
    assert action["status"] == "confirmed" and action["action_id"] == str(ACTION) and action["task"]["status"] == "approved"


@arun
async def test_a_spoken_yes_or_no_answers_the_waiting_plan_and_nothing_else_runs() -> None:
    for said, decision in (("yes", "yes"), ("no", "no")):
        calls: list[tuple[uuid.UUID, str]] = []

        def confirm(action_id: uuid.UUID, d: str, calls: list[tuple[uuid.UUID, str]] = calls) -> dict[str, Any]:
            calls.append((action_id, d))
            return {"action_id": str(action_id), "status": "confirmed" if d == "yes" else "declined", "task": None}

        sock = FakeSocket()
        parts = fake_parts(llm=FakeLlm(("SHOULD NOT BE SAID. ",)))
        parts.stt_for = lambda language, w=said: FakeStt(w, silence_ms=300)   # type: ignore[misc]
        parts.confirm = confirm
        session = session_of(sock, parts)
        session.emit("confirm_action", card())
        run = asyncio.ensure_future(session.run())
        sock.feed_speech()
        await until(has(sock, "action", "audio_end"))
        sock.inbox.put_nowait(("close", None))
        await run
        assert calls == [(ACTION, decision)], said
        assert "timings" not in sock.types(), "no model turn ran: the yes was the answer to the plan"
        assert not any("SHOULD NOT" in str(m.get("text", "")) for m in sock.json)


@arun
async def test_the_second_factor_is_asked_for_and_the_plan_stays_waiting() -> None:
    def confirm(action_id: uuid.UUID, decision: str) -> dict[str, Any]:
        raise ApiError(403, "mfa_required", "Confirm with your authenticator app.")

    sock = FakeSocket()
    parts = fake_parts()
    parts.confirm = confirm
    session = session_of(sock, parts)
    session.emit("confirm_action", card(needs_second_factor=True))
    run = asyncio.ensure_future(session.run())
    sock.inbox.put_nowait(("text", {"type": "confirm", "action_id": str(ACTION), "decision": "yes"}))
    await until(lambda: any(m["type"] == "error" for m in sock.json))
    sock.inbox.put_nowait(("close", None))
    await run
    err = next(m for m in sock.json if m["type"] == "error")
    assert err["code"] == "mfa_required" and err["fatal"] is False and session.pending_action == ACTION


@arun
async def test_a_confirm_without_the_hook_or_with_a_bad_id_is_a_plain_error() -> None:
    sock = FakeSocket()
    session = session_of(sock, fake_parts())
    run = asyncio.ensure_future(session.run())
    sock.inbox.put_nowait(("text", {"type": "confirm", "action_id": str(ACTION), "decision": "yes"}))
    sock.inbox.put_nowait(("text", {"type": "confirm", "action_id": "nonsense", "decision": "yes"}))
    await until(lambda: sum(1 for m in sock.json if m["type"] == "error") >= 2)
    sock.inbox.put_nowait(("close", None))
    await run
    assert [m["code"] for m in sock.json if m["type"] == "error"] == ["not_available", "validation_error"]


@arun
async def test_the_parts_have_a_confirm_hook_slot() -> None:
    assert Parts.__dataclass_fields__["confirm"].default is None
    assert VoiceSession is not None and FakeTts is not None
