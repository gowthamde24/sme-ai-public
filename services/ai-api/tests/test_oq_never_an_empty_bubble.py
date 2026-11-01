"""Owner, 1 Nov 2026: a typed turn never ends in an empty bubble. Two of about sixty staging replies came back empty, so this is a bug, not an observation.

What is proven, through the real routes and runner with a scripted model: a model that answers with NOTHING (a blank answer) is asked once more, silently, and if it is still blank the person reads "Sorry, I couldn't
answer that — try again." in their language; a provider that timed out or was unreachable is asked once more, silently; a second failure ends in the same sentence, stored and streamed as a reply (text + done), not as an
`error` event with an English message; a busy provider (429) and the budget pause keep their own messages; a run that crashes says the sentence too; a reply the checks refused keeps its own "nothing found"."""

# ruff: noqa: E501

from __future__ import annotations

import uuid

import pytest

from app.agents.llm.interface import LlmBadResponse, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.assistant.language import COULD_NOT_ANSWER
from tests.ea_fakes import chat
from tests.fakes import auth
from tests.test_ea_turns import BASE, done, events, names, text_of, turn, world

BLANK = {"kind": "answer", "answer": "   \n ", "language": "en"}


def test_the_sentence_exists_in_every_language_and_is_never_blank() -> None:
    assert set(COULD_NOT_ANSWER) == {"en", "te", "hi", "kn", "ta", "ml"}
    assert COULD_NOT_ANSWER["en"] == "Sorry, I couldn't answer that — try again."
    assert all(text.strip() for text in COULD_NOT_ANSWER.values())


def test_a_blank_model_answer_twice_in_a_chat_turn_shows_the_sentence_not_an_empty_bubble() -> None:
    client, llm, db, _ = world(BLANK, BLANK)
    evs = events(turn(client, "how are you"))
    assert text_of(evs) == COULD_NOT_ANSWER["en"]
    assert done(evs)["kind"] == "answer" and "error" not in names(evs)
    assert len(llm.requests) == 2, "asked once more, then the sentence"


def test_a_blank_model_answer_once_is_asked_again_silently_and_the_second_answer_is_shown() -> None:
    client, llm, _, _ = world(BLANK, chat("I'm well, thank you!"))
    evs = events(turn(client, "how are you"))
    assert text_of(evs) == "I'm well, thank you!" and COULD_NOT_ANSWER["en"] not in text_of(evs)
    assert len(llm.requests) == 2


@pytest.mark.parametrize("error", [LlmTimeout, LlmUnavailable, LlmBadResponse])
def test_a_provider_failure_once_is_retried_silently_in_a_chat_turn(error: type[Exception]) -> None:
    client, llm, _, _ = world(error(), chat("I'm well, thank you!"))
    evs = events(turn(client, "how are you"))
    assert text_of(evs) == "I'm well, thank you!" and "error" not in names(evs)
    assert len(llm.requests) == 2


@pytest.mark.parametrize("error", [LlmTimeout, LlmUnavailable, LlmBadResponse])
def test_a_provider_failure_twice_shows_the_sentence_as_a_stored_reply_in_a_chat_turn(error: type[Exception]) -> None:
    client, llm, db, _ = world(error(), error())
    evs = events(turn(client, "how are you"))
    assert text_of(evs) == COULD_NOT_ANSWER["en"] and done(evs)["kind"] == "answer" and "error" not in names(evs)
    assert len(llm.requests) == 2
    assert db.finished[-1] == ("failed", "model_failed"), "the run is still recorded as failed (and logged), only the person sees a sentence"
    assert [m["body"] for m in db.messages if m["role"] == "assistant"] == [COULD_NOT_ANSWER["en"]], "stored with the conversation like any reply"


def test_the_sentence_is_in_the_chat_language() -> None:
    client, _, _, _ = world(LlmTimeout(), LlmTimeout())
    evs = events(turn(client, "నమస్కారం, ఎలా ఉన్నారు?"))
    assert text_of(evs) == COULD_NOT_ANSWER["te"] and done(evs)["language"] == "te"


def test_a_busy_provider_is_not_retried_and_keeps_its_own_message() -> None:
    client, llm, _, _ = world(LlmRateLimited())
    evs = events(turn(client, "hello there"))
    assert names(evs)[-1] == "error" and evs[-1][1]["code"] == "model_busy"
    assert len(llm.requests) == 1


def test_a_blank_model_answer_twice_in_a_business_question_shows_the_sentence() -> None:
    client, llm, _, _ = world(BLANK, BLANK)
    evs = events(turn(client, "how many enquiries today?"))
    assert evs[0][1]["kind"] == "business"
    assert text_of(evs) == COULD_NOT_ANSWER["en"] and done(evs)["kind"] == "answer"
    assert len(llm.requests) == 2


def test_a_provider_timeout_twice_in_a_business_question_shows_the_sentence() -> None:
    client, llm, _, _ = world(LlmTimeout(), LlmTimeout())
    evs = events(turn(client, "how many enquiries today?"))
    assert text_of(evs) == COULD_NOT_ANSWER["en"] and "error" not in names(evs)
    assert len(llm.requests) == 2


def test_a_provider_timeout_once_in_a_business_question_is_retried_silently() -> None:
    uncited = {"kind": "answer", "answer": "There were 3 enquiries today.", "language": "en", "sources": []}
    client, llm, _, _ = world(LlmTimeout(), uncited, uncited)
    evs = events(turn(client, "how many enquiries today?"))
    assert "error" not in names(evs) and text_of(evs) and COULD_NOT_ANSWER["en"] not in text_of(evs), "the retry worked; the checks then said 'nothing found' as before"


def test_a_run_that_crashes_says_the_sentence_too() -> None:
    client, _, _, _ = world(RuntimeError("boom"))
    evs = events(turn(client, "how are you"))
    assert text_of(evs) == COULD_NOT_ANSWER["en"] and names(evs)[-1] == "done"


def test_the_written_ask_says_the_sentence_too_when_the_model_fails_twice() -> None:
    client, llm, _, _ = world(LlmTimeout(), LlmTimeout())
    r = client.post(f"{BASE}/messages", json={"message_id": str(uuid.uuid4()), "text": "how many enquiries today?"}, headers=auth("a_owner"))
    evs = events(r)
    assert text_of(evs) == COULD_NOT_ANSWER["en"] and names(evs)[-1] == "done" and "error" not in names(evs)
    assert len(llm.requests) == 2
