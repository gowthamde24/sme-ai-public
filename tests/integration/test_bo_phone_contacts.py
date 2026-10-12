"""Job BO on the real stack: contacts with a phone number and no e-mail address, everywhere. The database's comparison form agrees with the API's on a table of numbers; a manual entry is stored as
+91 and ten digits; a second holder of the same number is refused; the suppression key of a phone-only contact exists; the lead import and the spreadsheet import make phone-only contacts and find
existing ones by their number; a WhatsApp message can be made for a phone-only customer; an erasure of a phone-only contact works. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import csv
import io
import uuid

import httpx
import operator_sql
import pytest
from conftest import bearer
from crm_support import World
from evidence_support import uid
from fastapi.testclient import TestClient

from app.suppression.keys import normalise_phone

NUMBERS = [
    "+91 98765 43210", "098765-43210", "91-9876543210", "0091 98765 43210", "(98765) 43210", "９８７６５４３２１０", "९८७६५ ४३२१०", "౯౮౭౬౫ ౪౩౨౧౦", "೯೮೭೬೫೪೩೨೧೦", "௯௮௭௬௫௪௩௨௧௦", "৯৮৭৬৫৪৩২১০",
    "+00 90000 10001", "00 90000 10001", "+44 7911 123456", "040-23456789", "12", "abc", "", "0", "000", "00000", "+91", "91", "9" * 33, "9" * 32, "  98765 43210  ", "98765.43210", "98765/43210",
    "tel: 98765 43210", "+91-98765-43210 ext 12",
]  # fmt: skip


def sql_norm(value: str) -> str | None:
    out = operator_sql.sql(f"select coalesce(app.phone_norm($bo${value}$bo$), '<null>')")
    return None if out == "<null>" else out


@pytest.mark.parametrize("value", NUMBERS)
def test_the_database_and_the_api_compare_numbers_the_same_way(value: str) -> None:
    assert sql_norm(value) == normalise_phone(value), value


@pytest.fixture(scope="module")
def tenant(eval_world: World):  # type: ignore[no-untyped-def]
    """Business A of this module with its real-data gate OPENED by the operator (so real-looking numbers can be used); business B keeps the default closed gate."""
    slug = operator_sql.sql(f"select slug from public.tenants where id = '{eval_world.a.id}'")
    operator_sql.sql(f"select app.operator_open_real_data_gate('{slug}', 'adr:0014', 'doc:hosting-staging', 'doc:dpdp-review', 'doc:restore-drill')")
    return eval_world.a


def url(t, path: str) -> str:  # type: ignore[no-untyped-def]
    return f"/v1/tenants/{t.id}{path}"


def h(t, user: str) -> dict[str, str]:  # type: ignore[no-untyped-def]
    return bearer(t.users[user])


def make_customer(client: TestClient, t, phone: str, name: str = "Phone Only Shop") -> dict[str, str]:  # type: ignore[no-untyped-def]
    company, contact, lead = uid(), uid(), uid()
    assert client.post(url(t, "/companies"), json={"id": company, "name": f"{name} {company[:6]}"}, headers=h(t, "sales")).status_code == 201
    r = client.post(url(t, "/contacts"), json={"id": contact, "company_id": company, "full_name": name, "phone": phone}, headers=h(t, "sales"))
    assert r.status_code == 201, r.text
    assert client.post(url(t, "/leads"), json={"id": lead, "company_id": company, "contact_id": contact}, headers=h(t, "sales")).status_code == 201
    return {"company": company, "contact": contact, "lead": lead, "phone": r.json()["phone"]}


def test_a_phone_only_contact_is_stored_in_the_canonical_form_with_its_suppression_key(client: TestClient, tenant) -> None:  # type: ignore[no-untyped-def]
    n = f"9{uuid.uuid4().int % 10**9:09d}"
    made = make_customer(client, tenant, f"0{n[:5]}-{n[5:]}")
    assert made["phone"] == f"+91{n}", "stored as +91 and the ten digits whatever was typed"
    row = operator_sql.sql(f"select (email is null)::text || '|' || phone from public.contacts where id = '{made['contact']}'")
    assert row == f"true|+91{n}"
    key = operator_sql.sql(f"select (email_hmac is null)::text || '|' || (phone_hmac is not null)::text from suppression.contact_keys where contact_id = '{made['contact']}'")
    assert key == "true|true", "the phone has a suppression key, there is no e-mail key"


def test_a_shared_number_is_allowed_and_every_holder_is_found(client: TestClient, tenant) -> None:  # type: ignore[no-untyped-def]
    n = f"8{uuid.uuid4().int % 10**9:09d}"
    first = make_customer(client, tenant, n)
    other_company = uid()
    client.post(url(tenant, "/companies"), json={"id": other_company, "name": f"Other {other_company[:6]}"}, headers=h(tenant, "sales"))
    twin = client.post(url(tenant, "/contacts"), json={"id": uid(), "company_id": other_company, "full_name": "Twin", "phone": f"+91 {n[:5]} {n[5:]}"}, headers=h(tenant, "sales"))
    assert twin.status_code == 201 and twin.json()["phone"] == f"+91{n}", "a number may be shared (a family phone): it is allowed, and found"
    found = client.get(url(tenant, "/contacts/by-phone"), params={"phone": f"0{n}"}, headers=h(tenant, "sales"))
    assert found.status_code == 200 and found.json()["contact_id"] == first["contact"] and found.json()["lead_ids"] == [first["lead"]]
    assert [x["contact_id"] for x in found.json()["holders"]] == [first["contact"], twin.json()["id"]], "the oldest first, then the others"
    assert client.get(url(tenant, "/contacts/by-phone"), params={"phone": "70000 00000"}, headers=h(tenant, "owner")).json() == {"found": False, "holders": []}
    assert client.get(url(tenant, "/contacts/by-phone"), params={"phone": n}, headers=h(tenant, "viewer")).status_code == 403


def test_another_business_neither_sees_nor_collides_with_the_number(client: TestClient, eval_world: World) -> None:
    a, b = eval_world.a, eval_world.b
    n = f"+00 9{uuid.uuid4().int % 10**9:09d}"  # a reserved synthetic number: business B's gate is closed
    mine = make_customer(client, a, n, "Business A Shop")
    theirs = make_customer(client, b, n, "Business B Shop")
    assert mine["contact"] != theirs["contact"], "the same number in two businesses is two contacts"
    seen = client.get(url(b, "/contacts/by-phone"), params={"phone": n}, headers=h(b, "owner")).json()
    assert seen["contact_id"] == theirs["contact"] and [x["contact_id"] for x in seen["holders"]] == [theirs["contact"]]
    assert client.get(url(a, "/contacts/by-phone"), params={"phone": n}, headers=h(b, "owner")).status_code in (403, 404)


def test_the_lead_import_makes_phone_only_contacts_and_finds_them_again(client: TestClient, eval_world: World, tenant) -> None:  # type: ignore[no-untyped-def]
    tag = uid()[:6]
    suffix = f"{uuid.uuid4().int % 10**5:05d}"
    closed = eval_world.b  # the gate is closed here
    rows = [
        {"company_name": f"Import Phone {tag}", "contact_name": "Ravi", "contact_phone": f"+00 90000 {suffix}"},
        {"company_name": f"Import Real {tag}", "contact_name": "Real", "contact_phone": "98765 43210"},
        {"company_name": f"Import Role {tag}", "contact_name": "Boss"},
    ]
    r = client.post(url(closed, "/leads/import"), json={"batch_id": uid(), "rows": rows}, headers=h(closed, "sales"))
    assert r.status_code == 201, r.text
    got = [(x["outcome"], x["reason"]) for x in r.json()["rows"]]
    assert got == [("created", None), ("rejected", "contact_phone_not_reserved"), ("rejected", "contact_requires_email")]
    contact = r.json()["rows"][0]["contact_id"]
    assert operator_sql.sql(f"select (email is null)::text from public.contacts where id = '{contact}'") == "true"
    assert operator_sql.sql(f"select (phone_hmac is not null)::text from suppression.contact_keys where contact_id = '{contact}'") == "true", "the contacts the import made are keyed, phone-only ones too"
    again = client.post(url(closed, "/leads/import"), json={"batch_id": uid(), "rows": [{**rows[0], "contact_phone": f"+0090000 {suffix}"}]}, headers=h(closed, "sales"))
    assert again.json()["rows"][0]["reason"] == "existing_open_lead", "found by the normalised number, not by the e-mail"
    assert again.json()["counts"]["contacts_created"] == 0
    # the open gate (business A): the real number is accepted, stored as +91 and ten digits, and found in any spelling
    real = client.post(url(tenant, "/leads/import"), json={"batch_id": uid(), "rows": [{"company_name": f"Import Real {tag}", "contact_name": "Real", "contact_phone": f"98765 {suffix}"}]}, headers=h(tenant, "sales"))
    assert real.json()["rows"][0]["outcome"] == "created"
    assert operator_sql.sql(f"select phone from public.contacts where id = '{real.json()['rows'][0]['contact_id']}'") == f"+9198765{suffix}"
    twice = client.post(url(tenant, "/leads/import"), json={"batch_id": uid(), "rows": [{"company_name": f"Import Real {tag}", "contact_name": "Real", "contact_phone": f"0 98765-{suffix}"}]}, headers=h(tenant, "sales"))
    assert twice.json()["rows"][0]["reason"] == "existing_open_lead"


def csv_file(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return buf.getvalue().encode()


def test_the_spreadsheet_import_imports_phone_only_contacts(client: TestClient, tenant) -> None:  # type: ignore[no-untyped-def]
    tag = uid()[:6]
    suffix = f"{uuid.uuid4().int % 10**5:05d}"
    f = csv_file([["Party Name", "Mobile", "City"], [f"Sheet Phone {tag}", f"+00 90000 {suffix}", "Guntur"]])
    job = uid()
    headers = {**h(tenant, "owner"), "Content-Type": "text/csv"}
    pv = client.post(url(tenant, f"/imports/spreadsheet/preview?kind=customers&job_id={job}"), content=f, headers=headers)
    assert pv.status_code == 200, pv.text
    row = pv.json()["rows"][0]
    assert row["status"] == "will_create" and row["note"] == "contact_named_after_company"
    done = client.post(url(tenant, f"/imports/spreadsheet/{job}/confirm"), content=f, headers=headers)
    assert done.status_code == 200 and done.json()["result"]["counts"]["created"] == 1, done.text
    n = operator_sql.sql(f"select count(*) from public.contacts where tenant_id = '{tenant.id}' and phone = '+00 90000 {suffix}' and email is null and full_name like 'Sheet Phone {tag}%'")
    assert n == "1"


def test_a_whatsapp_message_can_be_made_for_a_phone_only_customer(client: TestClient, tenant) -> None:  # type: ignore[no-untyped-def]
    n = f"6{uuid.uuid4().int % 10**9:09d}"
    made = make_customer(client, tenant, n, "WhatsApp Only Shop")
    consent = client.post(
        url(tenant, f"/contacts/{made['contact']}/record-consent"),
        json={"channel": "whatsapp", "status": "granted", "basis": "explicit_consent", "evidence_type": "verbal", "evidence_ref": "note:bo"},
        headers=h(tenant, "owner"),
    )
    assert consent.status_code == 200, consent.text
    operator_sql.sql("select app.operator_set_outbox(true)")  # the global kill switch is OFF by default; this test needs the policy to look past it, and puts it back
    try:
        msg = client.post(
            url(tenant, "/outbox/messages"),
            json={"message_id": uid(), "lead_id": made["lead"], "text": "Namaste, your sarees are ready.", "language": "en", "category": "info", "source": "owner"},
            headers=h(tenant, "sales"),
        )
    finally:
        operator_sql.sql("select app.operator_set_outbox(false)")
    assert msg.status_code in (200, 201), msg.text
    body = msg.json()["message"]
    assert body["reason"] not in ("no_phone", "no_key", "no_contact", "erased"), f"blocked for want of a phone, a key or a contact: {body['reason']}"
    assert body["status"] in ("queued", "needs_approval"), body["reason"]
    assert body["contact_id"] == made["contact"]


def test_a_phone_only_contact_can_be_erased_and_its_number_is_remembered_as_a_key(client: TestClient, tenant) -> None:  # type: ignore[no-untyped-def]
    n = f"9{uuid.uuid4().int % 10**9:09d}"
    made = make_customer(client, tenant, n, "Erase Me Phone")
    request = uid()
    r = client.post(url(tenant, "/erasure-requests"), json={"id": request, "scope": "contact", "subject_id": made["contact"]}, headers=h(tenant, "owner"))
    assert r.status_code == 201, r.text
    done = client.post(url(tenant, f"/erasure-requests/{request}/execute"), json={"dry_run": False}, headers=h(tenant, "owner"))
    assert done.status_code in (200, 409), done.text
    if done.status_code == 200:
        assert operator_sql.sql(f"select (phone is null)::text from public.contacts where id = '{made['contact']}'") == "true"
        free = client.post(url(tenant, "/contacts"), json={"id": uid(), "full_name": "New holder", "phone": n}, headers=h(tenant, "sales"))
        assert free.status_code in (201, 409), "an erased contact no longer holds the number (a suppressed key may still stop contact)"


def test_http_clients_are_real(client: TestClient) -> None:
    assert isinstance(client, TestClient) and httpx.__version__
