"""Job EA: the conversational assistant over HTTP (POST /assistant/turns and its neighbours), through the real routes and the real runner with a scripted model and an in-memory database.

What is proven: the router decides (no client flag); small talk and general help take ONE tool-free model call; a business question with nothing behind it says "no record" AND offers a way forward; an action becomes a
plan (`confirm_action`) or one question (`clarify`) and NOTHING runs until the owner's yes; every turn ends in exactly one typed reply; replay spends nothing; history, list and archive are the caller's own; a school's chat never has
fees in it."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from app.agents.llm.interface import LlmRateLimited
from app.assistant.language import NO_RECORD_HELP, PLAIN_WORDS, SCHOOL_REFUSAL
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.dr_tasks_fakes import FakeOutbox, FakeTasksRepository, Scripted, plan_answer
from tests.ea_fakes import FakeTurnDb, chat
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/assistant"


def world(*answers: Any, school: bool = False) -> tuple[Any, Scripted, FakeTurnDb, FakeTasksRepository]:
    llm = Scripted(*answers)
    db = FakeTurnDb()
    repo = FakeTasksRepository(school=school)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, tasks=TasksService(repo, FakeDialer(), FixedKnowledge([])), outbox=FakeOutbox())  # type: ignore[arg-type]
    return client, llm, db, repo


def events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for block in response.text.strip().split("\n\n"):
        lines = block.split("\n")
        out.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return out


def turn(client: Any, text: str, *, conversation: uuid.UUID | None = None, message: uuid.UUID | None = None, user: str = "a_owner", **extra: Any) -> Any:
    body = {"message_id": str(message or uuid.uuid4()), "conversation_id": str(conversation) if conversation else None, "text": text, **extra}
    return client.post(f"{BASE}/turns", json=body, headers=auth(user))


def names(evs: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [e[0] for e in evs]


def text_of(evs: list[tuple[str, dict[str, Any]]]) -> str:
    return "".join(d["delta"] for n, d in evs if n == "text").strip()


def done(evs: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    assert evs[-1][0] == "done", evs[-1]
    return evs[-1][1]


# ============================================================================ small talk and general help
def test_small_talk_is_one_tool_free_call_with_no_sources_and_ends_in_an_answer() -> None:
    client, llm, db, _ = world(chat("I'm well, thank you! How is the shop today?"))
    r = turn(client, "how are you")
    assert r.status_code == 200, r.text
    evs = events(r)
    assert names(evs)[0] == "intent" and evs[0][1]["kind"] == "smalltalk"
    assert "source" not in names(evs) and "confirm_action" not in names(evs)
    assert text_of(evs) == "I'm well, thank you! How is the shop today?"
    assert done(evs)["kind"] == "answer" and done(evs)["language"] == "en"
    assert len(llm.requests) == 1 and llm.requests[0].tools == (), "one call, no tools"
    system = llm.requests[0].blocks[0].text
    assert "NO access to this business's records" in system and "small talk" in system
    assert [c for c in db.names() if c in ("reserve_cost", "record_usage")] == ["reserve_cost", "record_usage"], "the cost is reserved and recorded like any model call"
    assert db.finished[-1] == ("succeeded", None)


def test_general_help_is_answered_from_general_knowledge_without_tools() -> None:
    client, llm, _, _ = world(chat("GST on sarees is 5% up to ₹1,000 and 12% above, but check the current rate with your accountant."))
    evs = events(turn(client, "explain GST on sarees"))
    assert evs[0][1]["kind"] == "general" and done(evs)["kind"] == "answer" and "source" not in names(evs)
    assert llm.requests[0].tools == ()
    assert "small talk" not in llm.requests[0].blocks[0].text


def test_the_client_cannot_choose_a_mode_the_router_decides() -> None:
    client, _, _, _ = world(chat("Fine!"))
    bad = client.post(f"{BASE}/turns", json={"message_id": str(uuid.uuid4()), "text": "hi", "mode": "do_it"}, headers=auth("a_owner"))
    assert bad.status_code == 422, "an unknown field is refused: there is no Ask or Do-it switch"


def test_a_reply_in_the_wrong_language_is_asked_for_again_once() -> None:
    client, llm, _, _ = world(chat("I am fine", language="te"), chat("నేను బాగున్నాను, మీరు ఎలా ఉన్నారు?", language="te"))
    evs = events(turn(client, "ఎలా ఉన్నారు"))
    assert len(llm.requests) == 2 and done(evs)["language"] == "te" and "బాగున్నాను" in text_of(evs)


def test_a_reply_that_names_an_internal_tool_is_replaced_by_plain_words() -> None:
    client, _, _, _ = world(chat("I used find_price and list_orders to check."))
    evs = events(turn(client, "tell me a joke"))
    assert text_of(evs) == PLAIN_WORDS["en"] and done(evs)["kind"] == "clarify"


def test_a_model_that_is_busy_ends_in_an_error_not_a_reply() -> None:
    client, _, db, _ = world(LlmRateLimited())
    evs = events(turn(client, "hello there"))
    assert names(evs)[-1] == "error" and evs[-1][1]["code"] == "model_busy"
    assert db.finished[-1][0] == "failed"


# ============================================================================ business questions: no record is said plainly and still helps
def test_an_uncited_claim_with_a_figure_about_the_business_is_blocked_and_replaced_by_a_kind_nothing_found_plus_a_next_step() -> None:
    uncited = {"kind": "answer", "answer": "There were 3 enquiries today.", "language": "en", "sources": []}
    client, _, _, _ = world(uncited, uncited)
    evs = events(turn(client, "how many enquiries today?"))
    assert evs[0][1]["kind"] == "business"
    assert text_of(evs) == NO_RECORD_HELP["en"] and "nothing to show" in text_of(evs) and "follow-up" in text_of(evs) and "will not guess" not in text_of(evs)
    assert "source" not in names(evs) and done(evs)["kind"] == "answer"


def test_the_written_ask_keeps_its_own_bare_sentence() -> None:
    from app.assistant.language import NO_ANSWER
    from app.assistant.runner import AssistantRunner

    assert AssistantRunner(db=None, llm=None, ctx=SimpleNamespace(state=None))._empty is NO_ANSWER  # type: ignore[arg-type]
    assert AssistantRunner(db=None, llm=None, ctx=SimpleNamespace(state=None), help_on_empty=True)._empty is NO_RECORD_HELP  # type: ignore[arg-type]


# ============================================================================ actions: a plan waits for the yes
def test_an_instruction_becomes_a_plan_and_nothing_runs() -> None:
    client, _, db, repo = world(plan_answer())
    evs = events(turn(client, "call the new leads"))
    assert evs[0][1]["kind"] == "action" and done(evs)["kind"] == "confirm_action"
    card = next(d for n, d in evs if n == "confirm_action")
    assert card["status"] == "proposed" and card["count"] == 2 and card["channel"] == "call" and card["can_confirm"] is True
    assert "Shall I go ahead?" in card["summary"] and card["steps"][0].startswith("Who:") and card["estimate"]["call_minutes"] == 4
    assert text_of(evs) == card["summary"]
    task = repo.tasks[uuid.UUID(card["action_id"])]
    assert task["status"] == "planned", "a plan is only proposed: nothing is approved, dialled or sent"
    assert db.marked and db.marked[-1]["kind"] == "confirm_action" and str(db.marked[-1]["task_id"]) == card["action_id"]


def test_a_question_from_the_planner_is_one_clarify_and_the_next_message_answers_it() -> None:
    client, _, _, repo = world(plan_answer(clarifying_question="Which leads do you mean: new or old?"), plan_answer())
    conversation = uuid.uuid4()
    first = events(turn(client, "call", conversation=conversation))
    assert done(first)["kind"] == "clarify"
    ask = next(d for n, d in first if n == "clarify")
    assert ask["question"] == "Which leads do you mean: new or old?" and uuid.UUID(ask["action_id"])
    second = events(turn(client, "the new ones", conversation=conversation))
    assert second[0][1]["kind"] == "action", "the answer is routed as the planner's answer, whatever the words are"
    assert done(second)["kind"] == "confirm_action"
    assert len(repo.tasks) == 1, "the same task, now planned"


def test_yes_approves_exactly_like_the_tasks_screen_and_asking_again_changes_nothing() -> None:
    client, _, _, repo = world(plan_answer())
    card = next(d for n, d in events(turn(client, "call the new leads")) if n == "confirm_action")
    url = f"{BASE}/actions/{card['action_id']}/confirm"
    yes = client.post(url, json={"decision": "yes"}, headers=auth("a_owner"))
    assert yes.status_code == 200, yes.text
    assert yes.json()["status"] == "confirmed" and yes.json()["task"]["id"] == card["action_id"]
    assert repo.tasks[uuid.UUID(card["action_id"])]["status"] in ("approved", "running", "done")
    again = client.post(url, json={"decision": "yes"}, headers=auth("a_owner"))
    assert again.status_code == 200 and again.json()["status"] in ("confirmed", "running", "done")
    late_no = client.post(url, json={"decision": "no"}, headers=auth("a_owner"))
    assert late_no.status_code == 409 and late_no.json()["error"]["code"] == "action_state"


def test_no_cancels_the_plan() -> None:
    client, _, _, repo = world(plan_answer())
    card = next(d for n, d in events(turn(client, "call the new leads")) if n == "confirm_action")
    url = f"{BASE}/actions/{card['action_id']}/confirm"
    no = client.post(url, json={"decision": "no"}, headers=auth("a_owner"))
    assert no.status_code == 200 and no.json()["status"] == "declined"
    assert repo.tasks[uuid.UUID(card["action_id"])]["status"] == "cancelled"
    assert client.post(url, json={"decision": "yes"}, headers=auth("a_owner")).json()["error"]["code"] == "action_state"


def test_a_plan_nobody_answered_for_half_an_hour_expires() -> None:
    client, _, db, repo = world(plan_answer())
    card = next(d for n, d in events(turn(client, "call the new leads")) if n == "confirm_action")
    for m in db.messages:
        if m["kind"] == "confirm_action":
            m["created_at"] = (datetime.now(UTC) - timedelta(minutes=31)).isoformat()
    r = client.post(f"{BASE}/actions/{card['action_id']}/confirm", json={"decision": "yes"}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "action_expired"
    assert repo.tasks[uuid.UUID(card["action_id"])]["status"] == "planned", "an expired yes approves nothing"


def test_only_the_owner_can_say_yes_and_only_to_a_plan_in_their_own_chat() -> None:
    client, _, _, _ = world(plan_answer())
    card = next(d for n, d in events(turn(client, "call the new leads", user="a_sales")) if n == "confirm_action")
    assert card["can_confirm"] is False, "a salesperson may ask for a plan; the owner decides"
    url = f"{BASE}/actions/{card['action_id']}/confirm"
    assert client.post(url, json={"decision": "yes"}, headers=auth("a_sales")).status_code == 403
    assert client.post(f"{BASE}/actions/{uuid.uuid4()}/confirm", json={"decision": "yes"}, headers=auth("a_owner")).status_code == 404


def test_an_action_the_school_rules_refuse_is_never_proposed() -> None:
    client, _, _, repo = world(plan_answer(template="payment_reminder", channel="whatsapp", goal="Remind parents about pending fees", message_text="Please pay the pending fee."), school=True)
    evs = events(turn(client, "message all parents to pay the fee"))
    assert "confirm_action" not in names(evs) and done(evs)["kind"] in ("clarify", "answer")
    assert not [t for t in repo.tasks.values() if t["status"] == "planned"]


# ============================================================================ the typed reply, replay, history
def test_a_replay_gives_the_same_reply_and_spends_nothing() -> None:
    client, llm, _, _ = world(chat("Hello! How can I help?"))
    message, conversation = uuid.uuid4(), uuid.uuid4()
    first = events(turn(client, "hello", message=message, conversation=conversation))
    again = events(turn(client, "hello", message=message, conversation=conversation))
    assert text_of(again) == text_of(first) and done(again)["kind"] == done(first)["kind"] == "answer"
    assert len(llm.requests) == 1


def test_a_replayed_plan_shows_its_card_as_it_stands_now() -> None:
    client, _, _, _ = world(plan_answer())
    message, conversation = uuid.uuid4(), uuid.uuid4()
    card = next(d for n, d in events(turn(client, "call the new leads", message=message, conversation=conversation)) if n == "confirm_action")
    client.post(f"{BASE}/actions/{card['action_id']}/confirm", json={"decision": "yes"}, headers=auth("a_owner"))
    again = events(turn(client, "call the new leads", message=message, conversation=conversation))
    shown = next(d for n, d in again if n == "confirm_action")
    assert shown["status"] in ("confirmed", "running", "done") and done(again)["kind"] == "confirm_action"


def test_the_history_carries_each_reply_type_and_where_its_action_stands() -> None:
    client, _, _, _ = world(plan_answer())
    conversation = uuid.uuid4()
    card = next(d for n, d in events(turn(client, "call the new leads", conversation=conversation)) if n == "confirm_action")
    read = client.get(f"{BASE}/conversations/{conversation}", headers=auth("a_owner"))
    assert read.status_code == 200, read.text
    reply = [m for m in read.json()["messages"] if m["role"] == "assistant"][-1]
    assert reply["kind"] == "confirm_action" and reply["action"] == {"action_id": card["action_id"], "status": "proposed"}
    user = [m for m in read.json()["messages"] if m["role"] == "user"][0]
    assert user["kind"] == "answer" and user["action"] is None


def test_the_list_shows_my_conversations_with_a_title_and_archive_hides_one() -> None:
    client, _, _, _ = world(chat("Sure."), chat("Fine."), plan_answer())
    long_text = "tell me a joke about a shopkeeper who sells sarees to everybody in the whole town"
    one, two = uuid.uuid4(), uuid.uuid4()
    turn(client, long_text, conversation=one)
    turn(client, "hello", conversation=two)
    turn(client, "call the new leads")   # the planner's own bookkeeping conversation must not be listed
    listed = client.get(f"{BASE}/conversations", headers=auth("a_owner")).json()
    ids = [i["id"] for i in listed["items"]]
    assert str(one) in ids and str(two) in ids and len(listed["items"]) == 3
    item = next(i for i in listed["items"] if i["id"] == str(one))
    assert item["title"] == long_text[:60] and item["message_count"] == 2 and item["last_text"] == "Sure."
    assert not any(i["title"] == "Plan a task" for i in listed["items"])
    assert client.post(f"{BASE}/conversations/{one}/archive", headers=auth("a_owner")).status_code == 204
    after = [i["id"] for i in client.get(f"{BASE}/conversations", headers=auth("a_owner")).json()["items"]]
    assert str(one) not in after and str(two) in after
    assert client.post(f"{BASE}/conversations/{uuid.uuid4()}/archive", headers=auth("a_owner")).status_code == 404


def test_a_conversation_id_of_nobody_s_is_the_same_404_as_an_unknown_one() -> None:
    client, _, _, _ = world()
    assert client.post(f"{BASE}/conversations/not-a-uuid/archive", headers=auth("a_owner")).status_code == 404


# ============================================================================ a school
def test_a_schools_chat_never_has_fees_marks_or_dues_in_it() -> None:
    client, llm, _, _ = world(school=True)
    evs = events(turn(client, "give me tips on how to talk about exam results with anxious families"))
    assert text_of(evs) == SCHOOL_REFUSAL["en"] and done(evs)["kind"] == "answer"
    assert llm.requests == [], "no model call: nothing about fees reaches a model"


def test_a_shop_may_ask_general_questions_about_dues() -> None:
    client, llm, _, _ = world(chat("Be polite and give a date."), school=False)
    evs = events(turn(client, "how do I ask a customer politely about overdue payment, give me tips"))
    assert llm.requests and "source" not in names(evs)
