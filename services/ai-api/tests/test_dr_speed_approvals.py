"""Job DR part A3: speed to lead and "approve once". The routes (roles, the second factor, strict input, fixed error sentences), the contract, the worker's step with the fake dialer, the spending gate and the wiring. The database's rules are proved in
supabase/tests/database/127_dr_speed_approvals.test.sql."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.billing import gate
from app.config import ConfigurationError, Settings
from app.outbox.adapter import LocalFakeAdapter
from app.outreach.repository import PostgrestOutreachRepository
from app.outreach.runner import DialResult, FakeDialer, OutreachRunner
from app.outreach.service import OutreachService
from app.outreach.wiring import build_dialer
from app.scheduler.worker import Worker
from tests.dr_outreach_fakes import SHA, FakeOutreachRepository
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.scheduler_fakes import FakeScheduler
from tests.test_scheduler_tick import FakeSession

BASE = f"/v1/tenants/{TENANT_A.id}/outreach"


def world() -> tuple[Any, FakeOutreachRepository]:
    repo = FakeOutreachRepository()
    client, _ = make_client(outreach=OutreachService(repo))
    return client, repo


def plan_body(**kw: Any) -> dict[str, Any]:
    return {"batch_id": str(uuid.uuid4()), "name": "Diwali leads", "goal": "site_visit", "channel": "call", "language": "te", "who": {"contact_ids": [str(uuid.uuid4())]}, **kw}


def rule_body(**kw: Any) -> dict[str, Any]:
    return {"rule_id": str(uuid.uuid4()), "source": "meta_lead_ads", "action": "call_within_minutes", "within_minutes": 2, "goal": "site_visit", "channel": "call", "language": "te", **kw}


# ============================================================================ policy
def test_owner_and_admin_read_the_policy_and_only_the_owner_with_a_second_factor_changes_it() -> None:
    client, repo = world()
    body = client.get(f"{BASE}/policy", headers=auth("a_admin")).json()
    assert body["night_call_minute"] == 570 and body["hours"]["from"] == "assistant" and "holidays" not in body["hours"]
    assert client.get(f"{BASE}/policy", headers=auth("a_sales")).status_code == 403
    assert client.put(f"{BASE}/policy", json={"max_attempts": 4}, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{BASE}/policy", json={"max_attempts": 4}, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.put(f"{BASE}/policy", json={"max_attempts": 4, "then_whatsapp": False}, headers=auth("a_owner")).status_code == 200
    assert ("policy_set", ({"max_attempts": 4, "then_whatsapp": False},)) in repo.calls


@pytest.mark.parametrize("doc", [{"max_attempts": 7}, {"night_call_minute": 100}, {"night_call_minute": 571}, {"handoff_reminder_minutes": 2}, {"call_paise_per_minute": -1}, {"other": 1}, {"max_attempts": "3"}])
def test_policy_values_are_checked(doc: dict[str, Any]) -> None:
    client, repo = world()
    assert client.put(f"{BASE}/policy", json=doc, headers=auth("a_owner")).status_code == 422
    assert not [c for c in repo.calls if c[0] == "policy_set"]


# ============================================================================ a batch plan
def test_staff_build_a_plan_and_every_kind_of_audience_is_accepted() -> None:
    client, repo = world()
    for who in ({"contact_ids": [str(uuid.uuid4())]}, {"lead_ids": [str(uuid.uuid4())]}, {"source": {"source": "excel_upload", "status": "new", "since": "2026-10-01"}}):
        r = client.post(f"{BASE}/batches", json=plan_body(who=who), headers=auth("a_sales"))
        assert r.status_code == 201, r.text
        assert r.json()["batch"]["plan_sha256"] == SHA and r.json()["plan"]["skipped"] == {"no_phone": 1} and r.json()["plan"]["window"] == {"from": "2026-11-06", "to": "2026-11-13"}
    sent = [c[1][0] for c in repo.calls if c[0] == "batch_plan"]
    assert sent[0]["who"]["contact_ids"] and "lead_ids" in sent[1]["who"] and sent[2]["who"]["source"]["since"] == "2026-10-01"
    assert client.post(f"{BASE}/batches", json=plan_body(), headers=auth("a_viewer")).status_code == 403
    assert client.post(f"{BASE}/batches", json=plan_body()).status_code == 401


@pytest.mark.parametrize(
    "extra",
    [
        {"channel": "whatsapp"},                                  # a WhatsApp step needs the approved text
        {"channel": "both", "message_text": None},
        {"who": {}},
        {"who": {"contact_ids": []}},
        {"who": {"contact_ids": [str(uuid.uuid4())], "lead_ids": [str(uuid.uuid4())]}},
        {"goal": "sell_everything"},
        {"language": "fr"},
        {"questions": ["a question"] * 9},
        {"window_days": 15},
        {"max_calls_per_day": 0},
        {"unknown": 1},
        {"batch_id": "not-a-uuid"},
    ],
)
def test_a_plan_with_a_bad_field_is_refused_before_the_database(extra: dict[str, Any]) -> None:
    client, repo = world()
    assert client.post(f"{BASE}/batches", json=plan_body(**extra), headers=auth("a_owner")).status_code == 422
    assert not [c for c in repo.calls if c[0] == "batch_plan"]


def test_whatsapp_with_its_text_is_accepted_and_the_listing_reading_and_items_work() -> None:
    client, repo = world()
    assert client.post(f"{BASE}/batches", json=plan_body(channel="both", message_text="Hello {name}"), headers=auth("a_admin")).status_code == 201
    assert client.get(f"{BASE}/batches?status=running", headers=auth("a_sales")).json()[0]["batch"]["status"] == "running"
    assert client.get(f"{BASE}/batches?status=bogus", headers=auth("a_sales")).status_code == 422
    batch_id = uuid.uuid4()
    assert client.get(f"{BASE}/batches/{batch_id}", headers=auth("a_sales")).json()["progress"]["total"] == 2
    page = client.get(f"{BASE}/batches/{batch_id}/items", headers=auth("a_sales")).json()
    assert len(page["items"]) == 50 and page["next_cursor"] and page["items"][0]["name"] == "Sita Devi"
    again = client.get(f"{BASE}/batches/{batch_id}/items?cursor={page['next_cursor']}", headers=auth("a_sales")).json()
    assert len(again["items"]) == 2 and again["next_cursor"] is None
    assert client.get(f"{BASE}/batches/{batch_id}/items?cursor=@@@", headers=auth("a_sales")).status_code == 422
    assert client.get(f"{BASE}/batches", headers=auth("a_viewer")).status_code == 403


def test_exclusion_is_for_owner_and_admin() -> None:
    client, repo = world()
    batch_id = uuid.uuid4()
    body = {"contact_ids": [str(uuid.uuid4())]}
    assert client.post(f"{BASE}/batches/{batch_id}/exclude", json=body, headers=auth("a_sales")).status_code == 403
    assert client.post(f"{BASE}/batches/{batch_id}/exclude", json=body, headers=auth("a_admin")).status_code == 200
    assert client.post(f"{BASE}/batches/{batch_id}/exclude", json={"contact_ids": []}, headers=auth("a_admin")).status_code == 422


# ============================================================================ approve once
def test_only_the_owner_with_a_second_factor_approves_and_the_hash_binds_the_approval() -> None:
    client, repo = world()
    batch_id = uuid.uuid4()
    url = f"{BASE}/batches/{batch_id}/approve"
    assert client.post(url, json={"plan_sha256": SHA}, headers=auth("a_admin")).status_code == 403
    assert client.post(url, json={"plan_sha256": SHA}, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.post(url, json={"plan_sha256": "xyz"}, headers=auth("a_owner")).status_code == 422
    stale = client.post(url, json={"plan_sha256": "b" * 64}, headers=auth("a_owner"))
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "plan_changed", stale.text
    ok = client.post(url, json={"plan_sha256": SHA}, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["batch"]["status"] == "running" and ok.json()["batch"]["approved_at"]


def test_a_state_refusal_is_a_fixed_sentence() -> None:
    client, repo = world()
    repo.state_error = True
    r = client.post(f"{BASE}/batches/{uuid.uuid4()}/pause", headers=auth("a_admin"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "outreach_state" and "SM811" not in r.text


def test_pause_resume_cancel_and_caps() -> None:
    client, repo = world()
    b = uuid.uuid4()
    assert client.post(f"{BASE}/batches/{b}/pause", headers=auth("a_admin")).json()["batch"]["status"] == "paused"
    assert client.post(f"{BASE}/batches/{b}/resume", headers=auth("a_admin")).json()["batch"]["status"] == "running"
    assert client.post(f"{BASE}/batches/{b}/pause", headers=auth("a_sales")).status_code == 403
    assert client.post(f"{BASE}/batches/{b}/cancel", headers=auth("a_admin")).status_code == 403
    assert client.post(f"{BASE}/batches/{b}/cancel", headers=auth("a_owner")).json()["batch"]["status"] == "cancelled"
    assert client.put(f"{BASE}/batches/{b}/caps", json={"max_calls_per_day": 50}, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{BASE}/batches/{b}/caps", json={"max_calls_per_day": 50}, headers=auth("a_owner", aal="aal1")).status_code == 403
    r = client.put(f"{BASE}/batches/{b}/caps", json={"max_calls_per_day": 50, "max_total_minutes": 600}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["batch"]["max_calls_per_day"] == 50


# ============================================================================ standing rules
def test_a_standing_rule_is_approved_once_by_the_owner_and_staff_can_only_pause_it() -> None:
    client, repo = world()
    assert client.post(f"{BASE}/rules", json=rule_body(), headers=auth("a_admin")).status_code == 403
    assert client.post(f"{BASE}/rules", json=rule_body(), headers=auth("a_owner", aal="aal1")).status_code == 403
    made = client.post(f"{BASE}/rules", json=rule_body(max_calls_per_day=100), headers=auth("a_owner"))
    assert made.status_code == 201 and made.json()["source"] == "meta_lead_ads" and made.json()["active"] is True
    rule = made.json()["id"]
    assert client.get(f"{BASE}/rules", headers=auth("a_admin")).status_code == 200
    assert client.get(f"{BASE}/rules", headers=auth("a_sales")).status_code == 403
    assert client.post(f"{BASE}/rules/{rule}/pause", headers=auth("a_admin")).json()["active"] is False
    assert client.post(f"{BASE}/rules/{rule}/resume", headers=auth("a_admin")).json()["active"] is True
    assert client.post(f"{BASE}/rules/{rule}/pause", headers=auth("a_sales")).status_code == 403
    assert client.put(f"{BASE}/rules/{rule}/caps", json={"max_calls_per_day": 10}, headers=auth("a_owner")).status_code == 200


@pytest.mark.parametrize(
    "extra",
    [
        {"action": "whatsapp_first"},                                    # a WhatsApp action needs the text
        {"action": "whatsapp_then_call", "channel": "call", "message_text": "Hi"},
        {"action": "ring_them"},
        {"within_minutes": 0},
        {"within_minutes": 121},
        {"source": "Bad Source!"},
        {"channel": "whatsapp"},
        {"x": 1},
    ],
)
def test_a_rule_with_a_senseless_combination_is_refused(extra: dict[str, Any]) -> None:
    client, repo = world()
    assert client.post(f"{BASE}/rules", json=rule_body(**extra), headers=auth("a_owner")).status_code == 422


def test_a_whatsapp_first_rule_with_its_text_is_accepted() -> None:
    client, repo = world()
    r = client.post(f"{BASE}/rules", json=rule_body(action="whatsapp_then_call", channel="both", message_text="Hello {name}, thank you for your interest"), headers=auth("a_owner"))
    assert r.status_code == 201, r.text


# ============================================================================ results, hand-offs, reports, costs
def test_staff_report_what_happened_on_a_call_and_a_viewer_cannot() -> None:
    client, repo = world()
    item = uuid.uuid4()
    url = f"{BASE}/items/{item}/result"
    outcome = {"outcome": "positive", "category": "interested", "captured": {"budget": "50 lakh", "area": "Gachibowli"}}
    assert client.post(url, json={"result": "connected", "outcome": outcome, "minutes": 3.5}, headers=auth("a_sales")).status_code == 200
    assert client.post(url, json={"result": "connected"}, headers=auth("a_viewer")).status_code == 403
    for bad in ({"result": "sent"}, {"result": "connected", "minutes": 500}, {"result": "connected", "outcome": {"outcome": "positive", "category": "bogus"}},
                {"result": "connected", "outcome": {"outcome": "positive", "captured": {"Bad Key": "x"}}}, {"result": "connected", "extra": 1}):
        assert client.post(url, json=bad, headers=auth("a_sales")).status_code == 422, bad
    assert repo.results[0][2] == outcome and repo.results[0][3] == 3.5


def test_handoffs_reports_and_costs() -> None:
    client, repo = world()
    assert client.get(f"{BASE}/handoffs?open=true", headers=auth("a_sales")).json()[0]["summary"] == "Sita Devi is interested"
    assert client.get(f"{BASE}/handoffs", headers=auth("a_viewer")).status_code == 403
    h = uuid.uuid4()
    assert client.post(f"{BASE}/handoffs/{h}/acted", headers=auth("a_sales")).json()["acted_at"]
    rep = client.get(f"{BASE}/reports?from=2026-11-01&to=2026-11-30", headers=auth("a_viewer")).json()
    assert rep["by_source"][0]["source"] == "indiamart" and rep["by_source"][0]["cost_per_booking_paise"] == 9200 and rep["total"]["bookings"] == 1
    assert client.get(f"{BASE}/reports?from=nope", headers=auth("a_viewer")).status_code == 422
    assert client.get(f"{BASE}/source-costs", headers=auth("a_admin")).json() == [{"source": "indiamart", "cost_per_lead_paise": 2000}]
    assert client.put(f"{BASE}/source-costs", json={"costs": [{"source": "indiamart", "cost_per_lead_paise": 2500}]}, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{BASE}/source-costs", json={"costs": [{"source": "indiamart", "cost_per_lead_paise": 2500}]}, headers=auth("a_owner")).status_code == 200
    assert client.put(f"{BASE}/source-costs", json={"costs": [{"source": "indiamart", "cost_per_lead_paise": -1}]}, headers=auth("a_owner")).status_code == 422


def test_another_workspace_is_a_404_and_an_unwired_runtime_is_a_503() -> None:
    client, _ = world()
    assert client.get(f"/v1/tenants/{TENANT_B.id}/outreach/policy", headers=auth("a_owner")).status_code == 404
    bare, _ = make_client()
    assert bare.get(f"{BASE}/policy", headers=auth("a_owner")).status_code == 503


def test_a_broken_database_is_a_502_without_its_words() -> None:
    client, repo = world()
    repo.broken = True
    r = client.get(f"{BASE}/reports", headers=auth("a_owner"))
    assert r.status_code == 502 and "down" not in r.text


# ============================================================================ the gate and the contract
def test_approving_and_resuming_calling_are_spending_requests_and_planning_is_not() -> None:
    base = f"/v1/tenants/{TENANT_A.id}"
    batch = uuid.uuid4()
    for method, tail in (("POST", f"/outreach/batches/{batch}/approve"), ("POST", f"/outreach/batches/{batch}/resume"), ("POST", "/outreach/rules"), ("POST", f"/outreach/rules/{batch}/resume")):
        assert gate.classify(method, gate.tail_of(base + tail, str(TENANT_A.id))) == "spend", tail
    for method, tail in (("POST", "/outreach/batches"), ("POST", f"/outreach/batches/{batch}/pause"), ("GET", "/outreach/reports"), ("POST", f"/outreach/items/{batch}/result")):
        assert gate.classify(method, tail) != "spend", tail


def test_the_outreach_contract_is_committed_and_fresh() -> None:
    from app.outreach import contracts

    root = Path(__file__).resolve().parents[3] / "packages" / "contracts"
    assert (root / "outreach.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (root / "outreach.ts").read_text() == contracts.ts_text(), "run `make contracts`"


# ============================================================================ the worker's step
def call(phone: str, **kw: Any) -> dict[str, Any]:
    return {"item_id": str(uuid.uuid4()), "tenant_id": str(TENANT_A.id), "contact_id": str(uuid.uuid4()), "lead_id": None, "name": "Sita", "phone": phone, "language": "te", "goal": "site_visit", "questions": [], "attempt": 1, **kw}


def test_without_a_dialer_nothing_is_taken_from_the_queue_but_leads_are_found_and_reminders_counted() -> None:
    repo = FakeOutreachRepository()
    repo.work = [call("+919876543210")]
    repo.reminders_due = [{"handoff_id": str(uuid.uuid4())}]
    tally = OutreachRunner(repo, None).run("tok")
    assert tally.found == 2 and tally.calls == 0 and tally.reminded == 1
    assert [c[0] for c in repo.calls] == ["scan", "reminders"] and len(repo.work) == 1, "run() was not called, the call is still queued"


@pytest.mark.parametrize(
    "digit, result, category, stop",
    [("0", "no_answer", None, False), ("2", "busy", None, False), ("3", "voicemail", None, False), ("4", "connected", "not_interested", False), ("6", "connected", "interested", False), ("8", "connected", "call_back_later", False), ("9", "connected", "wrong_number", True)],
)
def test_the_fake_dialer_answers_by_the_last_digit_and_the_runner_reports_each_call(digit: str, result: str, category: str | None, stop: bool) -> None:
    repo = FakeOutreachRepository()
    repo.work = [call("+91987654321" + digit)]
    fixed = datetime(2026, 11, 6, 10, 0, tzinfo=UTC)
    runner = OutreachRunner(repo, FakeDialer(clock=lambda: fixed))
    tally = runner.run("tok")
    assert tally.calls == 1 and tally.whatsapp == 1 and tally.failed == 0
    _item, got, outcome, minutes, stopped = repo.results[0]
    assert got == result and stopped is stop and minutes > 0
    assert (outcome or {}).get("category") == category
    if category == "call_back_later":
        assert outcome is not None and outcome["callback_at"] == "2026-11-07T10:00:00+00:00"
    if category == "interested":
        assert outcome is not None and outcome["captured"] == {"budget": "50 lakh", "area": "Gachibowli"}


def test_a_dialer_that_fails_is_a_failed_call_and_a_refused_result_does_not_stop_the_others() -> None:
    class Broken:
        def dial(self, c: dict[str, Any]) -> DialResult:
            raise RuntimeError("line down +919999999999")

    repo = FakeOutreachRepository()
    repo.work = [call("+919876543210"), call("+919876543211")]
    tally = OutreachRunner(repo, Broken()).run("tok")
    assert tally.calls == 2 and tally.failed == 2 and [r[1] for r in repo.results] == ["failed", "failed"]
    repo.work = [call("+919876543210"), call("+919876543211")]
    repo.refuse_results = True
    tally = OutreachRunner(repo, FakeDialer()).run("tok")
    assert tally.calls == 0 and tally.failed == 2


def test_the_worker_runs_the_outreach_step_and_a_crash_in_it_does_not_fail_the_tick(caplog: pytest.LogCaptureFixture) -> None:
    repo = FakeOutreachRepository()
    worker = Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, outreach=OutreachRunner(repo, FakeDialer()))
    assert worker.tick_once() is not None
    assert [c[0] for c in repo.calls] == ["scan", "run", "reminders"]
    repo.broken = True
    with caplog.at_level(logging.ERROR):
        assert worker.tick_once() is not None
    assert "outreach pass crashed: UpstreamError" in caplog.text


# ============================================================================ wiring and the repository's door names
def _settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, **kw)  # type: ignore[call-arg]


def test_the_dialer_is_off_unless_chosen_and_there_is_no_real_one() -> None:
    assert build_dialer(_settings()) is None
    assert isinstance(build_dialer(_settings(outreach_dialer="fake")), FakeDialer)
    with pytest.raises(ConfigurationError):
        build_dialer(_settings(outreach_dialer="twilio"))


def test_the_repository_names_the_database_doors_exactly() -> None:
    import httpx

    seen: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
        return httpx.Response(200, json={})

    repo = PostgrestOutreachRepository("http://db/rest/v1", "anon", client=httpx.Client(base_url="http://db/rest/v1", transport=httpx.MockTransport(handler)))
    t, b = uuid.uuid4(), uuid.uuid4()
    repo.policy_get("tok", t)
    repo.approve("tok", t, b, SHA)
    repo.batch_state("tok", t, b, "pause")
    repo.result("tok", t, b, "connected", None, 1.0, False)
    repo.scan("tok", 5)
    repo.run("tok", 5)
    names = [n for n, _ in seen]
    assert names == ["outreach_policy_get", "outreach_batch_approve", "outreach_batch_state", "outreach_item_result", "scheduler_outreach_scan", "scheduler_outreach_run"]
    assert seen[1][1] == {"p_tenant_id": str(t), "p_batch_id": str(b), "p_plan_sha256": SHA}
    assert seen[3][1]["p_stop"] is False and seen[3][1]["p_minutes"] == 1.0


def test_the_two_new_sqlstates_become_the_two_errors() -> None:
    import httpx

    from app.outreach.errors import OutreachStateError, PlanChangedError

    def refuse(code: str) -> PostgrestOutreachRepository:
        return PostgrestOutreachRepository("http://db/rest/v1", "anon", client=httpx.Client(base_url="http://db/rest/v1", transport=httpx.MockTransport(lambda r: httpx.Response(400, json={"code": code, "message": "words that must not travel"}))))

    t, b = uuid.uuid4(), uuid.uuid4()
    with pytest.raises(PlanChangedError):
        refuse("SM812").approve("tok", t, b, SHA)
    with pytest.raises(OutreachStateError):
        refuse("SM811").batch_state("tok", t, b, "pause")
