"""Act, do not rehearse (owner, 14 Nov 2026): "send Babu Rao: how are you?" IS the approval. No card to say yes to: the plan is approved and carried out, the outbox message the policy held is approved by those words
and queued for the 30 seconds of Undo, and the reply is a `message` card. A number the WhatsApp test fence would refuse gets the plain reason and the manual card (nothing leaves). A typed "ok" approves the card the last
reply showed."""

# ruff: noqa: E501

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from app.turns.service import is_ok
from tests.dr_tasks_fakes import FakeOutbox, FakeTasksRepository, Scripted, plan_answer
from tests.ea_fakes import FakeTurnDb
from tests.fakes import make_client
from tests.test_ea_turns import done, events, turn


class Adapter:
    def __init__(self, allowed: set[str]) -> None:
        self.allowed = allowed

    def may_reach_last4(self, last4: str) -> bool:
        return any(n.endswith(last4) for n in self.allowed)


def world(*answers: Any, outbox: FakeOutbox | None = None, adapter: Any = None, repo: FakeTasksRepository | None = None) -> tuple[Any, FakeTasksRepository, FakeOutbox]:
    llm, db, repo, box = Scripted(*answers), FakeTurnDb(), repo or FakeTasksRepository(), outbox or FakeOutbox(status="needs_approval")
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, tasks=TasksService(repo, FakeDialer(), FixedKnowledge([])), outbox=box, outbox_adapter=adapter)   # type: ignore[arg-type]
    return client, repo, box


MESSAGE = plan_answer(channel="whatsapp", selectors=[{"name": "Babu Rao"}], goal="Say hello", message_text="How are you?", questions=[], template="custom")


def test_a_clear_send_instruction_is_carried_out_with_no_card_and_a_message_card_with_undo() -> None:
    client, repo, box = world(MESSAGE)
    evs = events(turn(client, "send Babu Rao: How are you?"))
    assert not [n for n, _ in evs if n == "confirm_action"], "no card to say yes to"
    card = next(d["card"] for n, d in evs if n == "work_card")
    assert card["kind"] == "message" and card["state"] == "queued" and card["recipient"] == {"name": card["recipient"]["name"]} and card["text"] == "How are you?"
    assert card["undo"] is not None and card["undo"]["until"].endswith("Z") and card["manual_reason"] is None
    assert len(box.sent) == 1 and box.approved and box.approved[0][1] == 30, "the policy held it; the owner's words approved it, with the 30 second grace"
    assert any(c["p_channel"] == "whatsapp" for c in repo.consents), "the owner naming her is the consent"
    assert done(evs)["kind"] == "answer"


def test_a_message_the_policy_lets_through_is_not_approved_again() -> None:
    client, _, box = world(MESSAGE, outbox=FakeOutbox(status="queued"))
    card = next(d["card"] for n, d in events(turn(client, "send Babu Rao: How are you?")) if n == "work_card")
    assert card["state"] == "queued" and card["undo"] is None and not box.approved


def test_ok_is_ok_in_three_languages_and_nothing_else_is() -> None:
    for text in ("ok", "okay", "Send it", "okay send her", "go ahead", "సరే పంపు", "ठीक है", "ಸರಿ", "yes."):
        assert is_ok(text), text
    for text in ("ok but change it to hello", "send the quote to Ravi", "what is the status", "no"):
        assert not is_ok(text), text


def test_a_group_plan_stays_a_card_and_a_typed_ok_approves_it() -> None:
    client, repo, _ = world(plan_answer(selectors=[{"segment": "all_leads"}]))
    first = events(turn(client, "call all the leads"))
    card = next(d for n, d in first if n == "confirm_action")
    conversation = next(d["conversation_id"] for n, d in first if "conversation_id" in d)
    evs = events(turn(client, "ok", conversation=conversation))
    assert repo.tasks[__import__("uuid").UUID(card["action_id"])]["status"] in ("approved", "running", "done"), "the typed OK approved the card"
    assert done(evs)["kind"] == "answer"


class RepoWithPhones(FakeTasksRepository):
    def contacts(self, token: str, tenant_id: Any, task_id: Any, status: Any, limit: int, after_seq: Any) -> list[dict[str, Any]]:
        return [{**r, "phone_last4": "5555"} for r in super().contacts(token, tenant_id, task_id, status, limit, after_seq)]


def test_a_number_the_whatsapp_test_fence_would_refuse_gets_the_reason_and_the_manual_card_and_nothing_is_sent() -> None:
    client, _, box = world(MESSAGE, adapter=Adapter({"919502380998"}), repo=RepoWithPhones())
    evs = events(turn(client, "send Babu Rao: How are you?"))
    card = next(d["card"] for n, d in evs if n == "work_card")
    assert card["state"] == "manual" and card["manual_reason"] == "test_recipient_only" and card["undo"] is None
    assert card["message_id"] is not None and len(box.sent) == 1 and box.approved == [(card["message_id"], 86400)], "approved and held for a day so the web can open it in the owner's own WhatsApp; the system sends nothing"
    text = "".join(d["delta"] for n, d in evs if n == "text")
    assert "test numbers" in text and "own WhatsApp" in text
    reachable, _, box2 = world(MESSAGE, adapter=Adapter({"919502385555"}), repo=RepoWithPhones())
    assert next(d["card"] for n, d in events(turn(reachable, "send Babu Rao: How are you?")) if n == "work_card")["state"] == "queued" and len(box2.sent) == 1


def test_which_kalyani_is_a_choose_card_with_the_names_as_buttons() -> None:
    from app.tasks.planner import person_question, which_options

    q = person_question("en", "which", "Kalyani", "whatsapp", ["Kalyani Gowda", "Kalyani Shetty", "Kalyani Iyer"])
    assert which_options(q) == ("Which Kalyani?", ["Kalyani Gowda", "Kalyani Shetty", "Kalyani Iyer"])
    te = person_question("te", "which", "కళ్యాణి", "whatsapp", ["కళ్యాణి గౌడ", "కళ్యాణి శెట్టి"])
    assert which_options(te) == ("ఏ కళ్యాణి?", ["కళ్యాణి గౌడ", "కళ్యాణి శెట్టి"])
    assert which_options("What should the message say?") is None and which_options("Which one? A") is None
