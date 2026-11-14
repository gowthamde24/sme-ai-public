"""The composer remembers the conversation (owner, 14 Nov 2026: "Send WhatsApp to Kalyani" -> "just ask how is she?" lost Kalyani), and a failure never blames the length of the answer."""

# ruff: noqa: E501

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.assistant.language import COULD_NOT_ANSWER
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from app.turns.service import conversation_lines, owner_lines
from tests.dr_tasks_fakes import FakeTasksRepository, Scripted, plan_answer
from tests.ea_fakes import FakeTurnDb
from tests.fakes import make_client
from tests.test_ea_turns import done, events, turn


def _world(*answers: Any) -> tuple[Any, Scripted]:
    llm, db = Scripted(*answers), FakeTurnDb()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, tasks=TasksService(FakeTasksRepository(), FakeDialer(), FixedKnowledge([])))  # type: ignore[arg-type]
    return client, llm


def test_a_follow_up_is_planned_with_the_turns_before_it() -> None:
    client, llm = _world(
        plan_answer(selectors=[{"name": "Babu Rao"}], clarifying_question="What should the WhatsApp message to Babu Rao say?", channel="whatsapp"),
        plan_answer(selectors=[{"name": "Babu Rao"}], channel="whatsapp", message_text="Hi Babu, how are you?", questions=[]),
    )
    first = turn(client, "Send a WhatsApp message to Babu Rao.")
    conversation = next(d["conversation_id"] for n, d in events(first) if "conversation_id" in d)
    second = events(turn(client, "Just ask, how is she?", conversation=conversation))
    assert done(second)["kind"] == "answer" and [d for n, d in second if n == "work_card"][0]["card"]["kind"] == "message", "the follow-up completed the instruction: the message is on its way, no card to approve"
    sent = " ".join(b.text for b in llm.requests[-1].blocks)
    assert "the conversation so far" in sent and "Babu Rao" in sent and "Send a WhatsApp message to Babu Rao" in sent


def test_the_lines_the_planner_and_the_router_get() -> None:
    history = [{"role": "user", "body": "do whatsapp message to 9110680588"}, {"role": "assistant", "body": "Who is this number?"}, {"role": "user", "body": "add this contact to leads list"}]
    assert conversation_lines(history) == ["owner: do whatsapp message to 9110680588", "assistant: Who is this number?", "owner: add this contact to leads list"]
    assert owner_lines(history) == ["do whatsapp message to 9110680588", "add this contact to leads list"]


def test_the_fallback_never_blames_the_length_of_the_answer() -> None:
    for text in COULD_NOT_ANSWER.values():
        assert "short answer" not in text.lower() and "one thing at a time" not in text.lower()
