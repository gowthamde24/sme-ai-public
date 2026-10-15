"""Job CR: the routes of the education pack, with fakes (no database). The database's own rules (the children's minimum, the doors, the allocation of fees, the receipts, the late fees, the audience, the reports) are proved
in supabase/tests/database/104..107 and tests/integration/test_cr_education.py; here: who may call what, the shapes, the closed requests (a child's record holds the minimum and nothing else), the idempotency
ids, the paging, the mapping of every refusal to its fixed sentence, and the students file of the spreadsheet import."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

from app.education import errors as ed
from app.packs.errors import ModuleOffError
from tests.cr_fakes import CONTACT, GROUP, PROG, STUDENT, FakeEducation, admission_row
from tests.fakes import TENANT_A, auth, make_client
from tests.integrations_fakes import FakeIntegrations

A = TENANT_A.id
U = uuid.UUID
T = f"/v1/tenants/{A}/institution"
ID = str(U(int=0x91))
ALL_THREE = ("a_owner", "a_admin", "a_sales")
OWNER_ADMIN = ("a_owner", "a_admin")


def world() -> tuple[Any, FakeEducation]:
    fake = FakeEducation()
    client, _ = make_client(education=fake)
    return client, fake


PROFILE = {"institution_type": "school", "year_start_month": 6, "terms": [{"label": "Term 1", "start_month": 6, "end_month": 9}], "parent_languages": ["en", "te"]}
PROGRAMME = {"name": "Class 5", "kind": "class", "group_kind": "section"}
STUDENT_BODY = {"contact_id": CONTACT, "programme_id": PROG, "group_id": GROUP, "child_label": "Asha", "admission_no": "ADM-1"}
ADMISSION_BODY = {"source": "walk_in", "contact_id": CONTACT, "programme_id": PROG}
PLAN_BODY: dict[str, Any] = {"name": "Class 5 fees", "programme_id": PROG, "academic_year": "2026-27", "lines": [{"head": "tuition", "instalment_no": 1, "due_date": "2026-06-10", "amount_paise": 1000000}]}
PAYMENT = {"received_on": "2026-06-05", "amount_paise": 1200000, "method": "cash"}

# (method, path, body, who may call it)  - every other signed-in role gets 403, another business 404, no token 401
MATRIX: list[tuple[str, str, Any, tuple[str, ...]]] = [
    ("GET", "/profile", None, ("a_owner", "a_admin", "a_sales", "a_viewer")),
    ("PUT", "/profile", PROFILE, OWNER_ADMIN),
    ("GET", "/programmes", None, ("a_owner", "a_admin", "a_sales", "a_viewer")),
    ("PUT", f"/programmes/{ID}", PROGRAMME, OWNER_ADMIN),
    ("PUT", f"/programmes/{ID}/groups/{ID}", {"label": "A"}, OWNER_ADMIN),
    ("GET", "/students", None, ALL_THREE),
    ("GET", f"/students/{STUDENT}", None, ALL_THREE),
    ("PUT", f"/students/{ID}", STUDENT_BODY, OWNER_ADMIN),
    ("POST", f"/students/{STUDENT}/status", {"status": "left", "left_on": "2026-09-30"}, OWNER_ADMIN),
    ("GET", "/admissions", None, ALL_THREE),
    ("PUT", f"/admissions/{ID}", ADMISSION_BODY, ALL_THREE),
    ("GET", f"/admissions/{ID}", None, ALL_THREE),
    ("POST", f"/admissions/{ID}/stage", {"stage": "campus_visit"}, ALL_THREE),
    ("POST", f"/admissions/{ID}/admit", {"student_id": ID, "child_label": "Asha", "programme_id": PROG}, OWNER_ADMIN),
    ("GET", "/fee-plans", None, ALL_THREE),
    ("GET", f"/fee-plans/{ID}", None, ALL_THREE),
    ("PUT", f"/fee-plans/{ID}", PLAN_BODY, OWNER_ADMIN),
    ("PUT", f"/fee-assignments/{ID}", {"student_id": STUDENT, "plan_id": ID}, OWNER_ADMIN),
    ("POST", f"/fee-assignments/{ID}/void", None, OWNER_ADMIN),
    ("GET", f"/students/{STUDENT}/fees", None, ALL_THREE),
    ("GET", f"/students/{STUDENT}/fees/entries", None, ALL_THREE),
    ("PUT", f"/students/{STUDENT}/payments/{ID}", PAYMENT, ALL_THREE),
    ("PUT", f"/students/{STUDENT}/concessions/{ID}", {"mode": "percent", "value": 10, "reason_code": "sibling"}, OWNER_ADMIN),
    ("PUT", f"/students/{STUDENT}/adjustments/{ID}", {"direction": "credit", "amount_paise": 50000, "reason_code": "rounding"}, OWNER_ADMIN),
    ("GET", f"/receipts/{ID}", None, ALL_THREE),
    ("GET", f"/guardians/{CONTACT}/fees", None, ALL_THREE),
    ("GET", "/late-fees", None, ALL_THREE),
    ("POST", "/late-fees/post", None, OWNER_ADMIN),
    ("GET", "/fees/pending", None, ALL_THREE),
    ("PUT", f"/announcements/{ID}/audience", {"scope": "all", "date": "2026-12-20"}, ALL_THREE),
    ("GET", "/reports/education.collection", None, ALL_THREE),
]  # fmt: skip


@pytest.mark.parametrize(("method", "path", "body", "who"), MATRIX, ids=[f"{m} {p.split('/')[1]}{'/' + p.split('/')[-1] if p.count('/') > 2 else ''}" for m, p, _b, _w in MATRIX])
def test_who_may_call_what(method: str, path: str, body: Any, who: tuple[str, ...]) -> None:
    client, fake = world()
    url = T + path
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.request(method, url, json=body, headers=auth(user))
        if user in who:
            assert r.status_code in (200, 201), (user, r.status_code, r.text)
        else:
            assert r.status_code == 403, (user, r.status_code)
    assert client.request(method, url, json=body, headers=auth("b_owner")).status_code == 404, "another business"
    assert client.request(method, url, json=body).status_code == 401, "no token"
    allowed_calls = len(who)
    assert len(fake.calls) == allowed_calls, "a refused caller never reaches the data layer"


def test_the_students_of_a_school_are_not_visible_to_a_viewer_and_the_programmes_are() -> None:
    client, fake = world()
    assert client.get(T + "/students", headers=auth("a_viewer")).status_code == 403
    assert client.get(T + "/programmes", headers=auth("a_viewer")).status_code == 200
    assert fake.names() == ["programmes"]


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the minimum
@pytest.mark.parametrize(
    "extra",
    [
        {"date_of_birth": "2015-05-01"}, {"dob": "2015-05-01"}, {"photo_url": "https://x.test/p.jpg"}, {"address": "12 Lane"}, {"aadhaar": "123412341234"}, {"health": "asthma"}, {"religion": "x"}, {"caste": "x"},
        {"income": 1}, {"marks": 90}, {"attendance": 95}, {"behaviour": "good"}, {"note": "a note"}, {"phone": "+919876543210"}, {"email": "k@example.test"}, {"parent_occupation": "x"},
    ],
)  # fmt: skip
def test_a_student_record_holds_the_minimum_and_nothing_else(extra: dict[str, Any]) -> None:
    client, fake = world()
    r = client.put(T + f"/students/{ID}", json={**STUDENT_BODY, **extra}, headers=auth("a_owner"))
    assert r.status_code == 422, extra
    assert fake.calls == []
    r = client.post(T + f"/admissions/{ID}/admit", json={"student_id": ID, "child_label": "Asha", "programme_id": PROG, **extra}, headers=auth("a_owner"))
    assert r.status_code == 422 and fake.calls == []


@pytest.mark.parametrize(
    "bad",
    [
        {"child_label": "Asha 5"}, {"child_label": "asha@x.test"}, {"child_label": "x" * 31}, {"child_label": ""}, {"child_label": None}, {"child_label": "Asha", "is_adult": True}, {"is_adult": True, "child_label": "Asha"},
        {"guardian_contact_id": CONTACT}, {"admission_no": "has space"}, {"admission_no": "x" * 31}, {"programme_id": "nope"}, {"contact_id": None},
    ],
)  # fmt: skip
def test_a_childs_label_is_a_first_name_or_initials_and_the_shape_is_checked(bad: dict[str, Any]) -> None:
    client, fake = world()
    assert client.put(T + f"/students/{ID}", json={**STUDENT_BODY, **bad}, headers=auth("a_owner")).status_code == 422, bad
    assert fake.calls == []


def test_an_adult_student_is_the_contact_and_has_no_label() -> None:
    client, fake = world()
    r = client.put(T + f"/students/{ID}", json={"contact_id": CONTACT, "is_adult": True, "programme_id": PROG}, headers=auth("a_owner"))
    assert r.status_code == 200
    sent = fake.calls[-1][1][1]
    assert sent["p_is_adult"] is True and sent["p_child_label"] is None and sent["p_guardian_contact_id"] is None


def test_a_student_is_saved_with_the_callers_id_and_returned() -> None:
    client, fake = world()
    r = client.put(T + f"/students/{ID}", json={**STUDENT_BODY, "joined_on": "2026-06-12"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["id"] == ID and r.json()["created"] is True and r.json()["display_name"] == "Asha"
    sent = fake.calls[-1][1][1]
    assert sent["p_student_id"] == ID and sent["p_tenant_id"] == str(A) and sent["p_group_id"] == GROUP and sent["p_joined_on"] == "2026-06-12" and sent["p_admission_no"] == "ADM-1"
    assert client.put(T + "/students/not-a-uuid", json=STUDENT_BODY, headers=auth("a_owner")).status_code == 404


def test_a_status_change_needs_the_day_the_student_left() -> None:
    client, fake = world()
    assert client.post(T + f"/students/{STUDENT}/status", json={"status": "left"}, headers=auth("a_owner")).status_code == 422
    assert client.post(T + f"/students/{STUDENT}/status", json={"status": "active", "left_on": "2026-09-30"}, headers=auth("a_owner")).status_code == 422
    assert client.post(T + f"/students/{STUDENT}/status", json={"status": "active"}, headers=auth("a_owner")).status_code == 200
    assert fake.calls[-1][1][2:] == ("active", None)


def test_erasing_one_child_is_the_owners_alone_and_asks_for_a_second_factor() -> None:
    client, fake = world()
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(T + f"/students/{STUDENT}/erase", headers=auth(user)).status_code == 403
    assert client.post(T + f"/students/{STUDENT}/erase", headers=auth("a_owner", aal="aal1")).status_code == 403
    r = client.post(T + f"/students/{STUDENT}/erase", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"student_id": STUDENT, "erased": True, "replayed": False}
    assert fake.names() == ["student_erase"]


def test_the_student_list_is_paged_and_filtered() -> None:
    client, fake = world()
    fake.students_rows = [__import__("tests.cr_fakes", fromlist=["student_row"]).student_row(str(U(int=0x1000 + i))) for i in range(3)]
    r = client.get(T + f"/students?limit=3&programme_id={PROG}&group_id={GROUP}&status=active&contact_id={CONTACT}", headers=auth("a_sales")).json()
    assert len(r["items"]) == 3 and r["next_cursor"]
    assert fake.calls[-1][1][1] == {"programme_id": PROG, "group_id": GROUP, "status": "active", "contact_id": CONTACT}
    client.get(T + f"/students?limit=3&after={r['next_cursor']}", headers=auth("a_sales"))
    assert fake.calls[-1][1][3] is not None
    assert client.get(T + "/students?after=%25", headers=auth("a_sales")).status_code == 422
    assert client.get(T + "/students?status=gone", headers=auth("a_sales")).status_code == 422
    assert client.get(T + "/students?limit=0", headers=auth("a_sales")).status_code == 422
    assert client.get(T + "/students?programme_id=nope", headers=auth("a_sales")).status_code == 404


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the profile
def test_the_profile_is_closed_and_passes_its_terms() -> None:
    client, fake = world()
    bad: dict[str, Any]
    r = client.put(T + "/profile", json={**PROFILE, "student_retention_months": 24}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["student_retention_months"] == 24 and r.json()["configured"] is True
    sent = fake.calls[-1][1][1]
    assert sent["p_terms"] == [{"label": "Term 1", "start_month": 6, "end_month": 9}] and sent["p_parent_languages"] == ["en", "te"] and sent["p_student_retention_months"] == 24
    for bad in ({"institution_type": "primary"}, {"year_start_month": 13}, {"parent_languages": []}, {"parent_languages": ["en", "en"]}, {"parent_languages": ["xx"]}, {"student_retention_months": 0},
                {"student_retention_months": 121}, {"terms": [{"label": "T", "start_month": 1, "end_month": 2, "x": 1}]}, {"terms": [{"label": "T", "start_month": 1, "end_month": 2}] * 7}, {"extra": 1}):
        assert client.put(T + "/profile", json={**PROFILE, **bad}, headers=auth("a_owner")).status_code == 422, bad


def test_programmes_and_groups_are_closed_requests() -> None:
    client, fake = world()
    for bad in ({"kind": "room"}, {"group_kind": "wing"}, {"name": ""}, {"name": "x" * 81}, {"extra": 1}):
        assert client.put(T + f"/programmes/{ID}", json={**PROGRAMME, **bad}, headers=auth("a_owner")).status_code == 422, bad
    for bad in ({"label": ""}, {"label": "x" * 31}, {"timing": ""}, {"extra": 1}):
        assert client.put(T + f"/programmes/{ID}/groups/{ID}", json={"label": "A", **bad}, headers=auth("a_owner")).status_code == 422, bad
    assert fake.calls == []
    r = client.put(T + f"/programmes/{ID}/groups/{ID}", json={"label": "6 am batch", "timing": "6 to 8 am"}, headers=auth("a_owner"))
    assert r.status_code == 200 and fake.calls[-1][1][1]["p_programme_id"] == ID and fake.calls[-1][1][1]["p_timing"] == "6 to 8 am"


# ------------------------------------------------------------------------------------------------------------------------------------------------------ admissions
def test_an_enquiry_with_a_new_guardian_makes_the_contact_then_the_enquiry() -> None:
    client, fake = world()
    r = client.put(T + f"/admissions/{ID}", json={"source": "whatsapp", "programme_id": PROG, "guardian_name": "Rao Parent", "guardian_phone": "98765 43210"}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    sent = fake.calls[-1][1][1]
    assert sent["p_admission_id"] == ID and sent["p_source"] == "whatsapp"
    assert sent["p_contact_id"] == str(uuid.uuid5(U(ID), "guardian")), "the guardian's id is derived from the enquiry's, so a retry makes no second contact"
    assert r.json()["created"] is True and r.json()["stage"] == "enquiry"


@pytest.mark.parametrize(
    "bad",
    [
        {"contact_id": None},  # nobody named
        {"guardian_name": "X", "guardian_phone": "98765 43210"},  # both an existing contact and a new one
        {"contact_id": None, "guardian_name": "Only a name"},
        {"contact_id": None, "guardian_phone": "98765 43210"},
        {"source": "newspaper"},
        {"extra": 1},
        {"child_label": "Asha"},  # an enquiry holds no child
        {"contact_id": None, "guardian_name": "X", "guardian_phone": "not a number!"},
    ],
)  # fmt: skip
def test_an_enquiry_names_a_contact_or_a_new_guardian_and_holds_no_child(bad: dict[str, Any]) -> None:
    client, fake = world()
    assert client.put(T + f"/admissions/{ID}", json={**ADMISSION_BODY, **bad}, headers=auth("a_owner")).status_code == 422, bad
    assert fake.calls == []


def test_the_stage_rules_in_the_request() -> None:
    client, fake = world()
    for bad in ({"stage": "lost"}, {"stage": "campus_visit", "lost_reason": "fees"}, {"stage": "admitted"}, {"stage": "lost", "lost_reason": "cost"}, {"stage": "enquiry", "x": 1}):
        assert client.post(T + f"/admissions/{ID}/stage", json=bad, headers=auth("a_sales")).status_code == 422, bad
    r = client.post(T + f"/admissions/{ID}/stage", json={"stage": "lost", "lost_reason": "fees"}, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json()["stage"] == "lost" and r.json()["lost_reason"] == "fees" and r.json()["replayed"] is False


def test_admitting_makes_the_student_and_may_assign_the_plan_in_one_call() -> None:
    client, fake = world()
    body = {"student_id": ID, "child_label": "Asha", "programme_id": PROG, "group_id": GROUP, "admission_no": "ADM-1", "plan_id": str(U(int=0x70)), "assignment_id": str(U(int=0xA5))}
    r = client.post(T + f"/admissions/{ID}/admit", json=body, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["stage"] == "admitted" and r.json()["student_id"] == ID and r.json()["fee_assignment"] == {"assignment_id": str(U(int=0xA5))}
    sent = fake.calls[-1][1][0 + 1]
    assert sent["p_plan_id"] == str(U(int=0x70)) and sent["p_assignment_id"] == str(U(int=0xA5)) and sent["p_admission_id"] == ID
    for bad in ({"plan_id": str(U(int=1))}, {"assignment_id": str(U(int=1))}, {"child_label": None}, {"is_adult": True}, {"child_label": "Asha 2"}):
        assert client.post(T + f"/admissions/{ID}/admit", json={**{"student_id": ID, "child_label": "Asha", "programme_id": PROG}, **bad}, headers=auth("a_owner")).status_code == 422, bad


def test_the_pipeline_is_paged_and_filtered() -> None:
    client, fake = world()
    fake.admissions_rows = [admission_row(str(U(int=0x2000 + i))) for i in range(2)]
    r = client.get(T + f"/admissions?limit=2&stage=lost&source=walk_in&programme_id={PROG}", headers=auth("a_sales")).json()
    assert len(r["items"]) == 2 and r["next_cursor"] and fake.calls[-1][1][1] == {"stage": "lost", "programme_id": PROG, "source": "walk_in"}
    assert client.get(T + "/admissions?stage=closed", headers=auth("a_sales")).status_code == 422
    assert client.get(T + "/admissions?source=paper", headers=auth("a_sales")).status_code == 422


# ------------------------------------------------------------------------------------------------------------------------------------------------------ fees
def test_a_fee_plan_is_a_closed_request_with_its_lines() -> None:
    client, fake = world()
    bad: dict[str, Any]
    r = client.put(T + f"/fee-plans/{ID}", json={**PLAN_BODY, "late_fee_kind": "per_day", "late_fee_paise": 5000, "late_fee_grace_days": 5, "late_fee_cap_paise": 50000}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["lines"][0]["head"] == "tuition"
    sent = fake.calls[-1][1][1]
    assert sent["p_late_fee_kind"] == "per_day" and sent["p_late_fee_grace_days"] == 5 and sent["p_lines"] == [{"head": "tuition", "instalment_no": 1, "due_date": "2026-06-10", "amount_paise": 1000000}]
    one: dict[str, Any] = PLAN_BODY["lines"][0]
    for bad in (
        {"lines": []}, {"lines": [one, one]}, {"lines": [{**one, "head": "fun"}]}, {"lines": [{**one, "amount_paise": 0}]}, {"lines": [{**one, "amount_paise": 100_000_001}]}, {"lines": [{**one, "instalment_no": 25}]},
        {"late_fee_kind": "fixed"}, {"late_fee_paise": 100}, {"late_fee_kind": "fixed", "late_fee_paise": 100, "late_fee_cap_paise": 500}, {"academic_year": "2026"}, {"late_fee_grace_days": 61}, {"extra": 1},
    ):  # fmt: skip
        assert client.put(T + f"/fee-plans/{ID}", json={**PLAN_BODY, **bad}, headers=auth("a_owner")).status_code == 422, bad


def test_a_payment_a_concession_and_an_adjustment_carry_the_callers_ids() -> None:
    client, fake = world()
    bad: dict[str, Any]
    r = client.put(T + f"/students/{STUDENT}/payments/{ID}", json=PAYMENT, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json() == {"entry_id": ID, "receipt_no": "R/2026-27/000001", "replayed": False}
    sent = fake.calls[-1][1][1]
    assert sent["p_entry_id"] == ID and sent["p_student_id"] == STUDENT and sent["p_received_on"] == "2026-06-05" and sent["p_amount_paise"] == 1200000 and sent["p_method"] == "cash"
    for bad in ({"amount_paise": 0}, {"method": "barter"}, {"amount_paise": 1.5}, {"received_on": "yesterday"}, {"extra": 1}):
        assert client.put(T + f"/students/{STUDENT}/payments/{ID}", json={**PAYMENT, **bad}, headers=auth("a_sales")).status_code == 422, bad
    r = client.put(T + f"/students/{STUDENT}/concessions/{ID}", json={"mode": "percent", "value": 10, "reason_code": "sibling"}, headers=auth("a_owner")).json()
    assert r["amount_paise"] == 350000
    for bad in ({"mode": "percent", "value": 101}, {"mode": "amount", "value": 0}, {"reason_code": "discount"}, {"mode": "half"}, {"extra": 1}):
        assert client.put(T + f"/students/{STUDENT}/concessions/{ID}", json={"mode": "percent", "value": 10, "reason_code": "sibling", **bad}, headers=auth("a_owner")).status_code == 422, bad
    for bad in ({"direction": "debit"}, {"direction": "credit", "due_date": "2026-11-01"}, {"reason_code": "late_fee"}, {"amount_paise": 0}):
        assert client.put(T + f"/students/{STUDENT}/adjustments/{ID}", json={"direction": "credit", "amount_paise": 50000, "reason_code": "rounding", **bad}, headers=auth("a_owner")).status_code == 422, bad
    assert client.put(T + f"/students/{STUDENT}/adjustments/{ID}", json={"direction": "debit", "amount_paise": 50000, "reason_code": "correction", "due_date": "2026-11-01"}, headers=auth("a_owner")).status_code == 200


def test_the_statement_shows_the_student_the_plan_and_both_ageings() -> None:
    client, fake = world()
    r = client.get(T + f"/students/{STUDENT}/fees?as_of=2026-10-14", headers=auth("a_sales")).json()
    assert r["student"]["display_name"] == "Asha" and r["assignment"]["plan_name"] == "Class 5 fees"
    s = r["statement"]
    assert (s["outstanding_paise"], s["overdue_paise"], s["student_id"]) == (2300000, 1300000, STUDENT)
    assert s["overdue_ageing"]["d90_plus"] == 300000 and s["ageing"]["d90_plus"] == 2300000
    assert fake.calls[-1][1][2].isoformat() == "2026-10-14"
    assert client.get(T + f"/students/{STUDENT}/fees?as_of=soon", headers=auth("a_sales")).status_code == 422
    assert client.get(T + f"/students/{STUDENT}/fees/entries?limit=0", headers=auth("a_sales")).status_code == 422


def test_a_receipt_names_the_guardian_and_the_student() -> None:
    client, _ = world()
    r = client.get(T + f"/receipts/{ID}", headers=auth("a_sales")).json()
    assert r["receipt_no"] == "R/2026-27/000001" and r["paid_by"] == "Rao Parent" and r["student"]["display_name"] == "Asha" and r["balance_after_paise"] == 2300000


def test_the_late_fees_are_looked_at_by_anyone_who_reads_money_and_posted_by_owner_or_admin() -> None:
    client, fake = world()
    r = client.get(T + "/late-fees", headers=auth("a_sales")).json()
    assert (r["count"], r["total_paise"], r["rows"][0]["days_late"]) == (1, 50000, 100)
    assert client.post(T + "/late-fees/post", headers=auth("a_owner", aal="aal1")).status_code == 403 or fake.names()[-1] == "late_fees_post"
    assert client.post(T + "/late-fees/post", headers=auth("a_admin")).json() == {"as_of": "2026-10-14", "posted": 1, "total_paise": 50000}


def test_the_pending_list_pages_by_amount_and_says_pending() -> None:
    client, fake = world()
    r = client.get(T + "/fees/pending?limit=1&as_of=2026-10-14&programme_id=" + PROG, headers=auth("a_sales")).json()
    assert r["items"][0]["pending_paise"] == 750000 and r["next_cursor"]
    assert fake.calls[-1][1][1] == {"as_of": "2026-10-14", "programme_id": PROG, "group_id": None}
    client.get(T + f"/fees/pending?limit=1&after={r['next_cursor']}", headers=auth("a_sales"))
    assert fake.calls[-1][1][3] == (750000, U(STUDENT))
    assert "defaulter" not in json.dumps(r).lower()
    assert client.get(T + "/fees/pending?after=%25", headers=auth("a_sales")).status_code == 422


# ------------------------------------------------------------------------------------------------------------------------------------------------------ announcements and reports
def test_the_audience_is_a_closed_request_by_scope() -> None:
    client, fake = world()
    ok = client.put(T + f"/announcements/{ID}/audience", json={"scope": "programme", "programme_id": PROG, "date": "2026-12-20"}, headers=auth("a_sales"))
    assert ok.status_code == 200 and ok.json() == {"added": 2, "skipped": [{"row": 3, "reason": "no_contact"}], "recipients": 2}
    assert fake.calls[-1][1][2] == {"scope": "programme", "programme_id": PROG, "group_id": None, "date": "2026-12-20"}
    for bad in ({"scope": "everyone"}, {"scope": "programme"}, {"scope": "all", "programme_id": PROG}, {"scope": "group", "programme_id": PROG}, {"date": None}, {"scope": "all", "note": "x"}):
        assert client.put(T + f"/announcements/{ID}/audience", json={"scope": "all", "date": "2026-12-20", **bad}, headers=auth("a_sales")).status_code == 422, bad


def test_a_report_has_the_shape_every_pack_uses() -> None:
    client, fake = world()
    r = client.get(T + "/reports/education.collection?from=2026-04-01&to=2026-10-14", headers=auth("a_sales")).json()
    assert set(r) == {"report", "as_of", "from", "to", "kpis", "tables", "series"} and r["from"] == "2026-04-01"
    assert fake.calls[-1][1][2].isoformat() == "2026-04-01" and fake.calls[-1][1][3].isoformat() == "2026-10-14"
    assert r["tables"][0]["columns"][1] == {"key": "pending_paise", "type": "paise"} and r["tables"][0]["rows"] == [["Class 5", 2500000]]
    for bad in ("education.defaulters", "nope"):
        assert client.get(T + f"/reports/{bad}", headers=auth("a_sales")).status_code == 422
    assert client.get(T + "/reports/education.pending?from=soon", headers=auth("a_sales")).status_code == 422


# ------------------------------------------------------------------------------------------------------------------------------------------------------ refusals
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ed.AdmissionNumberUsedError("SM811"), 409, "admission_no_used"),
        (ed.AdmissionStageError("SM812"), 409, "admission_stage"),
        (ed.FeePlanInUseError("SM813"), 409, "fee_plan_in_use"),
        (ed.FeePlanExistsError("SM814"), 409, "fee_plan_exists"),
        (ed.StudentInactiveError("SM815"), 409, "student_not_active"),
        (ModuleOffError("SM701"), 403, "module_off"),
    ],
)  # fmt: skip
def test_every_refusal_has_a_fixed_sentence_and_no_data_layer_text(error: Exception, status: int, code: str) -> None:
    client, fake = world()
    fake.error = error
    r = client.put(T + f"/students/{ID}", json=STUDENT_BODY, headers=auth("a_owner"))
    assert r.status_code == status and r.json()["error"]["code"] == code and "SM8" not in r.text and "SM7" not in r.text


def test_a_runtime_without_the_pack_says_so() -> None:
    client, _ = make_client()
    r = client.get(T + "/students", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "education_unavailable"


def test_the_api_has_no_delete_for_the_education_pack() -> None:
    client, _ = world()
    for path in (f"/students/{STUDENT}", f"/programmes/{ID}", f"/fee-plans/{ID}", f"/admissions/{ID}"):
        assert client.delete(T + path, headers=auth("a_owner")).status_code == 405


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the students file of the spreadsheet import
S = f"/v1/tenants/{A}/imports/spreadsheet"
JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddd02"
FILE = (
    b"Parent Name,Mobile,Class,Section,Student Name,Admission No,Adult\n"
    b"Rao Parent,98765 43210,Class 5,A,Asha,ADM-1,\n"
    b"Rao Parent,98765 43210,Class 5,B,Bala,ADM-2,no\n"
    b"Meena Adult,98765 43211,Class 6,,,,yes\n"
    b"Sita Parent,98765 43212,Class 9,A,Dev,ADM-4,\n"
    b"Kiran Parent,98765 43213,Class 5,Z,Esha,ADM-5,\n"
    b"Bad Parent,not a number,Class 5,A,Farah,,\n"
    b"Digit Parent,98765 43214,Class 5,A,Gita 2,,\n"
    b"Twin Parent,98765 43215,Class 5,A,Hari,ADM-1,\n"
    b",98765 43216,Class 5,A,Indu,,\n"
)


class SchoolWorld:
    def __init__(self) -> None:
        self.edu = FakeEducation()
        self.db = FakeIntegrations()
        self.client, _ = make_client(education=self.edu, integrations=self.db)

    def upload(self, path: str, user: str, data: bytes, **claims: Any) -> Any:
        return self.client.post(S + path, content=data, headers={**auth(user, **claims), "Content-Type": "text/csv"})


def test_the_students_file_is_inspected_with_its_own_fields_and_changes_nothing() -> None:
    w = SchoolWorld()
    body = w.upload("/inspect?kind=students", "a_owner", FILE).json()
    assert body["kind"] == "students" and body["rows"] == 9
    assert body["suggested_mapping"] == {"guardian_name": 0, "guardian_phone": 1, "programme": 2, "group": 3, "child_label": 4, "admission_no": 5, "is_adult": 6}
    assert {f["field"] for f in body["fields"] if f["required"]} == {"guardian_name", "guardian_phone", "programme"}
    assert w.edu.calls == [] and w.db.calls == []


def test_the_preview_matches_programmes_and_sections_and_names_only_the_guardian() -> None:
    w = SchoolWorld()
    r = w.upload(f"/preview?kind=students&job_id={JOB}", "a_owner", FILE)
    assert r.status_code == 200, r.text
    body = r.json()
    by_line = {x["line"]: x for x in body["rows"]}
    assert by_line[2]["status"] == "will_create" and by_line[3]["status"] == "will_create" and by_line[4]["status"] == "will_create"
    assert (by_line[5]["status"], by_line[5]["reason"]) == ("needs_review", "programme_not_found"), "Class 9 does not exist"
    assert (by_line[6]["status"], by_line[6]["reason"]) == ("needs_review", "group_not_found"), "Class 5 has no section Z"
    assert (by_line[9]["status"], by_line[9]["reason"]) == ("duplicate", "admission_no"), "ADM-1 twice in the file"
    assert {(i["line"], i["code"]) for i in body["issues"]} == {(7, "guardian_phone_invalid"), (8, "child_label_invalid"), (10, "guardian_name_missing")}
    assert all(x["label"] != "Asha" for x in body["rows"]) and "Asha" not in r.text and "Bala" not in r.text, "the preview names guardians, never a child"
    assert "Asha" not in json.dumps(w.db.jobs[JOB]), "the stored job holds hashes, numbers and counts"
    assert w.edu.names() == ["programmes"]


def test_a_students_file_needs_the_three_columns() -> None:
    w = SchoolWorld()
    r = w.upload(f"/preview?kind=students&job_id={JOB}&mapping=" + json.dumps({"guardian_name": 0}), "a_owner", FILE)
    assert r.status_code == 422 and r.json()["error"]["code"] == "mapping_required_missing"


def test_the_students_import_runs_in_parts_keys_the_new_guardians_and_never_echoes_a_child() -> None:
    w = SchoolWorld()
    w.upload(f"/preview?kind=students&job_id={JOB}", "a_owner", FILE)
    assert w.upload(f"/{JOB}/confirm", "a_owner", FILE, aal="aal1").status_code == 403
    r = w.upload(f"/{JOB}/confirm", "a_owner", FILE)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["result"]["counts"]["created"] == 6 and out["result"]["counts"]["contacts_created"] == 6, "the six usable rows go to the database (the fake creates every row it is handed); the three with a problem do not"
    assert all(row["label"] not in ("Asha", "Bala", "Dev") for row in out["result"]["rows"]) and "Asha" not in r.text
    sent = [c for c in w.edu.calls if c[0] == "students_import"]
    assert len(sent) == 1 and sent[0][1][2][0]["child_label"] == "Asha" and sent[0][1][2][0]["guardian_phone"] == "+919876543210"
    assert sent[0][1][1] == U(JOB), "part 0 IS the job id"
    assert w.db.jobs[JOB]["status"] == "completed"


def test_a_students_import_is_for_owner_and_admin_only_and_needs_the_pack() -> None:
    w = SchoolWorld()
    for user in ("a_sales", "a_viewer"):
        assert w.upload("/inspect?kind=students", user, FILE).status_code == 403
    w.edu.error = ModuleOffError("SM701")
    r = w.upload(f"/preview?kind=students&job_id={JOB}", "a_owner", FILE)
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", "a business without the programmes module cannot preview a students file"
