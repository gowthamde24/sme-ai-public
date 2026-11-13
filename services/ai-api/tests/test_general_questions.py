# ruff: noqa: E501
"""Talk live check of 13 Nov 2026: "what can you do?" took 15.7 s and ended in "sorry" (a long Telugu answer was cut off, its reply call was unreadable twice).

Proven here, offline: the eval cases (tests/evals/general/cases.jsonl: Telugu, Kannada, Hindi, English) are routed as pinned; "what can you do?" is answered at once from fixed words with NO model call, in the written chat and
in Talk live; a reply with a usable answer but a wrong `language`, an extra field or a bad `sources` list is accepted instead of costing a repair round; a reply that cannot be read is repaired ONCE and then ends in a graceful
plain sentence (never "sorry"); the Indian scripts get the larger output budget and every Ask prompt asks for short answers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.assistant import prompts
from app.assistant.language import COULD_NOT_ANSWER
from app.turns.intent import classify
from app.turns.words import ABOUT_ASSISTANT
from tests.test_ea_turns import done, events, text_of, turn, world

CASES = [json.loads(line) for line in (Path(__file__).resolve().parents[3] / "tests" / "evals" / "general" / "cases.jsonl").read_text(encoding="utf8").splitlines() if line.strip()]


def test_the_eval_covers_the_four_languages_and_every_case_is_routed_as_pinned() -> None:
    assert {c["language"] for c in CASES} == {"en", "te", "kn", "hi"} and len(CASES) >= 40
    wrong = {c["text"]: (classify(c["text"]).kind, classify(c["text"]).reason) for c in CASES if (classify(c["text"]).kind, classify(c["text"]).reason) != (c["kind"], c["reason"])}
    assert not wrong, wrong


def test_the_fixed_answer_exists_in_every_language_is_short_enough_to_speak_and_names_no_internals() -> None:
    assert set(ABOUT_ASSISTANT) == {"en", "te", "hi", "kn", "ta", "ml", "mr"}
    for language, text in ABOUT_ASSISTANT.items():
        assert 150 <= len(text) <= 520, (language, len(text))
        assert "_" not in text and "tool" not in text.lower(), language


@pytest.mark.parametrize("case", [c for c in CASES if c["reason"] == "about_assistant"], ids=lambda c: c["id"])
def test_what_can_you_do_is_answered_at_once_with_no_model_call(case: dict[str, Any]) -> None:
    client, llm, _, _ = world()   # a model with NO answers: a call would fail the test
    evs = events(turn(client, case["text"], language=case["language"]))
    assert evs[0][1]["kind"] == "general"
    assert text_of(evs) == ABOUT_ASSISTANT[case["language"]]
    assert done(evs)["kind"] == "answer" and llm.requests == []


def test_a_reply_with_a_usable_answer_is_read_forgivingly() -> None:
    forgiving = prompts.coerce_reply
    ok = forgiving(prompts.FinalReply, {"kind": "answer", "answer": " Two enquiries came today. ", "language": "te-IN", "sources": "s1", "note": "extra"}, "te")
    assert ok == {"kind": "answer", "answer": "Two enquiries came today.", "language": "te", "sources": []}
    assert prompts.FinalReply.model_validate(ok).language == "te"
    assert forgiving(prompts.ChatReply, {"answer": "Hello", "language": "en", "sources": ["s1"]}, "en") == {"kind": "answer", "answer": "Hello", "language": "en"}
    # nothing usable: unchanged, so the check still refuses it (the repair round and the plain sentence take over)
    assert forgiving(prompts.FinalReply, {}, "en") == {} and forgiving(prompts.FinalReply, {"answer": "  "}, "en") == {"answer": "  "} and forgiving(prompts.FinalReply, None, "en") is None


def test_an_unreadable_reply_is_repaired_once_and_then_ends_in_the_plain_sentence_not_sorry() -> None:
    cut = {}   # what a reply call that was cut off by the token limit looks like: no fields at all
    client, llm, _, _ = world(cut, cut)
    evs = events(turn(client, "how many enquiries today?", language="te"))
    assert len(llm.requests) == 2, "one repair attempt at most"
    assert text_of(evs) == COULD_NOT_ANSWER["te"] and "క్షమించండి" not in text_of(evs)
    assert any("three short sentences" in b.text for b in llm.requests[1].blocks), "the repair asks for a short answer"


def test_the_indian_scripts_get_the_larger_output_budget_and_the_prompt_asks_for_short_answers() -> None:
    client, llm, _, _ = world({"kind": "answer", "answer": "ఈ రోజు ఒక ఎంక్వైరీ వచ్చింది.", "language": "te", "sources": ["s1"]})
    turn(client, "ఈ రోజు ఎన్ని విచారణలు వచ్చాయి", language="te")
    assert llm.requests[0].max_output_tokens == 3000
    client, llm, _, _ = world({"kind": "answer", "answer": "One enquiry came today.", "language": "en", "sources": ["s1"]})
    turn(client, "how many enquiries today?")
    assert llm.requests[0].max_output_tokens == 1500
    assert "keep the whole answer to about six short sentences" in prompts.SYSTEM_PROMPT


def test_talk_live_speaks_the_fixed_answer_without_asking_a_model() -> None:
    from app.conversation.fakes import FakeLlm
    from tests.test_dv_browser_voice import FakeSocket, arun, fake_parts, session_of

    @arun
    async def go() -> None:
        sock = FakeSocket()
        llm = FakeLlm(("this must not be asked",))
        session = session_of(sock, fake_parts(llm=llm))
        session.language = "te"
        await session._answer("మీరు ఏమి చేయగలరు? వివరంగా చెప్పండి", None)  # type: ignore[arg-type]
        captions = [m["text"] for m in sock.json if m["type"] == "caption" and m["who"] == "assistant"]
        assert captions == [ABOUT_ASSISTANT["te"]] and sock.audio and "audio_end" in sock.types()
        assert [m["state"] for m in sock.json if m["type"] == "state"][:1] == ["speaking"]
        assert llm.models == [], "the model was not asked"

    go()
