"""The router for typed requests (job assistant-does-the-work design 2; owner, 5 Nov 2026: "then the router, starting with the common-actions list"): do / clarify / can't-do-yet.

Code decides whether a request is about a common action at all (closed words; otherwise the turn goes on as before with no extra call). ONE model call picks the action and its arguments; CODE checks
every argument against the owner's words (an hour, a name, a number must be in what they typed) and builds the step from the state read through the screen's own routes; the card's words are code's
("Calling hours: Mon-Sat 09:00-19:00 -> Mon-Sat 10:00-19:00"). Every write is a plan card -> Do it -> Undo where the route has one; the routes keep their role and second-factor rules."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant_work.router import check, touches
from app.callsettings.service import CallSettingsService
from app.lead_sources.service import LeadSourcesService
from tests.aw_fakes import FakeWorkStore
from tests.dp_call_fakes import FakeCallSettingsRepository
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import auth, make_client
from tests.test_aw_files import BASE, MATCHER, cards_of, events, text_of

INDIAMART = str(uuid.uuid4())


class Switch:
    def __init__(self) -> None:
        self.enabled = False

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"enabled": self.enabled, "rules": []}

    def set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        self.enabled = enabled
        return self.get(token, tenant_id)


def world(*answers: Any) -> tuple[Any, Scripted, FakeCallSettingsRepository, Switch, FakeLeadSourcesRepository]:
    llm = Scripted(*answers)
    db = FakeTurnDb()
    calls = FakeCallSettingsRepository()
    switch = Switch()
    sources = FakeLeadSourcesRepository()
    sources.sources_[INDIAMART] = {"id": INDIAMART, "kind": "indiamart", "tag": "indiamart", "label": "IndiaMART", "status": "active", "token_hash": None, "token_hint": None, "consent_id": None, "received_count": 3}
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, call_settings=CallSettingsService(calls), auto_reply=switch, lead_sources=LeadSourcesService(sources, receiver=Receiver(), matcher=MATCHER),  # type: ignore[arg-type]
                            assistant_work=FakeWorkStore())
    return client, llm, calls, switch, sources


def say(client: Any, text: str, language: str = "en", user: str = "a_owner") -> list[tuple[str, dict[str, Any]]]:
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "language": language}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth(user)))


def do(client: Any, plan_id: str, *, confirmed: bool = False, user: str = "a_owner", **claims: Any) -> Any:
    return client.post(f"{BASE}/plans/{plan_id}/decide", json={"decision": "do", "confirmed": confirmed}, headers=auth(user, **claims))


# ============================================================================ by code
@pytest.mark.parametrize(("text", "routed"), [("change calling hours to 10 to 7", True), ("turn off auto-reply on Sundays", True), ("pause IndiaMART for a week", True),
                                              ("add Ravi 98765 43210 as a lead", True), ("remove the example data", True), ("cancel my plan", True),
                                              ("how many leads came today?", False), ("call the new leads tomorrow", False), ("make a quote for Lakshmi, 40 sarees", False)])
def test_only_requests_about_a_common_action_are_routed(text: str, routed: bool) -> None:
    assert touches(text) is routed


def test_every_argument_must_be_in_the_owners_words() -> None:
    text = "change calling hours to 10 to 7"
    assert check({"decision": "do", "action": "calling_hours", "args": {"from_time": "10:00", "to_time": "19:00"}}, text).args == {"from_minute": 600, "to_minute": 1140}
    assert check({"decision": "do", "action": "calling_hours", "args": {"from_time": "09:30", "to_time": "19:00"}}, text).decision == "clarify", "an hour that is not in the words"
    assert check({"decision": "do", "action": "calling_hours", "args": {"from_time": "10:00", "to_time": "22:00"}}, "calls 10 to 22").decision == "clarify", "outside 09:00-21:00"
    assert check({"decision": "do", "action": "add_lead", "args": {"name": "Ravi", "phone": "98765 43210"}}, "add Ravi 9876543210 as a lead").decision == "do"
    assert check({"decision": "do", "action": "add_lead", "args": {"name": "Ravi", "phone": "91234 56789"}}, "add Ravi 9876543210 as a lead").decision == "clarify", "a number that is not in the words"
    assert check({"decision": "do", "action": "add_lead", "args": {"name": "Suresh", "phone": "98765 43210"}}, "add Ravi 9876543210 as a lead").decision == "clarify", "a name that is not in the words"
    assert check({"decision": "do", "action": "send_whatsapp"}, "x").decision == "clarify"
    assert check({"decision": "cant_do", "screen": "billing"}, "cancel my plan").screen == "billing"


# ============================================================================ in the chat
def test_calling_hours_become_a_plan_card_with_old_and_new_and_undo_puts_them_back() -> None:
    client, llm, calls, _, _ = world({"decision": "do", "action": "calling_hours", "args": {"from_time": "10:00", "to_time": "19:00"}})
    evs = say(client, "change calling hours to 10 to 7")
    card = cards_of(evs)[0]
    assert card["kind"] == "plan" and card["plan"]["owner_only"] is True and card["plan"]["needs_second_factor"] is True
    step = card["plan"]["steps"][0]
    assert step["tool"] == "call-settings.put_settings" and step["undoable"] is True and "-> Mon-Sat 10:00-19:00" in step["summary"]
    assert calls.settings is None, "nothing saved before the OK"
    done = do(client, card["plan"]["plan_id"])
    assert done.status_code == 200 and done.json()["status"] == "done", done.text
    assert calls.settings is not None and calls.settings["hours"] == {"days": [1, 2, 3, 4, 5, 6], "from_minute": 600, "to_minute": 1140}
    undone = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/undo", headers=auth("a_owner"))
    assert undone.status_code == 200 and undone.json()["status"] == "undone", undone.text
    assert calls.settings["hours"] != {"days": [1, 2, 3, 4, 5, 6], "from_minute": 600, "to_minute": 1140}, "the hours before are back"


def test_auto_reply_off_and_the_same_again_changes_nothing() -> None:
    client, llm, _, switch, _ = world({"decision": "do", "action": "auto_reply", "args": {"on": True}}, {"decision": "do", "action": "auto_reply", "args": {"on": False}})
    card = cards_of(say(client, "switch on auto-reply"))[0]
    assert card["plan"]["sensitive"] == "sending" and "off -> on" in card["plan"]["steps"][0]["summary"]
    assert do(client, card["plan"]["plan_id"], confirmed=True).json()["status"] == "done" and switch.enabled is True
    switch.enabled = False
    assert "already so" in text_of(say(client, "turn off auto-reply"))


def test_pause_a_lead_source_by_name_and_undo_resumes_it() -> None:
    client, _, _, _, sources = world({"decision": "do", "action": "pause_source", "args": {"source": "IndiaMART"}})
    card = cards_of(say(client, "pause IndiaMART"))[0]
    assert card["plan"]["steps"][0]["summary"] == "IndiaMART: active -> paused"
    assert do(client, card["plan"]["plan_id"]).json()["status"] == "done" and sources.sources_[INDIAMART]["status"] == "paused"
    assert client.post(f"{BASE}/plans/{card['plan']['plan_id']}/undo", headers=auth("a_owner")).json()["status"] == "undone" and sources.sources_[INDIAMART]["status"] == "active"


def test_an_unknown_source_is_said_with_the_real_names() -> None:
    client, _, _, _, _ = world({"decision": "do", "action": "pause_source", "args": {"source": "JustDial"}})
    said = text_of(say(client, "pause JustDial"))
    assert "couldn't find a lead source called 'JustDial'" in said and "IndiaMART" in said


def test_add_one_typed_lead_is_the_import_card_with_undo() -> None:
    client, _, _, _, _ = world({"decision": "do", "action": "add_lead", "args": {"name": "Ravi Kumar", "phone": "98765 43210", "city": "Guntur"}})
    card = cards_of(say(client, "add Ravi Kumar 98765 43210 from Guntur as a lead"))[0]
    assert card["kind"] == "file_preview" and card["plan"]["steps"][0]["tool"] == "lead-imports.import_leads" and card["rows"][0][:2] == ["Ravi Kumar", "98765 43210"]


def test_billing_is_screen_only_with_its_link() -> None:
    client, _, _, _, _ = world({"decision": "cant_do", "screen": "billing"})
    evs = say(client, "cancel my plan")
    card = cards_of(evs)[0]
    assert card["kind"] == "cant_do" and card["reason"] == "screen_only" and card["screen"]["href"] == "/plans" and "Only a person can do that" in text_of(evs)


def test_a_request_the_router_says_is_not_its_own_goes_on_as_before() -> None:
    client, llm, _, _, _ = world({"decision": "not_mine"}, "The chat answer.")
    evs = say(client, "what does auto-reply mean?")
    assert cards_of(evs) == [] and llm.requests[0].final_result is not None and llm.requests[0].final_result.name == "route"


def test_a_missing_hour_is_one_question() -> None:
    client, _, calls, _, _ = world({"decision": "clarify", "question": "From what time to what time should I call?"})
    evs = say(client, "change the calling hours")
    assert text_of(evs) == "From what time to what time should I call?" and cards_of(evs) == [] and calls.settings is None


def test_a_sales_member_cannot_run_an_owner_plan() -> None:
    client, _, calls, _, _ = world({"decision": "do", "action": "calling_hours", "args": {"from_time": "10:00", "to_time": "19:00"}})
    card = cards_of(say(client, "change calling hours to 10 to 7"))[0]
    assert do(client, card["plan"]["plan_id"], user="a_sales").status_code in (403, 404) and calls.settings is None


def test_telugu() -> None:
    client, _, _, _, _ = world({"decision": "do", "action": "pause_source", "args": {"source": "IndiaMART"}})
    assert "మార్పు ఇది" in text_of(say(client, "IndiaMART ని ఆపండి", language="te"))


def test_the_live_eval_requests_meant_for_an_action_all_pass_the_word_gate() -> None:
    """scripts/eval_aw_router.py's 30 requests: every one meant for a common action (or screen-only) reaches the router; the ones that are not are left to the model's own "not_mine"."""
    from pathlib import Path

    source = (Path(__file__).resolve().parents[3] / "scripts" / "eval_aw_router.py").read_text()
    cases = eval(source[source.index("CASES: list[tuple[str, str, str, str]] = ") + len("CASES: list[tuple[str, str, str, str]] = "): source.index("\n]\n") + 2])  # noqa: S307  the file's own literal list
    assert len(cases) == 30 and sum(1 for _, lang, _, _ in cases if lang == "te") >= 8
    missed = [text for text, _, expected, _ in cases if expected != "not_mine" and not touches(text)]
    assert missed == []
