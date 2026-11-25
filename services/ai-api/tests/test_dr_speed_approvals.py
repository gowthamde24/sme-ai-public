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
    assert body["night_call_minute"] == 600 and body["hours"]["from"] == "assistant" and "holidays" not in body["hours"]
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
        {"action": "whatsapp_first"},                                    # a message-first rule is not a thing: a lead is called first
        {"action": "whatsapp_then_call", "channel": "call"},
        {"action": "ring_them"},
        {"within_minutes": -1},   # 0 is now allowed (immediately)
        {"within_minutes": 121},
        {"source": "Bad Source!"},
        {"channel": "whatsapp"},
        {"x": 1},
        {"message_text": "Hello {name}"},                                # WhatsApp is a template picked by name, never words typed on a rule (rules v2, 15 Nov 2026)
        {"wa_first_template": "Lead Ack!"},
        {"wa_first_template": "followup_nudge"},                         # a marketing template is not a first message
        {"wa_missed_template": "lead_ack"},                              # nor is the first message the one after a missed call
        {"language": "xx"},
    ],
)
def test_a_rule_with_a_senseless_combination_is_refused(extra: dict[str, Any]) -> None:
    client, repo = world()
    assert client.post(f"{BASE}/rules", json=rule_body(**extra), headers=auth("a_owner")).status_code == 422


def test_call_first_a_whatsapp_first_or_message_only_rule_is_refused_and_a_call_rule_with_templates_is_accepted() -> None:
    """Owner, 5 Nov 2026: a new lead is called first. Rules v2 (15 Nov): WhatsApp after the calls is an approved template by name."""
    client, repo = world()
    for action, channel in (("whatsapp_then_call", "both"), ("whatsapp_first", "both"), ("call_within_minutes", "whatsapp")):
        r = client.post(f"{BASE}/rules", json=rule_body(action=action, channel=channel), headers=auth("a_owner"))
        assert r.status_code == 422, (action, channel, r.text)
    r = client.post(f"{BASE}/rules", json=rule_body(action="call_within_minutes", channel="both", language="auto", wa_first_template="lead_ack", wa_missed_template="missed_call_followup"), headers=auth("a_owner"))
    assert r.status_code == 201, r.text
    saved = next(doc for name, args in repo.calls if name == "rule_save" for doc in args)
    assert saved["language"] == "auto" and saved["wa_first_template"] == "lead_ack" and "message_text" not in saved


def test_a_rule_without_words_to_type_and_without_a_language_gets_auto_and_the_default_templates() -> None:
    client, repo = world()
    body = rule_body(channel="both")
    del body["language"]
    assert client.post(f"{BASE}/rules", json=body, headers=auth("a_owner")).status_code == 201
    saved = next(doc for name, args in repo.calls if name == "rule_save" for doc in args)
    assert saved["language"] == "auto" and "wa_first_template" not in saved   # null = the defaults (lead_ack, missed_call_followup), resolved in the database


def test_a_rule_carries_its_plan_the_calls_the_retries_and_the_missed_call_template() -> None:
    """Rules v2 (owner, 15 Nov): the screen writes the whole summary from `plan.steps`: the call, 10 minutes, 2 hours, the next morning at 10:00, then the template (only for a rule that sends WhatsApp)."""
    client, repo = world()
    rows = client.get(f"{BASE}/rules", headers=auth("a_owner")).json()
    assert rows[0]["plan"]["steps"] == [
        {"kind": "call", "minutes": 2}, {"kind": "retry", "after_minutes": 10}, {"kind": "retry", "after_minutes": 120}, {"kind": "retry", "next_morning": "10:00"},
    ], "a call-only rule has no WhatsApp step"
    saved = client.post(f"{BASE}/rules", json=rule_body(channel="both", within_minutes=0), headers=auth("a_owner")).json()
    assert saved["plan"]["steps"][0] == {"kind": "call", "minutes": 0} and saved["plan"]["steps"][-1] == {"kind": "whatsapp", "template": "missed_call_followup"}
    assert "message_text" not in saved and saved["warnings"] == []


def test_the_policy_retry_steps_are_read_and_changed_by_the_owner_with_the_second_factor() -> None:
    client, repo = world()
    assert client.get(f"{BASE}/policy", headers=auth("a_owner")).json()["retry_steps"] == [{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 600}]
    steps = [{"after_minutes": 15}, {"next_morning_minute": 600}]
    assert client.put(f"{BASE}/policy", json={"retry_steps": steps}, headers=auth("a_owner")).status_code == 200
    assert repo.calls[-2][1][0] == {"retry_steps": steps} or any(name == "policy_set" and args[0] == {"retry_steps": steps} for name, args in repo.calls)
    for bad in ([], [{"after_minutes": 0}], [{"after_minutes": 5, "next_morning_minute": 600}], [{"x": 1}], [{"next_morning_minute": 1440}], [{"after_minutes": 5}] * 7):
        assert client.put(f"{BASE}/policy", json={"retry_steps": bad}, headers=auth("a_owner")).status_code == 422, bad
    assert client.put(f"{BASE}/policy", json={"retry_steps": steps}, headers=auth("a_admin")).status_code == 403


def test_the_rule_templates_list_has_a_status_and_a_preview_with_sample_values() -> None:
    client, repo = world()
    items = client.get(f"{BASE}/rule-templates", headers=auth("a_owner")).json()["items"]
    first, missed = items
    assert (first["key"], first["moment"], first["status"], first["language"]) == ("lead_ack", "first", "approved", "en")
    assert first["preview"] == "Hello Ravi, thank you for contacting Sri Lakshmi Silks. We will call you shortly."
    assert (missed["key"], missed["moment"], missed["status"]) == ("missed_call_followup", "missed", "draft") and missed["variables"] == ["first_name", "business_name"]
    repo.main_language = "te"
    te = client.get(f"{BASE}/rule-templates", headers=auth("a_owner")).json()["items"]
    assert te[0]["language"] == "te" and te[0]["status"] == "missing"
    assert te[0]["preview"] == "Hello Ravi, thank you for contacting Sri Lakshmi Silks. We will call you shortly."   # no Telugu row yet: "missing", and the preview is the English standard text
    assert client.get(f"{BASE}/rule-templates", headers=auth("a_sales")).status_code == 403


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
