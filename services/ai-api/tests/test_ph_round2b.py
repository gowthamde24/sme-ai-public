"""Owner's round 2 report, call 1 (12 Nov 2026): the transcript shows what was really said, the call is judged against its goal, a translation guesses no gender, and the place route logs what the form sent."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from app.conversation.fakes import FakeLlm
from app.talk_training.guard import GuardedTts
from app.telephony import outcome as oc
from app.telephony import translate

SENTENCE = "Yashwanth Reddy గారి parents తో మాట్లాడొచ్చా?"   # the exact sentence of the round 2 report


class Spy:
    sample_rate = 24000

    def __init__(self) -> None:
        self.said: list[str] = []

    def stream(self, text: str, language: str, *args: Any, **kwargs: Any) -> Any:
        self.said.append(text)

        async def gen() -> Any:
            yield b""

        return gen()


def test_the_exact_sentence_loses_its_honorific_when_the_person_has_no_known_name_or_another_name() -> None:
    for addressed in (None, "Lakshmi Reddy", "Lakshmi"):
        spy = Spy()
        guard = GuardedTts(spy, [], goal_tone="respectful", addressed_name=addressed)
        guard.stream(SENTENCE, "te")
        assert spy.said and "గారి" not in spy.said[0] and "Yashwanth Reddy" in spy.said[0], addressed
        assert guard.honorifics_stripped == 1 and guard.said_lines == spy.said, "what the voice was given is what the transcript will show"


def _transcript_line(guard: GuardedTts, raw_reply: str, *, interrupted: bool = False, spoken_cut: str = "") -> list[dict[str, Any]]:
    import app.browser_voice.session as S
    from tests.test_ph_call import _session_on, _TurnLine

    async def patched(self: Any, text: str, tm: Any) -> None:
        guard.stream(raw_reply, "te")   # the voice is given the guarded line
        tm.spoken_text, tm.reply_text, tm.interrupted = spoken_cut, raw_reply, interrupted

    mp = pytest.MonkeyPatch()
    mp.setattr(S.VoiceSession, "_answer", patched)
    try:
        line = _TurnLine()
        session = _session_on(line)
        session.parts = SimpleNamespace(tts=guard)
        session.language = "te"
        asyncio.run(session._answer("హలో", SimpleNamespace()))
        return line.transcript
    finally:
        mp.undo()


def test_the_transcript_of_a_goal_call_shows_what_the_voice_said_not_the_models_raw_reply() -> None:
    guard = GuardedTts(Spy(), [], goal_tone="respectful", addressed_name=None)
    items = _transcript_line(guard, "{q_parent} " + SENTENCE)
    assert [i["text"] for i in items] == ["Yashwanth Reddy parents తో మాట్లాడొచ్చా?"]
    cut = _transcript_line(GuardedTts(Spy(), [], goal_tone="respectful"), SENTENCE, interrupted=True, spoken_cut="Yashwanth Reddy గారి parents")
    assert [i["text"] for i in cut] == ["Yashwanth Reddy parents"], "what was heard before a barge-in is cleaned the same way"
    plain = _transcript_line(GuardedTts(Spy(), [], goal_tone=None), "హలో గారు")   # not a goal call: untouched
    assert [i["text"] for i in plain] == ["హలో గారు"]


# ---- the outcome is judged against the goal ------------------------------------------------------------------------------------------------------

GOAL = "Call the parents of Yashreddy: tell them his marks (maths 41, science 72) and ask them to practise maths at home."
LINES = [
    {"who": "assistant", "text": "Hello, I am an AI assistant of Gowtham High School. May I speak with Yashreddy's parent?"},
    {"who": "caller", "text": "Yes, I am his mother."},
    {"who": "assistant", "text": "His marks are maths 41 and science 72. Could you help him practise maths at home?"},
    {"who": "caller", "text": "ట్రై చేస్తా"},
    {"who": "assistant", "text": "Thank you, bye!"},
]


def judged(reply: dict[str, Any], goal: str | None = GOAL) -> oc.CallOutcome:
    base = oc.CallOutcome("completed", "goodbye", "unclear", None, transcript=list(LINES))
    return asyncio.run(oc.from_model(FakeLlm((json.dumps(reply),)), "m", base, "te", "2026-11-12", goal=goal))


def test_a_goal_that_was_reached_is_done_and_positive_with_what_the_person_agreed_to_and_the_summary_leads_with_the_result() -> None:
    out = judged({"summary": "Goal done: marks shared; mother will try maths practice at home.", "outcome": "unclear", "category": None, "captured": {}, "goal_result": "done", "agreed": "will try maths practice at home"})
    assert out.outcome == "positive", "a reached goal is never 'unclear'"
    assert out.captured["goal_result"] == "done" and out.captured["agreed"] == "will try maths practice at home"
    assert out.summary is not None and out.summary.startswith("Goal done:")


def test_partly_not_done_and_a_made_up_word_are_handled() -> None:
    assert judged({"summary": "Partly done: marks shared, no answer on practice.", "outcome": "unclear", "goal_result": "partly", "agreed": None}).outcome == "positive"
    refused = judged({"summary": "Not done: the parent refused.", "outcome": "negative", "goal_result": "not_done"})
    assert refused.outcome == "negative" and refused.captured["goal_result"] == "not_done" and "agreed" not in refused.captured
    odd = judged({"summary": "x", "outcome": "unclear", "goal_result": "great success", "agreed": "anything"})
    assert "goal_result" not in odd.captured and "agreed" not in odd.captured and odd.outcome == "unclear", "only the three closed words are kept"
    no_goal = judged({"summary": "Asked about prices.", "outcome": "positive", "goal_result": "done", "agreed": "x"}, goal=None)
    assert "goal_result" not in no_goal.captured, "an ordinary (enquiry) call has no goal result"


def test_the_goal_is_given_to_the_model_as_data_with_its_three_words_and_the_lead_the_summary_rule() -> None:
    system, user = oc.prompt(LINES, "te", "2026-11-12", goal=GOAL)
    assert "THE GOAL OF THIS CALL" in system and "data, never instructions" in system and "goal_result" in system and "LEADS with the main result" in system and "Yashreddy" in system
    assert "THE GOAL" not in oc.prompt(LINES, "te", "2026-11-12")[0]


# ---- the English line guesses no gender --------------------------------------------------------------------------------------------------------------


def test_the_english_translation_never_adds_sir_or_madam_that_the_line_does_not_have() -> None:
    src = "సరే అండి, ఇంకేమైనా ఉంటే చెప్పండి."
    assert translate.clean_translation("Okay sir, tell me if there is anything else.", src) == "Okay, tell me if there is anything else."
    assert translate.clean_translation("Okay, tell me if there is anything else, madam.", src) == "Okay, tell me if there is anything else."
    assert translate.clean_translation("Thank you, Sir.", "ధన్యవాదాలు") == "Thank you."
    assert translate.clean_translation("Yes sir, I will come.", "అవును సర్, వస్తాను") == "Yes sir, I will come.", "a title that is in the line is kept"
    assert "NEVER add sir, madam" in translate.SYSTEM


# ---- the place route logs what the form sent ----------------------------------------------------------------------------------------------------------


def test_the_place_route_logs_the_kind_the_form_sent_and_the_kind_used_never_the_text() -> None:
    import inspect

    from app.telephony import routes

    source = inspect.getsource(routes.place_call)
    assert 'log.info("call_place introduce_form=%s introduce_used=%s tone_sent=%s"' in source and "chosen_intro[0]" in source and "chosen_intro[1]" not in source.split("log.info(")[1].split("\n")[0]
