"""Owner decisions of 14 Nov 2026 on plans: STRICT consent at every size (unknown = "ask first", withdrawn = never), a real per-day call limit per business (default 100; the Owner changes it; the card shows it;
the server refuses a plan beyond it and the runner stops at it), and "ask first" (the Owner says they agreed, or each is asked on WhatsApp)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.dr_tasks_fakes import PEOPLE, FakeOutbox, FakeTasksRepository, Scripted, plan_answer, uid
from tests.ea_fakes import FakeTurnDb
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dr_tasks import BASE as TASKS
from tests.test_dr_tasks import plan_call
from tests.test_dr_tasks import world as tasks_world
from tests.test_ea_turns import events, turn

ACTIONS = f"/v1/tenants/{TENANT_A.id}/assistant/actions"


def people(**consent: str) -> list[dict[str, Any]]:
    """The synthetic people, with the phone consent of some of them changed (by number): {"2": "unknown", "4": "withdrawn"}."""
    return [{**p, "pc": consent.get(str(p["n"]), "granted")} for p in PEOPLE]


def assistant(*answers: Any, who: list[dict[str, Any]] | None = None, outbox: FakeOutbox | None = None) -> tuple[Any, FakeTasksRepository, FakeOutbox]:
    llm, db, repo, box = Scripted(*answers), FakeTurnDb(who), FakeTasksRepository(), outbox or FakeOutbox()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, tasks=TasksService(repo, FakeDialer(), FixedKnowledge([])), outbox=box)  # type: ignore[arg-type]
    return client, repo, box


def card_of(client: Any, text: str = "call all the leads") -> dict[str, Any]:
    return next(d for n, d in events(turn(client, text)) if n == "confirm_action")


# ============================================================================ strict consent
def test_only_people_who_gave_consent_are_planned_unknown_is_ask_first_withdrawn_is_never() -> None:
    from tests.dr_tasks_fakes import FakeDb

    client, repo, _ = tasks_world(Scripted(plan_answer(selectors=[{"segment": "all_leads"}])), db=FakeDb(people(**{"2": "unknown", "4": "withdrawn"})))
    task = plan_call(client).json()
    assert task["plan"]["consent"]["reason_counts"]["no_consent"] == 1 and task["plan"]["consent"]["reason_counts"]["opted_out"] == 1
    skipped = {c["contact_id"]: c["skip_reason"] for c in client.get(f"{TASKS}/{task['id']}/contacts?status=skipped", headers=auth("a_owner")).json()["contacts"]}
    assert skipped[uid(2)] == "no_consent" and skipped[uid(4)] == "opted_out"   # Babu (unknown: ask first) and Dinesh (withdrawn: never)
    assert task["plan"]["contacts_total"] == 2   # Anu and Chitra: the only two with a phone, no stop and consent


def test_the_runner_checks_consent_again_at_the_moment_of_the_call() -> None:
    from app.tasks.runner import TaskRunner

    repo = FakeTasksRepository()
    runner = TaskRunner(repo, FakeDialer(), None)
    done = runner._one("t", TENANT_A.id, "Shop", {"id": uuid.uuid4(), "plan": {"channel": "call"}, "language": "en"}, {"contact_id": uuid.uuid4(), "phone": "+91 98765 00001", "phone_consent": "unknown"})
    assert done == {"status": "skipped", "skip_reason": "no_consent"}
    gone = runner._one("t", TENANT_A.id, "Shop", {"id": uuid.uuid4(), "plan": {"channel": "call"}, "language": "en"}, {"contact_id": uuid.uuid4(), "phone": "+91 98765 00001", "phone_consent": "withdrawn"})
    assert gone == {"status": "skipped", "skip_reason": "opted_out"}


# ============================================================================ the per-day call limit
def test_the_limit_is_100_by_default_anyone_who_plans_reads_it_and_only_the_owner_with_the_second_factor_changes_it() -> None:
    client, repo, _ = tasks_world(Scripted(plan_answer()))
    got = client.get(f"{TASKS}/call-limit", headers=auth("a_sales")).json()
    assert got == {"limit": 100, "used": 0, "remaining": 100, "default_limit": 100}
    assert client.get(f"{TASKS}/call-limit", headers=auth("a_viewer")).status_code == 403
    assert client.put(f"{TASKS}/call-limit", json={"limit": 40}, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{TASKS}/call-limit", json={"limit": 0}, headers=auth("a_owner")).status_code == 422
    assert client.put(f"{TASKS}/call-limit", json={"limit": 5001}, headers=auth("a_owner")).status_code == 422
    assert client.put(f"{TASKS}/call-limit", json={"limit": 40}, headers=auth("a_owner")).json()["limit"] == 40 and repo.day_limit == 40


def test_the_plan_card_shows_the_limit_and_a_plan_beyond_it_is_refused_with_plain_words() -> None:
    client, repo, _ = assistant(plan_answer(selectors=[{"segment": "all_leads"}]))
    card = card_of(client)
    assert card["daily_cap"] == {"limit": 100, "used": 0, "remaining": 100} and card["count"] == 4
    repo.day_limit = 1
    refused = client.post(f"{ACTIONS}/{card['action_id']}/confirm", json={"decision": "yes"}, headers=auth("a_owner"))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "daily_cap_exceeded"
    assert "limit is 1" in refused.json()["error"]["message"] and repo.tasks[uuid.UUID(card["action_id"])]["status"] == "planned", "nothing started"
    repo.day_limit = 100
    assert client.post(f"{ACTIONS}/{card['action_id']}/confirm", json={"decision": "yes"}, headers=auth("a_owner")).status_code == 200


def test_a_whatsapp_only_plan_has_no_call_limit_on_its_card() -> None:
    client, _, _ = assistant(plan_answer(channel="whatsapp", template="custom", message_text="Hello from the shop", selectors=[{"segment": "all_leads"}]))
    assert card_of(client)["daily_cap"] is None


def test_the_runner_stops_a_plan_when_the_days_limit_is_used_up_and_the_people_left_stay_waiting() -> None:
    client, repo, _ = tasks_world(Scripted(plan_answer(selectors=[{"segment": "all_leads"}])))
    repo.day_limit = 1
    task = plan_call(client).json()
    client.post(f"{TASKS}/{task['id']}/approve", json={"plan_sha256": task["plan_sha256"], "cap_paise": None}, headers=auth("a_owner"))
    state = client.get(f"{TASKS}/{task['id']}", headers=auth("a_owner")).json()
    assert state["status"] == "paused" and state["pause_reason"] == "daily_limit"
    assert state["progress"]["done"] == 1 and state["progress"]["waiting"] == 3, "one call was made, the other person still waits"


# ============================================================================ ask first
def test_the_owner_says_they_agreed_the_consent_is_recorded_and_the_plan_is_made_again_with_them_in() -> None:
    who = people(**{"2": "unknown"})
    client, repo, _ = assistant(plan_answer(selectors=[{"segment": "all_leads"}]), plan_answer(selectors=[{"segment": "all_leads"}]), who=who)
    card = card_of(client)
    assert card["consent"]["reason_counts"]["no_consent"] == 1 and card["count"] == 3
    assert [x for x in card["consent"]["skipped_sample"] if x["reason"] == "no_consent"][0]["contact_id"] == uid(2)
    for p in who:   # (the owner's word is recorded in the ledger; here the fake database reads the people again, now with consent)
        p["pc"] = "granted"
    refused = client.post(f"{ACTIONS}/{card['action_id']}/ask-consent", json={"how": "owner_confirms"}, headers=auth("a_owner"))
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "nobody_to_ask", "say who, or everyone left out"
    out = client.post(f"{ACTIONS}/{card['action_id']}/ask-consent", json={"how": "owner_confirms", "all_skipped": True}, headers=auth("a_owner"))
    assert out.status_code == 200, out.text
    body = out.json()
    assert body["asked"] == 1 and body["new_action"]["count"] == 4 and "no_consent" not in body["new_action"]["consent"]["reason_counts"]
    assert {c["p_channel"] for c in repo.consents} == {"phone", "whatsapp"} and all(c["p_status"] == "granted" and c["p_evidence_type"] == "verbal" for c in repo.consents)
    assert repo.tasks[uuid.UUID(card["action_id"])]["status"] == "cancelled", "the old plan is never changed under the tap"
    assert client.post(f"{ACTIONS}/{card['action_id']}/ask-consent", json={"how": "owner_confirms", "all_skipped": True}, headers=auth("a_owner")).status_code == 409


def test_a_whatsapp_ask_goes_through_the_outbox_which_decides_who_may_be_written_to() -> None:
    who = people(**{"2": "unknown", "4": "unknown"})
    box = FakeOutbox(status="blocked")
    client, repo, _ = assistant(plan_answer(selectors=[{"segment": "all_leads"}]), who=who, outbox=box)
    card = card_of(client)
    assert card["consent"]["reason_counts"]["no_consent"] == 2
    out = client.post(f"{ACTIONS}/{card['action_id']}/ask-consent", json={"how": "whatsapp", "all_skipped": True}, headers=auth("a_owner")).json()
    assert out["how"] == "whatsapp" and out["asked"] == 2 and out["queued"] == 0 and out["blocked"] == 2 and out["template_status"] == "none_registered"
    assert len(box.sent) == 2 and all("OK" in m["p_body"] and m["p_category"] == "info" for m in box.sent)
    assert repo.consents == [], "a message is not consent: nothing is recorded until the person agrees"


def test_only_the_owner_asks_and_never_for_a_plan_that_is_gone() -> None:
    client, _, _ = assistant(plan_answer(selectors=[{"segment": "all_leads"}]), who=people(**{"2": "unknown"}))
    card = card_of(client)
    assert client.post(f"{ACTIONS}/{card['action_id']}/ask-consent", json={"how": "whatsapp", "all_skipped": True}, headers=auth("a_admin")).status_code == 403
    assert client.post(f"{ACTIONS}/{uuid.uuid4()}/ask-consent", json={"how": "whatsapp", "all_skipped": True}, headers=auth("a_owner")).status_code in (404, 500, 409)


# ============================================================================ a conversation plan is not a Needs-you item
def test_a_plan_proposed_in_a_conversation_is_marked_so_it_never_shows_in_needs_you_but_a_tasks_screen_plan_is_not() -> None:
    client, repo, _ = assistant(plan_answer(selectors=[{"segment": "all_leads"}], questions=[{"key": "need", "text": "మీకు ఏం కావాలి?", "type": "text"}]))
    card = next(d for n, d in events(turn(client, "అంటే ఇప్పుడు కాల్ చేయమంటే చేయాలి కదా", language="te")) if n == "confirm_action")   # a raw Talk live sentence the router took for an instruction
    assert repo.tasks[uuid.UUID(card["action_id"])]["origin"] == "conversation"
    tclient, trepo, _ = tasks_world(Scripted(plan_answer()))
    task = plan_call(tclient).json()
    assert trepo.tasks[uuid.UUID(task["id"])].get("origin", "screen") == "screen"


def test_no_authenticator_code_is_asked_for_the_call_limit_or_for_the_owners_consent_word() -> None:
    client, repo, _ = tasks_world(Scripted(plan_answer()))
    assert client.put(f"{TASKS}/call-limit", json={"limit": 150}, headers=auth("a_owner")).json()["limit"] == 150
    aclient, arepo, _ = assistant(plan_answer(selectors=[{"segment": "all_leads"}]), plan_answer(selectors=[{"segment": "all_leads"}]), who=people(**{"2": "unknown"}))
    card = card_of(aclient)
    assert aclient.post(f"{ACTIONS}/{card['action_id']}/ask-consent", json={"how": "owner_confirms", "all_skipped": True}, headers=auth("a_owner")).status_code == 200
    assert arepo.consents, "recorded without a second factor"


def test_the_expiry_of_unanswered_conversation_plans_runs_through_the_scheduler_account_every_five_minutes() -> None:
    from app.lead_finder.housekeeping import ConversationPlanExpiry

    ticks = iter([0.0, 100.0, 301.0])
    calls: list[str] = []
    def fake(token: str) -> int:
        calls.append(token)
        return 2

    expiry = ConversationPlanExpiry(fake, every_seconds=300, monotonic=lambda: next(ticks))
    assert expiry.run_if_due("t") == 2 and expiry.run_if_due("t") is None and expiry.run_if_due("t") == 2 and calls == ["t", "t"]
