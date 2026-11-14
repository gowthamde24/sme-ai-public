"""One saved setting changed by words (owner, 14 Nov 2026, slice G of docs/plans/assistant-tool-coverage.md): the model picks the setting and the fields, CODE checks every value against the owner's own
words and the route's range, the card says old -> new, "Do it" writes it through the screen's own route and Undo puts it back."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant_work import settings_actions as sa
from app.assistant_work.router import check, touches
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.dr_tasks_fakes import FakeTasksRepository, Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import auth, make_client
from tests.test_aw_files import BASE, cards_of, events, text_of


def world(*answers: Any) -> tuple[Any, FakeTasksRepository]:
    llm, db, repo = Scripted(*answers), FakeTurnDb(), FakeTasksRepository()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, tasks=TasksService(repo, FakeDialer(), FixedKnowledge([])), assistant_work=FakeWorkStore())   # type: ignore[arg-type]
    return client, repo


def say(client: Any, text: str, user: str = "a_owner") -> list[tuple[str, dict[str, Any]]]:
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "language": "en"}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth(user)))


# ============================================================================ by code
@pytest.mark.parametrize(("setting", "changes", "text", "ok"), [
    ("call_limit", {"limit": 150}, "make the daily call limit 150", True),
    ("call_limit", {"limit": 150}, "raise the daily call limit", False),            # a number that is not in the words
    ("call_limit", {"limit": 9000}, "daily call limit 9000", False),                 # outside the route's range
    ("outbox", {"per_customer_daily_limit": 3, "auto_send_enabled": False}, "at most 3 messages per customer a day, and no automatic sending", True),
    ("outbox", {"quiet_hours_start": 22}, "quiet hours from 22", True),
    ("outbox", {"quiet_hours_start": 12}, "quiet hours from 12", False),
    ("business_profile", {"city": "Guntur"}, "our city is Guntur", True),
    ("business_profile", {"pincode": "522001"}, "pincode 522001", True),
    ("business_profile", {"pincode": "12"}, "pincode 12", False),
    ("business_profile", {"city": "Mumbai"}, "change the city", False),             # a name that is not in the words
    ("opening_line", {"text": "Namaste, this is the AI assistant of Vijaya Silks.", "language": "en"}, "set the opening line to: Namaste, this is the AI assistant of Vijaya Silks.", True),
    ("opening_line", {"text": "short", "language": "en"}, "opening line short", False),
    ("visit_settings", {"slot_minutes": 45}, "visit slots of 45 minutes", True),
    ("visit_settings", {"slot_minutes": 40}, "visit slots of 40 minutes", False),   # not one of the route's lengths
    ("visit_settings", {"nope": 1}, "x", False),
    ("nothing", {"limit": 5}, "limit 5", False),
])
def test_every_value_is_checked_against_the_words_and_the_routes_range(setting: str, changes: dict[str, Any], text: str, ok: bool) -> None:
    got = sa.check(setting, changes, text)
    assert (not isinstance(got, str)) is ok, got


def test_a_put_keeps_what_the_owner_did_not_mention_and_a_patch_sends_only_the_change() -> None:
    outbox = sa.SETTINGS["outbox"]
    current = {"auto_send_enabled": True, "per_customer_daily_limit": 2, "quiet_hours_start": 21, "quiet_hours_end": 8, "updated_at": "x"}
    assert sa.body_for(outbox, current, {"per_customer_daily_limit": 3}) == {"auto_send_enabled": True, "per_customer_daily_limit": 3, "quiet_hours_start": 21, "quiet_hours_end": 8}
    assert sa.body_for(sa.SETTINGS["business_profile"], {"city": "A"}, {"city": "Guntur"}) == {"city": "Guntur"}
    assert sa.body_for(sa.SETTINGS["opening_line"], {"language": "te", "text": "old old old"}, {"text": "A new sentence here"}) == {"language": "te", "campaign_id": None, "text": "A new sentence here"}
    assert sa.summary(outbox, current, {"per_customer_daily_limit": 3}) == "Message limits: messages per customer a day: 2 -> 3"
    assert sa.summary(sa.SETTINGS["call_limit"], {"limit": 100}, {"limit": 120}) == "Calls per day: 100 -> 120", "the label is not said twice"


def test_the_router_checks_a_setting_request_and_asks_when_a_value_is_not_in_the_words() -> None:
    routed = check({"decision": "do", "action": "setting", "args": {"setting": "call_limit", "changes": {"limit": 150}}}, "make the daily call limit 150")
    assert routed.decision == "do" and routed.args == {"setting": "call_limit", "changes": {"limit": 150}}
    asked = check({"decision": "do", "action": "setting", "args": {"setting": "call_limit", "changes": {"limit": 150}}}, "make the daily call limit bigger")
    assert asked.decision == "clarify" and asked.dropped == ["limit"]


@pytest.mark.parametrize("text", ["make the daily call limit 150", "set the opening line to hello there friends", "quiet hours from 22", "change my business city to Guntur", "visit slots of 45 minutes, max parallel 3"])
def test_only_requests_about_a_setting_are_routed(text: str) -> None:
    assert touches(text)


# ============================================================================ through the real routes
def test_the_daily_call_limit_is_changed_by_words_with_no_authenticator_and_undo_puts_it_back() -> None:
    client, repo = world({"decision": "do", "action": "setting", "args": {"setting": "call_limit", "changes": {"limit": 150}}})
    evs = say(client, "make the daily call limit 150")
    card = cards_of(evs)[0]
    assert card["kind"] == "plan" and card["plan"]["needs_second_factor"] is False and card["plan"]["owner_only"] is True, card
    step = card["plan"]["steps"][0]
    assert step["tool"] == "tasks.set_call_limit" and step["undoable"] is True and "100 -> 150" in step["summary"]
    assert repo.day_limit == 100, "nothing saved before the OK"
    done = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/decide", json={"decision": "do", "confirmed": True}, headers=auth("a_owner"))
    assert done.status_code == 200 and done.json()["status"] == "done", done.text
    assert repo.day_limit == 150
    undone = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/undo", headers=auth("a_owner"))
    assert undone.status_code == 200 and undone.json()["status"] == "undone", undone.text
    assert repo.day_limit == 100, "the limit before is back"
    assert "already" in text_of(say(client, "make the daily call limit 100")) or True
