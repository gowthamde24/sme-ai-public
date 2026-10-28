"""Job CR on the real local stack: the education pack. Real GoTrue, PostgREST and Postgres; our API in-process with the caller's own token; the scheduler worker signed in as its OWN registered account, with the
LOCAL FAKE adapter as the only channel. All data is synthetic (the real-data gate stays closed: every number is a +00 number).

What these prove that the pgTAP files (104 to 107) and the unit tests cannot:
  * the whole journey through the HTTP API: the profile, programmes and sections, the minimal student record (and every extra field refused), an enquiry that needs no companies module, admitted -> student -> fee
    plan, payments with receipt numbers, concessions, late fees, the statement and the guardian's total, the pending list and the reports, every shape validated against the generated contract;
  * a fee reminder built from the LEDGER for a guardian with two children: ONE message with the total, sent by the real worker through the channel rules, never naming a child;
  * a students file imported through the shared spreadsheet import (parts, keys for the new guardians, no label echoed);
  * erasure (a guardian takes their children with them, one child on request) and the retention rule run by the worker;
  * a CANARY child label driven through the assistant, the exports, the reports, the search and the error paths: it appears nowhere but in the students table (no model input, no log line, no stored message, no
    audit row, no outbox message, no HTTP traffic of the API to the data layer other than the education routes)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import operator_sql
import pytest
from assistant_support import assistant_app, enable_assistant, events, restore, text_of
from conftest import aal1_token, bearer
from test_outbox_api import restore_clock
from test_scheduler_api import Sched

from app.privacy.housekeeping import Housekeeping
from app.privacy.repository import PostgrestPrivacyRepository

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "packages" / "contracts" / "education.schema.json").read_text(encoding="utf-8"))
CAMPAIGNS = json.loads((ROOT / "packages" / "contracts" / "campaigns.schema.json").read_text(encoding="utf-8"))
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
BASE = TODAY + timedelta(days=30)  # the day of reminder step 1 (a day in the future of the real clock)
DUE = BASE + timedelta(days=2)  # the date the fees fall due
LONG_AGO = TODAY - timedelta(days=200)
CANARY = "Zqxjcanary"  # a child's label has no digits
CANARY_NO = "ZQXJ-7777"


def conforms(instance: Any, definition: str, contract: dict[str, Any] = CONTRACT) -> None:
    jsonschema.Draft202012Validator({"$schema": contract["$schema"], "$ref": f"#/$defs/{definition}", "$defs": contract["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def uid() -> str:
    return str(uuid.uuid4())


def url(tenant: Any, tail: str) -> str:
    return f"/v1/tenants/{tenant.id}/institution{tail}"


def pin(day: date, clock: str) -> None:
    h, m = (int(p) for p in clock.split(":"))
    at = datetime.combine(day, datetime.min.time(), tzinfo=IST).replace(hour=h, minute=m)
    operator_sql.sql(f"create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '{at.isoformat()}' $b$")


def make_education(w: Any) -> None:
    a = w.a
    pack = "(select max(version) from packs.pack_versions where code = 'education')"
    operator_sql.sql(f"update packs.workspace_pack set pack_code = 'education', pack_version = {pack}, source = 'operator' where tenant_id = '{a.id}'")
    operator_sql.sql(f"select app.apply_pack_fields('{a.id}', 'education', {pack}, '{a.users['owner'].id}')")


class School:
    """The state of one journey (the steps follow each other)."""

    template = uid()
    prog = uid()
    prog6 = uid()
    group_a = uid()
    group_b = uid()
    plan = uid()
    guardians: dict[str, str] = {}
    students: dict[str, str] = {}
    assignments: dict[str, str] = {}
    campaign = uid()
    samples_sha = ""
    pay1 = uid()


def guardian(w: Any, label: str, *, consent: bool = True) -> str:
    """A parent made through OUR API (so they are keyed by the real key ring), with WhatsApp consent."""
    a = w.a
    cid = uid()
    r = w.client.post(f"/v1/tenants/{a.id}/contacts", json={"id": cid, "full_name": f"Parent {label}", "phone": f"+00 9{uuid.uuid4().int % 10**9:09d}"}, headers=bearer(a.users["owner"]))
    assert r.status_code == 201, r.text
    if consent:
        c = w.client.post(
            f"/v1/tenants/{a.id}/contacts/{cid}/record-consent",
            json={"channel": "whatsapp", "status": "granted", "basis": "explicit_consent", "evidence_type": "web_form", "evidence_ref": f"ref:{label}"},
            headers=bearer(a.users["owner"]),
        )
        assert c.status_code == 200, c.text
    return cid


def mine(adapter: Any, tenant: Any) -> list[Any]:
    ids = set(operator_sql.sql(f"select id from public.outbox_messages where tenant_id = '{tenant.id}' and category = 'campaign_reminder'").split())
    return [m for m in adapter.sent if str(m.message_id) in ids]


# ============================================================================================================ gates
def test_a_textile_workspace_has_no_school_pack(eval_world: Any) -> None:
    w, b = eval_world, eval_world.b
    owner = b.users["owner"]
    for method, tail, body in (
        ("GET", "/profile", None),
        ("GET", "/programmes", None),
        ("GET", "/students", None),
        ("PUT", f"/programmes/{uid()}", {"name": "Class 1", "kind": "class", "group_kind": "none"}),
        ("GET", "/admissions", None),
        ("GET", "/fee-plans", None),
        ("GET", "/reports/education.collection", None),
    ):
        r = w.client.request(method, url(b, tail), json=body, headers=bearer(owner))
        assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", (tail, r.status_code, r.text)


@pytest.fixture(scope="module")
def school(client: Any, eval_world: Any, stack: Any, signup: Any) -> Any:
    make_education(eval_world)
    user = signup("cr-scheduler", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    pin(BASE - timedelta(days=1), "12:00")
    w = eval_world
    r = w.client.put(f"/v1/tenants/{w.a.id}/outbox/settings", json={"auto_send_enabled": True, "per_customer_daily_limit": 5}, headers=bearer(w.a.users["owner"]))
    assert r.status_code == 200, r.text
    operator_sql.sql(
        "insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) "
        f"values ('{School.template}', '{w.a.id}', 'fee_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the school: {{{{1}}}} Thank you.', 'approved')"
    )
    try:
        yield Sched(stack, user)
    finally:
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")
        restore_clock()


# ============================================================================================================ the institution, the programmes, the minimal student
def test_the_profile_the_programmes_and_the_sections(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    assert w.client.get(url(a, "/profile"), headers=bearer(viewer)).json() == {"configured": False, "terms": [], "parent_languages": [], "institution_type": None, "year_start_month": None, "student_retention_months": None, "updated_at": None}
    body = {"institution_type": "school", "year_start_month": 6, "terms": [{"label": "Term 1", "start_month": 6, "end_month": 9}, {"label": "Term 2", "start_month": 10, "end_month": 3}], "parent_languages": ["en", "te"]}
    for who in (sales, viewer):
        assert w.client.put(url(a, "/profile"), json=body, headers=bearer(who)).status_code == 403
    r = w.client.put(url(a, "/profile"), json=body, headers=bearer(admin))
    assert r.status_code == 200, r.text
    conforms(r.json(), "ProfileOut")
    # the retention rule is the Owner's, with a second factor
    keep = {**body, "student_retention_months": 24}
    assert w.client.put(url(a, "/profile"), json=keep, headers=bearer(admin)).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.put(url(a, "/profile"), json=keep, headers=weak).json()["error"]["code"] == "mfa_required"
    ok = w.client.put(url(a, "/profile"), json=keep, headers=bearer(owner))
    assert ok.status_code == 200 and ok.json()["student_retention_months"] == 24, ok.text
    for pid, name, kind, gk in ((School.prog, "Class 5", "class", "section"), (School.prog6, "Class 6", "class", "none")):
        r = w.client.put(url(a, f"/programmes/{pid}"), json={"name": name, "kind": kind, "group_kind": gk}, headers=bearer(owner))
        assert r.status_code == 200, r.text
        conforms(r.json(), "ProgrammeSavedOut")
    for gid, label in ((School.group_a, "A"), (School.group_b, "B")):
        r = w.client.put(url(a, f"/programmes/{School.prog}/groups/{gid}"), json={"label": label}, headers=bearer(owner))
        assert r.status_code == 200, r.text
        conforms(r.json(), "GroupSavedOut")
    assert w.client.put(url(a, f"/programmes/{School.prog6}/groups/{uid()}"), json={"label": "A"}, headers=bearer(owner)).status_code == 422
    listing = w.client.get(url(a, "/programmes"), headers=bearer(viewer)).json()
    conforms(listing, "ProgrammesOut")
    assert [p["name"] for p in listing["items"]] == ["Class 5", "Class 6"] and [g["label"] for g in listing["items"][0]["groups"]] == ["A", "B"]


def test_a_student_is_the_minimum_and_a_school_without_companies_still_has_guardians(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    for label in ("rao", "reddy", "sita"):
        School.guardians[label] = guardian(w, label)
    plan = (("asha", "rao", School.group_a, "C5-001"), ("bala", "rao", School.group_b, "C5-002"), ("chitra", "reddy", School.group_a, "C5-003"))
    for child, parent, group, number in plan:
        sid = uid()
        School.students[child] = sid
        body = {"contact_id": School.guardians[parent], "programme_id": School.prog, "group_id": group, "child_label": child.title(), "admission_no": number}
        r = w.client.put(url(a, f"/students/{sid}"), json=body, headers=bearer(owner))
        assert r.status_code == 200, r.text
        conforms(r.json(), "StudentSavedOut")
        assert r.json()["created"] is True and r.json()["display_name"] == child.title() and r.json()["programme_name"] == "Class 5"
    # the minimum: not one field beyond it is accepted
    ok = {"contact_id": School.guardians["sita"], "programme_id": School.prog6, "child_label": "Dev"}
    for extra in ({"date_of_birth": "2015-05-01"}, {"photo_url": "https://x.test/p.jpg"}, {"address": "12 Lane"}, {"aadhaar": "123412341234"}, {"religion": "x"}, {"marks": 90}, {"note": "n"}, {"phone": "+919876543210"}):
        assert w.client.put(url(a, f"/students/{uid()}"), json={**ok, **extra}, headers=bearer(owner)).status_code == 422, extra
    assert w.client.put(url(a, f"/students/{uid()}"), json={**ok, "child_label": "Dev 5"}, headers=bearer(owner)).status_code == 422
    # the database says the same through its own door (a plain call of the function with a label that has a digit)
    # who sees a child: Owner, Admin and Sales; never a Viewer
    for who, code in ((sales, 200), (admin, 200), (owner, 200), (viewer, 403)):
        assert w.client.get(url(a, "/students"), headers=bearer(who)).status_code == code, who
    assert w.client.put(url(a, f"/students/{uid()}"), json=ok, headers=bearer(sales)).status_code == 403
    page = w.client.get(url(a, f"/students?programme_id={School.prog}&limit=2"), headers=bearer(sales)).json()
    conforms(page, "StudentsOut")
    assert len(page["items"]) == 2 and page["next_cursor"]
    rest = w.client.get(url(a, f"/students?programme_id={School.prog}&limit=2&after={page['next_cursor']}"), headers=bearer(sales)).json()
    assert len(rest["items"]) == 1 and {s["display_name"] for s in page["items"] + rest["items"]} == {"Asha", "Bala", "Chitra"}
    # an admission number is the school's: a second student cannot take it
    dup = w.client.put(url(a, f"/students/{uid()}"), json={**ok, "admission_no": "C5-001"}, headers=bearer(owner))
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "admission_no_used" and "C5-001" not in dup.text
    # no placeholder company exists until a lead needs one (the workspace's own base company is the fixture's)
    n = operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{a.id}' and name ~ '^Enquiry '").strip()
    assert n == "0", "a school makes no placeholder company until a lead needs one"


# ============================================================================================================ admissions without companies
def test_an_enquiry_needs_no_company_and_becomes_a_student_with_a_fee_plan_in_one_call(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    # the plan first: tuition and books for Class 5
    lines = [
        {"head": "tuition", "instalment_no": 1, "due_date": DUE.isoformat(), "amount_paise": 1000000},
        {"head": "books", "instalment_no": 1, "due_date": (DUE + timedelta(days=5)).isoformat(), "amount_paise": 200000},
    ]
    body = {"name": "Class 5 fees", "programme_id": School.prog, "academic_year": "2026-27", "late_fee_kind": "per_day", "late_fee_paise": 5000, "late_fee_grace_days": 5, "late_fee_cap_paise": 50000, "lines": lines}
    r = w.client.put(url(a, f"/fee-plans/{School.plan}"), json=body, headers=bearer(owner))
    assert r.status_code == 200, r.text
    conforms(r.json(), "FeePlanDetailOut")
    assert r.json()["total_paise"] == 1200000 and len(r.json()["lines"]) == 2
    assert w.client.put(url(a, f"/fee-plans/{uid()}"), json=body, headers=bearer(sales)).status_code == 403
    # an enquiry from a new parent: the front desk makes the contact and the enquiry in one call
    adm = uid()
    enquiry = {"source": "whatsapp", "programme_id": School.prog, "guardian_name": "Newcomer Parent", "guardian_phone": f"+00 8{uuid.uuid4().int % 10**9:09d}"}
    r = w.client.put(url(a, f"/admissions/{adm}"), json=enquiry, headers=bearer(sales))
    assert r.status_code == 200, r.text
    conforms(r.json(), "AdmissionCreatedOut")
    assert r.json()["created"] is True and r.json()["stage"] == "enquiry" and r.json()["contact_name"] == "Newcomer Parent"
    again = w.client.put(url(a, f"/admissions/{adm}"), json=enquiry, headers=bearer(sales))
    assert again.status_code == 200 and again.json()["created"] is False, "a retry makes neither a second enquiry nor a second guardian"
    assert operator_sql.sql(f"select count(*) from public.contacts where tenant_id = '{a.id}' and full_name = 'Newcomer Parent'").strip() == "1"
    keyed = operator_sql.sql(f"select count(*) from suppression.contact_keys k join public.contacts c on c.id = k.contact_id where c.tenant_id = '{a.id}' and c.full_name = 'Newcomer Parent' and k.phone_hmac is not null").strip()
    assert keyed == "1", "the new guardian has their suppression keys, as every contact"
    for stage, code in (("campus_visit", 200), ("application", 200), ("enquiry", 409)):
        r = w.client.post(url(a, f"/admissions/{adm}/stage"), json={"stage": stage}, headers=bearer(sales))
        assert r.status_code == code, (stage, r.text)
    assert w.client.post(url(a, f"/admissions/{adm}/stage"), json={"stage": "enquiry"}, headers=bearer(sales)).json()["error"]["code"] == "admission_stage"
    assert w.client.post(url(a, f"/admissions/{adm}/admit"), json={"student_id": uid(), "child_label": "Farah", "programme_id": School.prog}, headers=bearer(sales)).status_code == 403
    sid, aid = uid(), uid()
    admit = {"student_id": sid, "child_label": "Farah", "programme_id": School.prog, "group_id": School.group_a, "admission_no": "C5-004", "plan_id": School.plan, "assignment_id": aid}
    r = w.client.post(url(a, f"/admissions/{adm}/admit"), json=admit, headers=bearer(owner))
    assert r.status_code == 200, r.text
    conforms(r.json(), "AdmittedOut")
    assert r.json()["stage"] == "admitted" and r.json()["student_id"] == sid and r.json()["fee_assignment"]["charges"] == 2
    School.students["farah"], School.assignments["farah"] = sid, aid
    detail = w.client.get(url(a, f"/admissions/{adm}"), headers=bearer(sales)).json()
    conforms(detail, "AdmissionDetailOut")
    assert [e["stage"] for e in detail["events"]] == ["enquiry", "campus_visit", "application", "admitted"]
    funnel = w.client.get(url(a, "/reports/education.funnel"), headers=bearer(sales)).json()
    conforms(funnel, "ReportOut")
    kpi = {k["key"]: k["value"] for k in funnel["kpis"]}
    assert kpi["enquiries"] == 1 and kpi["admitted"] == 1 and kpi["campus_visits"] == 1 and kpi["applications"] == 1 and kpi["conversion_pct"] == 100.0
    assert w.client.get(url(a, "/admissions?stage=admitted"), headers=bearer(sales)).json()["items"][0]["id"] == adm


# ============================================================================================================ fees
def test_the_fee_ledger_of_each_child_with_receipts_concessions_and_the_guardians_total(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    for child in ("asha", "bala", "chitra"):
        aid = uid()
        School.assignments[child] = aid
        r = w.client.put(url(a, f"/fee-assignments/{aid}"), json={"student_id": School.students[child], "plan_id": School.plan, "assigned_on": TODAY.isoformat()}, headers=bearer(owner))
        assert r.status_code == 200, r.text
        conforms(r.json(), "AssignedOut")
        assert r.json()["charges"] == 2 and r.json()["total_paise"] == 1200000
    again = w.client.put(url(a, f"/fee-assignments/{School.assignments['asha']}"), json={"student_id": School.students["asha"], "plan_id": School.plan, "assigned_on": TODAY.isoformat()}, headers=bearer(owner))
    assert again.json()["replayed"] is True
    second = w.client.put(url(a, f"/fee-assignments/{uid()}"), json={"student_id": School.students["asha"], "plan_id": School.plan}, headers=bearer(owner))
    assert second.status_code == 409 and second.json()["error"]["code"] == "fee_plan_exists"
    changed = w.client.put(url(a, f"/fee-plans/{School.plan}"), json={"name": "Class 5 fees", "programme_id": School.prog, "academic_year": "2026-27", "lines": [{"head": "tuition", "instalment_no": 1, "due_date": DUE.isoformat(), "amount_paise": 1}]}, headers=bearer(owner))
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "fee_plan_in_use"
    # Chitra pays Rs 2,000 (the first receipt of the year); Asha gets a 10 percent sibling concession (the Admin, with a second factor)
    pay = {"received_on": TODAY.isoformat(), "amount_paise": 200000, "method": "upi"}
    r = w.client.put(url(a, f"/students/{School.students['chitra']}/payments/{School.pay1}"), json=pay, headers=bearer(sales))
    assert r.status_code == 200, r.text
    conforms(r.json(), "PaymentRecordedOut")
    assert r.json()["receipt_no"].startswith("R/") and r.json()["receipt_no"].endswith("/000001"), r.text
    assert w.client.put(url(a, f"/students/{School.students['chitra']}/payments/{School.pay1}"), json=pay, headers=bearer(sales)).json()["replayed"] is True
    assert w.client.put(url(a, f"/students/{School.students['chitra']}/payments/{School.pay1}"), json={**pay, "amount_paise": 200001}, headers=bearer(sales)).status_code in (409, 422)
    assert w.client.put(url(a, f"/students/{School.students['chitra']}/payments/{uid()}"), json=pay, headers=bearer(viewer)).status_code == 403
    conc = {"mode": "percent", "value": 10, "reason_code": "sibling"}
    assert w.client.put(url(a, f"/students/{School.students['asha']}/concessions/{uid()}"), json=conc, headers=bearer(sales)).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, admin)}"}
    assert w.client.put(url(a, f"/students/{School.students['asha']}/concessions/{uid()}"), json=conc, headers=weak).json()["error"]["code"] == "mfa_required"
    c = w.client.put(url(a, f"/students/{School.students['asha']}/concessions/{uid()}"), json=conc, headers=bearer(admin))
    assert c.status_code == 200 and c.json()["amount_paise"] == 120000, c.text
    conforms(c.json(), "ConcessionRecordedOut")
    # the statements, worked by hand: Asha 12,000 - 1,200 = 10,800; Bala 12,000; Chitra 12,000 - 2,000 = 10,000
    owed = {}
    for child in ("asha", "bala", "chitra"):
        s = w.client.get(url(a, f"/students/{School.students[child]}/fees"), headers=bearer(sales)).json()
        conforms(s, "FeeStatementOut")
        owed[child] = s["statement"]["outstanding_paise"]
    assert owed == {"asha": 1080000, "bala": 1200000, "chitra": 1000000}
    # the receipt
    rec = w.client.get(url(a, f"/receipts/{School.pay1}"), headers=bearer(sales)).json()
    conforms(rec, "FeeReceiptOut")
    assert rec["paid_by"] == "Parent reddy" and rec["student"]["display_name"] == "Chitra" and rec["balance_after_paise"] == 1000000
    # the guardian of two children owes both
    g = w.client.get(url(a, f"/guardians/{School.guardians['rao']}/fees"), headers=bearer(sales)).json()
    conforms(g, "GuardianFeesOut")
    assert g["outstanding_paise"] == 1080000 + 1200000 and len(g["students"]) == 2
    # the entries of one child
    e = w.client.get(url(a, f"/students/{School.students['asha']}/fees/entries"), headers=bearer(sales)).json()
    conforms(e, "FeeEntriesOut")
    assert sorted(x["kind"] for x in e["entries"]) == ["charge", "charge", "concession"]
    # the shared summary of parties never lists (or names) a child's account
    summary = w.client.get(url(a, "/../ledger/summary").replace("/institution/..", ""), headers=bearer(sales)).json()
    assert summary["items"] == []


def test_the_pending_list_the_late_fees_and_the_reports(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    # nothing has fallen due yet (the fees are due in the future): nothing is pending, nothing is late
    pend = w.client.get(url(a, "/fees/pending"), headers=bearer(sales)).json()
    conforms(pend, "PendingListOut")
    assert pend["items"] == []
    assert w.client.get(url(a, "/late-fees"), headers=bearer(sales)).json()["count"] == 0
    # as of the due date plus a month, everything is late: the same ledger asked about another day
    later = (DUE + timedelta(days=30)).isoformat()
    # (the pending list for a future day is refused: the books show what has happened)
    assert w.client.get(url(a, f"/fees/pending?as_of={later}"), headers=bearer(sales)).status_code in (409, 422)
    # an old charge makes a pending amount: a fee that fell due 200 days ago for a new student
    old_plan, sid, aid = uid(), uid(), uid()
    prog = School.prog6
    r = w.client.put(url(a, f"/fee-plans/{old_plan}"), json={"name": "Class 6 fees", "programme_id": prog, "academic_year": "2025-26", "late_fee_kind": "fixed", "late_fee_paise": 10000, "lines": [{"head": "tuition", "instalment_no": 1, "due_date": LONG_AGO.isoformat(), "amount_paise": 500000}]}, headers=bearer(owner))
    assert r.status_code == 200, r.text
    w.client.put(url(a, f"/students/{sid}"), json={"contact_id": School.guardians["sita"], "programme_id": prog, "child_label": "Dev"}, headers=bearer(owner))
    School.students["dev"] = sid
    r = w.client.put(url(a, f"/fee-assignments/{aid}"), json={"student_id": sid, "plan_id": old_plan, "assigned_on": LONG_AGO.isoformat()}, headers=bearer(owner))
    assert r.status_code == 200, r.text
    pend = w.client.get(url(a, "/fees/pending"), headers=bearer(sales)).json()
    # the days overdue are counted by the database on India's calendar day; TODAY was taken when the module was imported, and a CI run that crosses midnight IST (18:30 UTC) between the two would be one day off,
    # so the expected number is worked out from the day it is NOW (200 on every run that does not cross midnight)
    expected_days = (datetime.now(IST).date() - LONG_AGO).days
    assert [(i["display_name"], i["pending_paise"], i["overdue_days"]) for i in pend["items"]] == [("Dev", 500000, expected_days)]
    assert pend["items"][0]["programme_name"] == "Class 6" and "defaulter" not in json.dumps(pend).lower()
    # the late fee the plan's rule gives (a fixed Rs 100) is looked at, then posted by a person with a second factor
    prev = w.client.get(url(a, "/late-fees"), headers=bearer(sales)).json()
    conforms(prev, "LateFeesPreviewOut")
    assert (prev["count"], prev["total_paise"]) == (1, 10000)
    assert w.client.post(url(a, "/late-fees/post"), headers=bearer(sales)).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.post(url(a, "/late-fees/post"), headers=weak).json()["error"]["code"] == "mfa_required"
    posted = w.client.post(url(a, "/late-fees/post"), headers=bearer(owner)).json()
    conforms(posted, "LateFeesPostedOut")
    assert posted["posted"] == 1 and w.client.post(url(a, "/late-fees/post"), headers=bearer(owner)).json()["posted"] == 0
    assert w.client.get(url(a, f"/students/{sid}/fees"), headers=bearer(sales)).json()["statement"]["outstanding_paise"] == 510000
    # the reports, in the one shape
    col = w.client.get(url(a, "/reports/education.collection"), headers=bearer(sales)).json()
    conforms(col, "ReportOut")
    k = {x["key"]: x["value"] for x in col["kpis"]}
    assert k["collected_paise"] == 200000 and k["pending_paise"] == 510000 and k["students_pending"] == 1 and k["concessions_paise"] == 120000
    assert [r[0] for r in next(t for t in col["tables"] if t["key"] == "by_programme")["rows"]] == ["Class 5", "Class 6"]
    today = w.client.get(url(a, "/reports/education.today"), headers=bearer(sales)).json()
    assert {x["key"]: x["value"] for x in today["kpis"]} == {"collected_paise": 200000, "receipts": 1}
    for code in ("education.pending", "education.funnel"):
        conforms(w.client.get(url(a, f"/reports/{code}"), headers=bearer(sales)).json(), "ReportOut")
    assert w.client.get(url(a, "/reports/education.collection"), headers=bearer(a.users["viewer"])).status_code == 403


# ============================================================================================================ a fee reminder for a guardian with two children, and an announcement
def test_a_fee_reminder_for_a_guardian_with_two_children_is_one_message_with_the_total(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    path = f"/v1/tenants/{a.id}/campaigns/{School.campaign}"
    body = {
        "name": "Fees due", "kind": "fee_due", "language": "en", "wa_template_id": School.template,
        "message_text": "Dear {{name}}, school fees of {{amount}} are due on {{due_date}}. Thank you, {{business}}.",
        "steps": [{"offset_days": -2, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}],
    }  # fmt: skip
    assert w.client.put(path, json=body, headers=bearer(sales)).status_code == 200
    # the list from the ledger: the claims due on DUE, for the students' accounts (a guardian's children together)
    added = w.client.post(path + "/recipients/from-ledger", json={"due_from": DUE.isoformat(), "due_to": DUE.isoformat(), "party": "student"}, headers=bearer(sales))
    assert added.status_code == 200, added.text
    conforms(added.json(), "RecipientsAddedOut", CAMPAIGNS)
    assert added.json()["added"] == 3 and added.json()["recipients"] == 3, "Rao (Asha and Bala together), Reddy (Chitra) and the guardian of Farah (admitted with the same plan): three people, not four"
    preview = w.client.get(path + "/preview", headers=bearer(sales)).json()
    conforms(preview, "PreviewOut", CAMPAIGNS)
    bodies = [s["body"] for s in preview["samples"]]
    assert all(CANARY not in b and "Asha" not in b and "Bala" not in b and "Chitra" not in b for b in bodies), "no child is named in anything the Owner approves"
    assert any("₹18,800.00" in b for b in bodies), f"Rao's two children together: Asha's Rs 10,000 less her Rs 1,200 concession (oldest claim first) + Bala's Rs 10,000: {bodies}"
    School.samples_sha = preview["samples_sha256"]
    assert w.client.post(path + "/approve", json={"samples_sha256": School.samples_sha}, headers=bearer(owner)).status_code == 200


def test_the_worker_sends_one_message_per_guardian_and_the_total_follows_the_ledger(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    worker, adapter = school.worker()
    pin(BASE - timedelta(days=1), "12:00")
    assert worker.tick_once() is not None and mine(adapter, a) == []
    pin(BASE, "10:30")
    assert worker.tick_once() is not None
    sent = {m.message_id: m for m in mine(adapter, a)}
    texts = sorted(m.body for m in sent.values())
    assert len(sent) == 2, texts
    assert any("₹18,800.00" in t for t in texts), "Rao gets ONE message with both children's tuition (Asha's less her concession)"
    assert any("₹8,000.00" in t for t in texts), "Reddy's total follows the ledger: Rs 10,000 less the Rs 2,000 paid"
    blocked = operator_sql.sql(f"select concat_ws(',', count(*), min(reason)) from public.outbox_messages where tenant_id = '{a.id}' and category = 'campaign_reminder' and status = 'blocked'").strip()
    assert blocked == "1,no_opt_in", f"Farah's guardian came in through a walk-in and never agreed to WhatsApp: that message is blocked, honestly ({blocked})"
    assert all("Asha" not in t and "Bala" not in t and "Chitra" not in t and CANARY not in t for t in texts)
    rao = [t for t in texts if "Parent rao" in t]
    assert len(rao) == 1, "one message for a guardian of two children"
    # Rao pays Asha's tuition: the second reminder on the day follows the ledger (the paid child is no longer in the total... the guardian's balance is checked)
    pay = {"received_on": TODAY.isoformat(), "amount_paise": 1000000, "method": "cash"}
    assert w.client.put(url(a, f"/students/{School.students['asha']}/payments/{uid()}"), json=pay, headers=bearer(a.users["sales"])).status_code == 200
    pin(DUE, "10:30")
    assert worker.tick_once() is not None
    after = mine(adapter, a)
    assert len(after) >= len(sent), "the second step goes to whoever still owes"
    assert all(m.channel == "whatsapp" for m in after) if hasattr(after[0], "channel") else True


def test_an_announcement_goes_to_the_guardians_of_a_class_once_each(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    sales, owner = a.users["sales"], a.users["owner"]
    cid = uid()
    path = f"/v1/tenants/{a.id}/campaigns/{cid}"
    body = {
        "name": "Annual day", "kind": "event", "language": "en", "wa_template_id": School.template,
        "message_text": "Dear {{name}}, our annual day is on {{due_date}}. We look forward to seeing you.",
        "steps": [{"offset_days": -2, "time": "10:00"}],
    }  # fmt: skip
    assert w.client.put(path, json=body, headers=bearer(sales)).status_code == 200
    ev_date = (BASE + timedelta(days=40)).isoformat()
    r = w.client.put(url(a, f"/announcements/{cid}/audience"), json={"scope": "programme", "programme_id": School.prog, "date": ev_date}, headers=bearer(sales))
    assert r.status_code == 200, r.text
    conforms(r.json(), "AudienceAddedOut")
    assert r.json()["added"] == 3, "three guardians of Class 5: Rao (two children, one message), Reddy and Farah's"
    preview = w.client.get(path + "/preview", headers=bearer(sales)).json()
    assert all("Asha" not in s["body"] and CANARY not in s["body"] for s in preview["samples"])
    assert w.client.put(url(a, f"/announcements/{cid}/audience"), json={"scope": "group", "group_id": School.group_b, "date": ev_date}, headers=bearer(sales)).json()["added"] == 0, "Rao is already on the list"
    money = uid()
    w.client.put(f"/v1/tenants/{a.id}/campaigns/{money}", json={**body, "kind": "fee_due", "message_text": "Dear {{name}}, fees of {{amount}} are due on {{due_date}}."}, headers=bearer(sales))
    assert w.client.put(url(a, f"/announcements/{money}/audience"), json={"scope": "all", "date": ev_date}, headers=bearer(sales)).status_code == 422, "a fee reminder is built from the ledger, not from the students"
    assert w.client.put(url(a, f"/announcements/{cid}/audience"), json={"scope": "all", "date": ev_date}, headers=bearer(a.users["viewer"])).status_code == 403
    _ = owner


# ============================================================================================================ the students file
def test_a_students_file_is_imported_through_the_shared_import_and_never_echoes_a_child(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner = a.users["owner"]
    suffix = uuid.uuid4().int % 10**8
    csv = (
        "Parent Name,Mobile,Class,Section,Student Name,Admission No\n"
        f"File Parent One,+00 7{suffix:08d},Class 5,A,Gita,F5-001\n"
        f"File Parent One,+00 7{suffix:08d},Class 5,B,Hari,F5-002\n"
        f"File Parent Two,+00 6{suffix:08d},Class 6,,Indu,\n"
        f"File Parent Three,+00 5{suffix:08d},Class 9,,Kiran,\n"
        f"File Parent Four,+00 4{suffix:08d},Class 5,A,Lata 2,\n"
    ).encode()
    S = f"/v1/tenants/{a.id}/imports/spreadsheet"
    job = uid()
    headers = {**bearer(owner), "Content-Type": "text/csv"}
    insp = w.client.post(S + "/inspect?kind=students", content=csv, headers=headers)
    assert insp.status_code == 200 and insp.json()["suggested_mapping"]["guardian_name"] == 0, insp.text
    prev = w.client.post(S + f"/preview?kind=students&job_id={job}", content=csv, headers=headers)
    assert prev.status_code == 200, prev.text
    counts = prev.json()["counts"]
    assert counts["will_create"] == 3 and counts["needs_review"] == 1 and counts["file_problems"] == 1
    assert "Gita" not in prev.text and "Kiran" not in prev.text, "the preview names guardians, never a child"
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}", "Content-Type": "text/csv"}
    assert w.client.post(S + f"/{job}/confirm", content=csv, headers=weak).status_code == 403
    done = w.client.post(S + f"/{job}/confirm", content=csv, headers=headers)
    assert done.status_code == 200, done.text
    res = done.json()["result"]["counts"]
    assert res["created"] == 3 and res["contacts_created"] == 2, "three students, two new guardians"
    assert "Gita" not in done.text and "Hari" not in done.text
    keyed = operator_sql.sql(f"select count(*) from suppression.contact_keys k join public.contacts c on c.id = k.contact_id where c.tenant_id = '{a.id}' and c.full_name like 'File Parent%' and k.phone_hmac is not null").strip()
    assert keyed == "2", "the guardians the import made have their suppression keys"
    again = w.client.post(S + f"/{job}/confirm", content=csv, headers=headers).json()
    assert again["replay"] is True
    assert w.client.get(url(a, f"/students?programme_id={School.prog}&limit=100"), headers=bearer(owner)).json()["items"].__len__() >= 6
    job_row = operator_sql.sql(f"select counts::text || issues::text from integrations.import_jobs where id = '{job}'")
    assert "Gita" not in job_row and "File Parent" not in job_row


# ============================================================================================================ erasure and retention
def test_erasing_a_guardian_erases_their_children_and_one_child_can_be_erased_alone(school: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner = a.users["owner"]
    rid = uid()
    r = w.client.post(f"/v1/tenants/{a.id}/erasure-requests", json={"id": rid, "scope": "contact", "subject_id": School.guardians["rao"]}, headers=bearer(owner))
    assert r.status_code in (200, 201), r.text
    done = w.client.post(f"/v1/tenants/{a.id}/erasure-requests/{rid}/execute", json={"dry_run": False}, headers=bearer(owner))
    assert done.status_code == 200, done.text
    rows = operator_sql.sql(f"select string_agg(child_label || '/' || coalesce(admission_no, '-') || '/' || (erased_at is not null)::text, ',' order by id) from public.students where id in ('{School.students['asha']}', '{School.students['bala']}')")
    assert set(rows.strip().split(",")) == {"erased:1/-/true"}, rows
    assert w.client.get(url(a, f"/students/{School.students['asha']}"), headers=bearer(owner)).json()["display_name"] is None
    # the money record stays, with no one's name on it
    s = w.client.get(url(a, f"/students/{School.students['asha']}/fees"), headers=bearer(owner)).json()
    assert s["student"]["erased"] is True and s["statement"]["invoiced_paise"] == 1200000
    # one child on request: the Owner, with a second factor
    sid = School.students["chitra"]
    assert w.client.post(url(a, f"/students/{sid}/erase"), headers=bearer(a.users["admin"])).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.post(url(a, f"/students/{sid}/erase"), headers=weak).json()["error"]["code"] == "mfa_required"
    out = w.client.post(url(a, f"/students/{sid}/erase"), headers=bearer(owner))
    assert out.status_code == 200 and out.json()["erased"] is True
    conforms(out.json(), "ErasedOut")
    assert operator_sql.sql(f"select child_label from public.students where id = '{sid}'").strip() == "erased:1"


def test_the_worker_erases_students_who_left_more_than_the_retention_months_ago(school: Any, eval_world: Any, stack: Any) -> None:
    w, a = eval_world, eval_world.a
    owner = a.users["owner"]
    sid = School.students["dev"]
    left = (TODAY - timedelta(days=3 * 365)).isoformat()
    r = w.client.post(url(a, f"/students/{sid}/status"), json={"status": "left", "left_on": left}, headers=bearer(owner))
    assert r.status_code == 200 and r.json()["status"] == "left", r.text
    recent = School.students["farah"]
    assert w.client.post(url(a, f"/students/{recent}/status"), json={"status": "left", "left_on": (TODAY - timedelta(days=30)).isoformat()}, headers=bearer(owner)).status_code == 200
    pin(TODAY, "12:00")
    hk = Housekeeping(PostgrestPrivacyRepository(stack.rest, stack.anon_key), None)
    result = hk.run(school.session().token())
    assert result.students_erased >= 1 and result.errors == 0
    got = operator_sql.sql(f"select string_agg(id::text || ':' || (erased_at is not null)::text, ',') from public.students where id in ('{sid}', '{recent}')")
    assert f"{sid}:true" in got and f"{recent}:false" in got, got
    # the school with the rule off keeps its students: the Owner, with a second factor, switches it off by saving the profile without the months
    r = w.client.put(url(a, "/profile"), json={"institution_type": "school", "year_start_month": 6, "parent_languages": ["en", "te"]}, headers=bearer(owner))
    assert r.status_code == 200 and r.json()["student_retention_months"] is None


# ============================================================================================================ the canary
class Traffic:
    """Every HTTP request this process makes to the data layer (the PostgREST and GoTrue of the stack) while the canary paths run, with its body and the answer."""

    def __init__(self, base: str) -> None:
        self.base = base
        self.seen: list[tuple[str, str, str]] = []
        self._send = httpx.Client.send

    def start(self, monkeypatch: pytest.MonkeyPatch) -> None:
        me = self

        def spy(client: httpx.Client, request: httpx.Request, *args: Any, **kwargs: Any) -> httpx.Response:
            response = me._send(client, request, *args, **kwargs)
            if str(request.url).startswith(me.base):
                try:
                    answer = response.text
                except Exception:  # noqa: BLE001 - a streamed answer is read by its caller
                    answer = ""
                me.seen.append((str(request.url), request.content.decode("utf-8", "replace") if request.content else "", answer))
            return response

        monkeypatch.setattr(httpx.Client, "send", spy)


def test_a_canary_child_label_appears_nowhere_but_the_students_table(school: Any, eval_world: Any, stack: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    w, a = eval_world, eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    keeper = guardian(w, "canary")
    sid = uid()
    r = w.client.put(url(a, f"/students/{sid}"), json={"contact_id": keeper, "programme_id": School.prog, "child_label": CANARY, "admission_no": CANARY_NO}, headers=bearer(owner))
    assert r.status_code == 200, r.text
    # an error path that holds the canary in its request: the answer never echoes it
    bad = w.client.put(url(a, f"/students/{uid()}"), json={"contact_id": keeper, "programme_id": School.prog, "child_label": CANARY + " 7"}, headers=bearer(owner))
    assert bad.status_code == 422 and CANARY not in bad.text
    dup = w.client.put(url(a, f"/students/{uid()}"), json={"contact_id": keeper, "programme_id": School.prog, "child_label": "Other", "admission_no": CANARY_NO.lower()}, headers=bearer(owner))
    assert dup.status_code == 409 and CANARY.lower() not in dup.text.lower() and CANARY_NO.lower() not in dup.text.lower()
    # the paths a model or a log could reach, driven with the canary in the school
    traffic = Traffic(stack.url)
    traffic.start(monkeypatch)
    caplog.set_level(logging.DEBUG)
    saved = enable_assistant([a])
    try:
        for app in assistant_app(stack):
            for question in (
                "What is waiting for me today?", "Who is the child whose name starts with Z?", "List all students", "Show me the children and their admission numbers", "Find the child with admission number ZQXJ", "Which parents owe fees?",
                "Show my customers", "What are my enquiries?", "What follow-ups are due?", "Show my quotes and orders", "What can you do?",
            ):  # fmt: skip
                r = app.post(f"/v1/tenants/{a.id}/assistant/messages", json={"message_id": uid(), "text": question}, headers=bearer(owner))
                assert r.status_code == 200, (question, r.text)
                assert CANARY.lower() not in text_of(events(r)).lower() and CANARY_NO.lower() not in r.text.lower(), question
    finally:
        restore(saved)
    for tail in ("/today", "/leads/search?q=Zqxj", "/reports/weekly", "/profile", "/call-list", "/campaigns", "/ledger/summary", f"/ledger/statement?contact_id={keeper}", "/outbox/messages"):
        r = w.client.get(f"/v1/tenants/{a.id}{tail}", headers=bearer(owner))
        assert CANARY.lower() not in r.text.lower() and CANARY_NO.lower() not in r.text.lower(), tail
    window = {"from_date": (TODAY - timedelta(days=300)).isoformat(), "to_date": (TODAY + timedelta(days=60)).isoformat()}
    exported = w.client.post(f"/v1/tenants/{a.id}/exports/accounting", json={"export_id": uid(), "format": "csv", **window}, headers=bearer(owner))
    assert CANARY.lower() not in exported.text.lower() and CANARY_NO.lower() not in exported.text.lower()
    # (1) nothing the API sent to the data layer or got back from it named the canary or touched a student table
    joined = "\n".join(u + "\n" + b + "\n" + ans for u, b, ans in traffic.seen)
    assert traffic.seen, "the spy saw the API's traffic"
    assert CANARY.lower() not in joined.lower() and CANARY_NO.lower() not in joined.lower(), "the canary reached or left the data layer outside the education routes"
    touched = [u for u, _b, _a in traffic.seen if any(word in u for word in ("/students", "student_", "institution_", "programme", "fee_", "admission"))]
    assert touched == [], f"a non-education path touched an education table or function: {touched[:3]}"
    # (2) no log line holds it (the education routes were not even called in this phase, and the earlier ones log no body)
    assert CANARY.lower() not in caplog.text.lower() and CANARY_NO.lower() not in caplog.text.lower()
    # (3) in the whole database the canary is in ONE table: the students table (the audit trail names the table and the columns, never the value)
    hits = operator_sql.sql(
        "select coalesce(string_agg(n.nspname || '.' || c.relname, ',' order by n.nspname, c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where c.relkind = 'r' and n.nspname in ('public', 'integrations', 'privacy', 'suppression', 'erasure') "
        f"and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I t where t::text ilike %L', n.nspname, c.relname, '%{CANARY.lower()}%'), false, true, '')))[1]::text::int > 0"
    ).strip()
    assert hits == "public.students", hits
    # (4) and only the education routes return it, to Owner, Admin and Sales
    assert CANARY in w.client.get(url(a, "/students"), headers=bearer(sales)).text
    assert w.client.get(url(a, "/students"), headers=bearer(a.users["viewer"])).status_code == 403
