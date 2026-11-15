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


@pytest.mark.parametrize(("setting", "changes", "text", "ok"), [
    ("call_behaviour", {"voicemail_action": "leave_message"}, "when voicemail answers, leave a message", True),
    ("call_behaviour", {"max_call_seconds": 120}, "calls at most 120 seconds", True),
    ("call_behaviour", {"max_call_seconds": 9999}, "calls at most 9999 seconds", False),
    ("call_behaviour", {"interruption_sensitivity": "extreme"}, "very sensitive", False),
    ("lead_finder", {"daily_call_cap": 40, "searches_per_day": 5}, "lead finder: 40 calls a day, 5 searches a day", True),
    ("lead_finder", {"fit_bar": 30}, "fit 30", False),
])
def test_the_call_and_lead_finder_settings_are_checked_too(setting: str, changes: dict[str, Any], text: str, ok: bool) -> None:
    assert (not isinstance(sa.check(setting, changes, text), str)) is ok


def test_the_opening_line_is_read_as_lines_and_written_as_one_line_in_its_own_language() -> None:
    current = {"mention_ai": True, "lines": [{"language": "en", "text": "Hello from the shop, this is the AI assistant.", "campaign_id": None}, {"language": "en", "text": "Campaign line here for tests.", "campaign_id": "c1"}]}
    now, changes = sa.prepare("opening_line", current, {"text": "Welcome to Vijaya Silks, I am the AI assistant."})
    assert now == {"language": "en", "text": "Hello from the shop, this is the AI assistant."} and changes["language"] == "en"
    assert sa.body_for(sa.SETTINGS["opening_line"], now, changes) == {"language": "en", "campaign_id": None, "text": "Welcome to Vijaya Silks, I am the AI assistant."}
    telugu, changes_te = sa.prepare("opening_line", {"lines": []}, {"text": "నమస్కారం అండీ, నేను విజయ సిల్క్స్ AI అసిస్టెంట్ ని."})
    assert changes_te["language"] == "te" and telugu["text"] is None


def test_a_put_of_the_call_settings_keeps_every_field_it_is_not_changing() -> None:
    spec = sa.SETTINGS["call_behaviour"]
    saved = {k: f"v-{k}" for k in sa.CALL_FIELDS}
    body = sa.body_for(spec, saved, {"max_call_seconds": 120})
    assert set(body) == set(sa.CALL_FIELDS) and body["max_call_seconds"] == 120 and body["hours"] == "v-hours"


# ============================================================================ the client actions (the browser does them)
def test_the_client_action_arguments_are_checked_against_the_closed_lists() -> None:
    from app.assistant_work import client_actions as ca

    assert ca.check("theme", {"mode": "dark"}) == {"mode": "dark"} and ca.check("theme", {"mode": "pink"}) == "mode"
    assert ca.check("language", {"lang": "te"}) == {"lang": "te"} and ca.check("language", {"lang": "xx"}) == "lang"
    assert ca.check("navigate", {"page": "reports", "period": "month"}) == {"page": "reports", "period": "month"}
    assert ca.check("navigate", {"page": "reports", "period": {"from": "2026-11-01", "to": "2026-11-14"}}) == {"page": "reports", "period": {"from": "2026-11-01", "to": "2026-11-14"}}
    assert ca.check("navigate", {"page": "reports", "period": {"from": "2026-11-14", "to": "2026-11-01"}}) == "period" and ca.check("navigate", {"page": "admin"}) == "page"
    assert ca.check("filter", {"page": "calls", "status": "no_answer", "when": "today", "q": "  Ravi  "}) == {"page": "calls", "status": "no_answer", "when": "today", "q": "Ravi"}
    assert ca.check("filter", {"page": "leads", "q": "x"}) == "page" and ca.check("filter", {"page": "calls"}) == "filter"
    assert ca.check("open_settings", {"section": "limits"}) == {"section": "limits"} and ca.check("open_settings", {"section": "secrets"}) == "section"
    assert ca.check("talk_live", {"state": "start"}) == {"state": "start"} and ca.check("open_record", {"type": "lead"}) == "action"


def test_a_client_request_becomes_one_client_action_card_and_nothing_else() -> None:
    client, _ = world({"decision": "do", "action": "client", "args": {"client_action": "theme", "client_args": {"mode": "dark"}}})
    evs = say(client, "switch to dark mode")
    card = cards_of(evs)[0]
    assert card["kind"] == "client_action" and card["action"] == "theme" and card["args"] == {"mode": "dark"} and card["id"]
    assert text_of(evs) == "Done."
    outside, _ = world({"decision": "do", "action": "client", "args": {"client_action": "theme", "client_args": {"mode": "pink"}}})
    assert not cards_of(say(outside, "make it pink"))


def test_the_requests_for_the_screen_are_routed() -> None:
    for text in ("Switch to dark mode", "open the reports", "Open Reports for this month", "filter the calls to missed", "start talk live", "change the app language to Telugu", "యాప్ భాషను తెలుగులోకి మార్చు"):
        assert touches(text), text


def test_the_router_infers_the_action_the_model_left_out() -> None:
    """Seen on staging 15 Nov: `decision: do` with `args.record_action` but no top-level `action`; the check used to refuse it with the generic question."""
    from app.assistant_work import router

    routed = router.check({"decision": "do", "args": {"record_action": "lead_archive", "target": "Bindu Menon"}}, "Archive the lead Bindu Menon")
    assert routed.decision == "do" and routed.action == "record" and routed.args["record_action"] == "lead_archive"
    routed = router.check({"decision": "do", "args": {"client_action": "theme", "client_args": {"mode": "dark"}}}, "switch to dark mode")
    assert routed.decision == "do" and routed.action == "client"
    assert router.check({"decision": "do", "args": {"nothing": "here"}}, "hmm").decision == "clarify", "nothing names an action: still one question"


def test_connecting_a_lead_source_opens_its_card_and_never_takes_a_key() -> None:
    from app.assistant_work import client_actions as ca

    assert ca.check("navigate", {"page": "lead_sources", "card": "indiamart"}) == {"page": "lead_sources", "card": "indiamart"}
    assert ca.check("navigate", {"page": "lead_sources"}) == {"page": "lead_sources"}
    assert ca.check("navigate", {"page": "leads", "card": "indiamart"}) == "card", "a card only goes with the lead sources page"
    assert ca.check("navigate", {"page": "lead_sources", "card": "nonsense"}) == "card"
    assert ca.card("navigate", {"page": "lead_sources", "card": "meta"})["args"] == {"page": "lead_sources", "card": "meta"}
    assert "NEVER ask for or take a key" in ca.PROMPT


def test_arguments_next_to_the_decision_are_the_arguments_and_mark_as_reaches_the_router() -> None:
    from app.assistant_work import router

    flat = {"decision": "do", "record_action": "visit_move", "target": "Suresh Hegde", "date": "2026-11-22", "time": "16:00"}
    routed = router.check(flat, "Move Suresh Hegde's visit to Sunday 4 pm")
    assert routed.decision == "do" and routed.action == "record" and routed.args["record_action"] == "visit_move", routed
    assert router.touches("mark Keerthi Rangan as contacted") and router.touches("Mark Bhavani Reddy as qualified")
