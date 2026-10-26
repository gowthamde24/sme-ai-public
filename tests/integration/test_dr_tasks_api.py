"""Job DR B1 on the real local stack, through HTTP: a task saved with the real task functions, reviewed, approved ONCE by the Owner (second factor), run by the fake dialer and through the real outbox, and reported. Real GoTrue, PostgREST and Postgres; our API in-process. All data is synthetic.

What this proves that the pgTAP file (127) and the unit tests cannot: the database's answers are accepted by the strict response models and conform to the generated contract (packages/contracts/tasks.schema.json); the roles hold over HTTP (Sales plans, only the Owner approves, Viewer reads); the approval starts a run whose messages are ordinary outbox rows (assistant, followup, a deterministic id) and whose people end done; the report puts a short answer first; another workspace sees nothing. The planning call itself (the model) is covered by the unit tests with a scripted model and by `make tasks-eval`."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import operator_sql
from conftest import bearer

from app.tasks.repository import PostgrestTasksRepository

ROOT = Path(__file__).resolve().parents[2]
TASKS = json.loads((ROOT / "packages" / "contracts" / "tasks.schema.json").read_text(encoding="utf-8"))


def conforms(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": TASKS["$schema"], "$ref": f"#/$defs/{definition}", "$defs": TASKS["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def people(tenant: Any, n: int = 3) -> list[dict[str, str]]:
    """n synthetic people with a lead each (made with the operator's SQL, like the other suites' fixtures)."""
    out = []
    for i in range(n):
        contact, lead = str(uuid.uuid4()), str(uuid.uuid4())
        operator_sql.sql(
            f"with co as (insert into public.companies (id, tenant_id, name) values (gen_random_uuid(), '{tenant.id}', 'Task Co {i}') returning id), "
            f"ct as (insert into public.contacts (id, tenant_id, company_id, full_name, phone) select '{contact}', '{tenant.id}', co.id, 'Task Person {i}', '+00 95000 0000{i}' from co returning company_id) "
            f"insert into public.leads (id, tenant_id, company_id, contact_id) select '{lead}', '{tenant.id}', ct.company_id, '{contact}' from ct"
        )
        out.append({"contact_id": contact, "lead_id": lead})
    return out


PLAN = {
    "channel": "both", "goal": "Ask each supplier for today's price and delivery day", "questions": [{"key": "price", "text": "What is your price per bag today?", "type": "amount"}, {"key": "delivery_day", "text": "Which day can you deliver?", "type": "date"}],
    "script_notes": "", "message_text": None, "window": {"date": "2026-11-02", "from_minute": 600, "to_minute": 1140}, "follow_up": {"kind": "none", "after_hours": 24}, "contacts_total": 3, "notes": [], "unmatched": [],
}


def save(repo: PostgrestTasksRepository, token: str, tenant: Any, task_id: str, who: list[dict[str, str]]) -> dict[str, Any]:
    return repo.save(token, {
        "p_tenant_id": str(tenant.id), "p_task_id": task_id, "p_instruction": "Ask my three suppliers their price per bag and delivery day", "p_language": "en", "p_status": "planned", "p_template": "supplier_price_enquiry",
        "p_question": None, "p_answer": None, "p_plan": PLAN, "p_estimate": {"contacts": 3, "calls": 3, "messages": 3, "minutes": 6, "cost_paise": 1080, "basis": "fake rates"}, "p_estimated_paise": 1080, "p_contacts": who,
    })


def test_a_task_is_planned_reviewed_approved_once_run_and_reported(client: Any, stack: Any, eval_world: Any) -> None:
    a, b = eval_world.a, eval_world.b
    repo = PostgrestTasksRepository(stack.rest, stack.anon_key)
    task_id = str(uuid.uuid4())
    who = people(a)
    saved = save(repo, a.users["sales"].token, a, task_id, who)
    assert saved["status"] == "planned" and len(saved["plan_sha256"]) == 64
    base = f"/v1/tenants/{a.id}/tasks"

    got = client.get(f"{base}/{task_id}", headers=bearer(a.users["viewer"]))
    assert got.status_code == 200, got.text
    conforms(got.json(), "TaskOut")
    assert got.json()["progress"]["waiting"] == 3 and got.json()["plan"]["contacts_total"] == 3 and len(got.json()["plan"]["contacts_sample"]) == 3
    assert client.get(f"/v1/tenants/{b.id}/tasks/{task_id}", headers=bearer(b.users["owner"])).status_code == 404, "another workspace sees nothing"
    assert client.get(f"{base}/templates", headers=bearer(a.users["sales"])).status_code == 200

    listed = client.get(f"{base}/{task_id}/contacts", headers=bearer(a.users["sales"])).json()
    conforms(listed, "TaskContactsOut")
    assert len(listed["contacts"]) == 3 and all(c["status"] == "waiting" and c["phone_last4"] for c in listed["contacts"])

    # one person out: the hash changes and the old approval is refused
    out = client.post(f"{base}/{task_id}/contacts/exclude", json={"contact_ids": [who[2]["contact_id"]]}, headers=bearer(a.users["sales"]))
    assert out.status_code == 200 and out.json()["progress"]["excluded"] == 1 and out.json()["plan_sha256"] != saved["plan_sha256"]
    assert client.post(f"{base}/{task_id}/approve", json={"plan_sha256": saved["plan_sha256"]}, headers=bearer(a.users["owner"])).json()["error"]["code"] == "plan_changed"
    assert client.post(f"{base}/{task_id}/approve", json={"plan_sha256": out.json()["plan_sha256"]}, headers=bearer(a.users["sales"])).status_code == 403, "only the Owner approves"

    approved = client.post(f"{base}/{task_id}/approve", json={"plan_sha256": out.json()["plan_sha256"]}, headers=bearer(a.users["owner"]))
    assert approved.status_code == 200, approved.text
    conforms(approved.json(), "TaskOut")

    # the run followed the approval: two people done, one excluded, messages in the outbox as the assistant's followups
    state = client.get(f"{base}/{task_id}", headers=bearer(a.users["viewer"])).json()
    assert state["status"] == "done" and state["progress"]["done"] == 2 and state["progress"]["excluded"] == 1 and state["spent_paise"] > 0
    assert operator_sql.sql(f"select count(*) from public.outbox_messages where tenant_id = '{a.id}' and source = 'assistant' and category = 'followup' and lead_id in ('{who[0]['lead_id']}', '{who[1]['lead_id']}')") == "2"
    assert operator_sql.sql(f"select count(*) from public.outbox_messages where tenant_id = '{a.id}' and lead_id = '{who[2]['lead_id']}' and source = 'assistant'") == "0", "an excluded person is never written to"

    report = client.get(f"{base}/{task_id}/report", headers=bearer(a.users["viewer"]))
    assert report.status_code == 200, report.text
    conforms(report.json(), "ReportOut")
    body = report.json()
    assert body["simulated"] is True and body["short_answer"] and body["totals"]["contacts"] == 2
    assert all(row["simulated"] and row["recording_url"] is None for row in body["rows"])
    assert any(row["transcript"] and row["transcript"][0]["who"] == "assistant" for row in body["rows"]), "a call opens with the assistant (and its AI line)"

    # a finished task is final; a second approval and a plan of the same id are refused
    assert client.post(f"{base}/{task_id}/approve", json={"plan_sha256": out.json()["plan_sha256"]}, headers=bearer(a.users["owner"])).json()["error"]["code"] == "task_state"
    assert client.post(f"{base}/{task_id}/cancel", headers=bearer(a.users["admin"])).status_code == 409


def test_the_roles_and_the_cap_hold_over_http(client: Any, stack: Any, eval_world: Any) -> None:
    a = eval_world.a
    repo = PostgrestTasksRepository(stack.rest, stack.anon_key)
    task_id = str(uuid.uuid4())
    who = people(a, 3)
    saved = save(repo, a.users["owner"].token, a, task_id, who)
    base = f"/v1/tenants/{a.id}/tasks"
    assert client.get(f"{base}/{task_id}", headers=bearer(a.users["viewer"])).status_code == 200
    assert client.post(f"{base}/{task_id}/contacts/exclude", json={"contact_ids": [who[0]["contact_id"]]}, headers=bearer(a.users["viewer"])).status_code == 403
    assert client.post(f"{base}/{task_id}/cancel", headers=bearer(a.users["sales"])).status_code == 403
    # a cap below what the first person costs: the task pauses and says why
    r = client.post(f"{base}/{task_id}/approve", json={"plan_sha256": saved["plan_sha256"], "cap_paise": 100}, headers=bearer(a.users["owner"]))
    assert r.status_code == 200, r.text
    state = client.get(f"{base}/{task_id}", headers=bearer(a.users["owner"])).json()
    assert state["status"] == "paused" and state["pause_reason"] == "cap" and state["progress"]["waiting"] >= 1
    assert client.post(f"{base}/{task_id}/resume", headers=bearer(a.users["admin"])).status_code == 409
    assert client.post(f"{base}/{task_id}/cap", json={"cap_paise": 100000}, headers=bearer(a.users["admin"])).status_code == 403
    assert client.post(f"{base}/{task_id}/cap", json={"cap_paise": 100000}, headers=bearer(a.users["owner"])).json()["cap_paise"] == 100000
    assert client.post(f"{base}/{task_id}/resume", headers=bearer(a.users["admin"])).status_code == 200
    assert client.get(f"{base}/{task_id}", headers=bearer(a.users["owner"])).json()["status"] == "done"
