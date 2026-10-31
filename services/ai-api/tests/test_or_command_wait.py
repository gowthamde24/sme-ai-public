"""Owner decision 31 Oct 2026: a finished-looking COMMAND waits 0.9 s for its quantity or name; a question or a chat never waits."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import time

import pytest

from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts, ScriptedStt, Segment
from app.conversation.parts import Session, TurnTimings
from app.conversation.pipeline import Conversation
from app.conversation.turntaking import COMMAND_HOLD_MS, completeness, is_command
from tests.test_oq_live_standard import Src

COMMANDS = [
    "Lakshmi gaariki coat pampinchu", "Repu podduna call cheyyi", "Ramesh ki call cheyyandi", "Lakshmi గారికి quote పంపించు", "రేపు పొద్దున కాల్ చేయి", "ఆ కస్టమర్లకు మెసేజ్ పంపండి", "రవికి మెసేజ్ చేయండి.",
    "send the quote to Ramesh", "call the new leads", "please message everyone who didn't pay", "Can you WhatsApp all pending customers", "remind Ramesh about the quote", "follow up with yesterday's leads", "forward this to Priya",
    "ರವಿಗೆ ಮೆಸೇಜ್ ಕಳುಹಿಸಿ", "ಹೊಸ ಲೀಡ್‌ಗಳಿಗೆ ಕಾಲ್ ಮಾಡಿ", "Ravi ki message kalisu",
]
NOT_COMMANDS = [
    "ఈరోజు కొత్త ఎంక్వైరీలు ఏమైనా వచ్చాయా?", "Who should I call first today?", "ఎవరికి ముందు కాల్ చేయాలి", "should I call Ravi", "how many quotes did we send", "Can you send the quote?", "what did Lakshmi say",
    "ఒక జోక్ చెప్పండి", "tell me a joke", "explain GST on sarees", "write a Diwali message", "hello", "thanks a lot", "ఈరోజు ఏవైనా కొత్తగా సజెషన్స్?", "Ramesh ki", "2000 square feet ki", "I want to", "", "   ", "send?",
]


@pytest.mark.parametrize("text", COMMANDS)
def test_these_are_commands(text: str) -> None:
    assert is_command(text, "te"), text


@pytest.mark.parametrize("text", NOT_COMMANDS)
def test_questions_and_chat_are_not_commands(text: str) -> None:
    assert not is_command(text, "te"), text


def test_every_command_example_looks_finished_to_the_text_rules() -> None:
    """(That is the point: the rules would hand these over at once; the wait is what the command rule adds.)"""
    finished = [t for t in COMMANDS if completeness(t, "te") == "complete"]
    assert len(finished) >= 12 and "Lakshmi gaariki coat pampinchu" in finished


def listen(segments: list[Segment], hold_ms: int) -> tuple[str | None, float, TurnTimings]:
    conv = Conversation(stt=ScriptedStt(segments, scale=1.0), llm=FakeLlm(("ok",)), tts=FakeTts(), playout=FakePlayout(rate=16000), session=Session(system="", language="te"), models={"fast": "f", "strong": "s"},
                        semantic_turns=True, command_hold_ms=hold_ms)
    tm = TurnTimings()
    began = time.perf_counter()
    text = asyncio.run(asyncio.wait_for(conv.listen(Src(), tm), 20))
    return text, time.perf_counter() - began, tm


def test_a_command_waits_and_takes_its_quantity_said_after_a_short_pause() -> None:
    pieces = [Segment("Lakshmi gaariki coat pampinchu", 300, 700), Segment("40 sarees", 300, 0)]
    text, _, tm = listen(pieces, COMMAND_HOLD_MS)
    assert text == "Lakshmi gaariki coat pampinchu 40 sarees" and tm.command_turn
    cut, _, tm_off = listen(pieces, 0)
    assert cut == "Lakshmi gaariki coat pampinchu" and not tm_off.command_turn, "with the wait off (before 31 Oct) the quantity was lost"


def test_a_command_with_nothing_more_is_handed_over_after_the_wait_and_a_question_at_once() -> None:
    command, took_command, tm = listen([Segment("Repu podduna call cheyyi", 300, 0)], COMMAND_HOLD_MS)
    assert command == "Repu podduna call cheyyi" and tm.command_turn and tm.held_ms >= 850 and took_command >= 0.85
    question, took_question, tm_q = listen([Segment("ఈరోజు కొత్త ఎంక్వైరీలు ఏమైనా వచ్చాయా?", 300, 0)], COMMAND_HOLD_MS)
    assert question and not tm_q.command_turn and tm_q.held_ms == 0 and took_question < took_command - 0.7, "a question gets no added delay"
    chat, took_chat, tm_c = listen([Segment("tell me a joke", 300, 0)], COMMAND_HOLD_MS)
    assert chat and not tm_c.command_turn and tm_c.held_ms == 0 and took_chat < took_command - 0.7
