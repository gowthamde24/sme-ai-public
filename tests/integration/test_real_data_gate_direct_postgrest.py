"""The real-data gate (ADR 0015), attacked the way a signed-in user can: through OUR API and straight through PostgREST. While a workspace's
gate is closed, a contact's e-mail must be on a reserved domain and its phone must start "+00" on every path; only the operator (here the
local database owner) opens or closes it; one workspace's gate never affects another's. What an attack achieved is judged by the victim
data afterwards."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

from typing import Any

import httpx
import operator_sql
import pytest
from conftest import bearer
from crm_support import Tenant, World, create_payload
from evidence_support import code_of, pg, uid
from fastapi.testclient import TestClient

REAL_EMAIL = "someone.real@gmail.com"
REAL_PHONE = "+91 98765 43210"
FIXED_MESSAGE = "real data is not accepted in this workspace yet"


@pytest.fixture(scope="module")
def w(client: TestClient, stack: Any, signup: Any) -> World:
    return World(client, stack, signup)


def policy(w: World, t: Tenant) -> httpx.Response:
    r: httpx.Response = w.client.get(
        f"/v1/tenants/{t.id}/data-policy", headers=bearer(t.users["owner"])
    )
    return r


def api_contact(w: World, t: Tenant, **over: Any) -> httpx.Response:
    return w.call(
        t.users["owner"], "POST", t, "contacts", json=create_payload("contacts", t, uid(), **over)
    )


def refused_by_gate(r: httpx.Response) -> bool:
    return (
        r.status_code in (400, 403, 409, 422)
        and code_of(r) == "SM401"
        and r.json().get("message") == FIXED_MESSAGE
    )


def contact_count(w: World, t: Tenant) -> int:
    r = pg(w.stack, t.users["owner"], "GET", "/contacts?select=id")
    assert r.status_code == 200, r.text
    return len(r.json())


def test_a_new_workspace_is_closed_and_every_member_can_read_that(w: World) -> None:
    for tenant in (w.a, w.b):
        for role, user in tenant.users.items():
            r = w.client.get(f"/v1/tenants/{tenant.id}/data-policy", headers=bearer(user))
            assert r.status_code == 200 and r.json() == {"real_data_allowed": False}, (
                tenant.label,
                role,
            )
    assert (
        w.client.get(
            f"/v1/tenants/{w.a.id}/data-policy", headers=bearer(w.b.users["owner"])
        ).status_code
        == 404
    )
    assert w.client.get(f"/v1/tenants/{w.a.id}/data-policy").status_code == 401


def test_closed_gate_through_the_api(w: World) -> None:
    a = w.a
    before = contact_count(w, a)
    real_email = api_contact(w, a, email=REAL_EMAIL)
    assert (
        real_email.status_code == 409
        and real_email.json()["error"]["code"] == "real_data_gate_closed"
    )
    assert REAL_EMAIL not in real_email.text
    real_phone = api_contact(w, a, email=f"{uid()}@example.test", phone=REAL_PHONE)
    assert (
        real_phone.status_code == 409
        and real_phone.json()["error"]["code"] == "real_data_gate_closed"
    )
    assert REAL_PHONE not in real_phone.text
    ok = api_contact(w, a, email=f"{uid()}@example.test", phone="+00 90000 12345")
    assert ok.status_code == 201, ok.text
    assert contact_count(w, a) == before + 1, "only the reserved contact was created"


def test_closed_gate_straight_through_postgrest(w: World) -> None:
    a = w.a
    owner = a.users["owner"]
    company = a.rows["companies"]["id"]
    before = contact_count(w, a)
    for label, extra in (
        ("real e-mail", {"email": REAL_EMAIL}),
        ("real phone", {"email": f"{uid()}@example.test", "phone": REAL_PHONE}),
        ("real phone only", {"phone": REAL_PHONE}),
    ):
        body = {
            "id": uid(),
            "tenant_id": a.id,
            "company_id": company,
            "full_name": "DEMO Direct",
            **extra,
        }
        r = pg(w.stack, owner, "POST", "/contacts", json=body, representation=False)
        assert refused_by_gate(r), (label, r.status_code, r.text)
    assert contact_count(w, a) == before
    # an update to a real value is refused, and the row keeps what it had
    target = a.rows["contacts"]["id"]
    for patch in ({"email": REAL_EMAIL}, {"phone": REAL_PHONE}):
        r = pg(
            w.stack, owner, "PATCH", f"/contacts?id=eq.{target}", json=patch, representation=False
        )
        assert refused_by_gate(r), (patch, r.status_code, r.text)
    row = pg(w.stack, owner, "GET", f"/contacts?id=eq.{target}&select=email,phone").json()[0]
    assert row["email"] != REAL_EMAIL and row["phone"] != REAL_PHONE
    # a reserved value is fine, and so is a change that touches neither identifier
    assert pg(
        w.stack,
        owner,
        "PATCH",
        f"/contacts?id=eq.{target}",
        json={"job_title": "Buyer"},
        representation=False,
    ).status_code in (200, 204)
    # the import function agrees
    rows = [{"company_name": "DEMO Gate Co", "contact_name": "DEMO P", "contact_email": REAL_EMAIL}]
    rep = pg(
        w.stack,
        owner,
        "POST",
        "/rpc/import_lead_rows",
        json={
            "p_tenant_id": a.id,
            "p_batch_id": uid(),
            "p_rows": rows,
            "p_label": None,
            "p_dry_run": False,
        },
    )
    assert rep.status_code == 200, rep.text
    assert rep.json()["rows"][0]["reason"] == "contact_domain_not_reserved"
    assert contact_count(w, a) == before


MALFORMED = (
    ("zero-width character in the e-mail", {"email": "x\u200b@example.test"}),
    ("no dot in the domain", {"email": "a@b"}),
    ("whitespace inside the e-mail", {"email": "a b@example.test"}),
    ("trailing dot after the domain", {"email": "a@example.com."}),
    ("Cyrillic look-alike of example.com", {"email": "a@ex\u0430mple.com"}),
    ("a domain that only ends like a reserved one", {"email": "a@notexample.com"}),
    ("zero-width character in the phone", {"email": "x@example.test", "phone": "+00 12\u200b34 567"}),
    ("a space after the plus", {"email": "x@example.test", "phone": "+ 00 1234 567"}),
)


def test_a_closed_gate_fails_closed_on_malformed_values_too(w: World) -> None:
    """A value the table's CHECKs would also refuse is refused by the gate itself (SM401), through PostgREST and through our API."""
    a = w.a
    owner = a.users["owner"]
    company = a.rows["companies"]["id"]
    before = contact_count(w, a)
    for label, extra in MALFORMED:
        body = {"id": uid(), "tenant_id": a.id, "company_id": company, "full_name": "DEMO Malformed", **extra}
        r = pg(w.stack, owner, "POST", "/contacts", json=body, representation=False)
        assert refused_by_gate(r), (label, r.status_code, r.text)
        api = api_contact(w, a, **extra)
        # our API may refuse a malformed value earlier still (422 validation); either way it is refused and nothing is created
        assert api.status_code in (409, 422), (label, api.status_code, api.text)
        if api.status_code == 409:
            assert api.json()["error"]["code"] == "real_data_gate_closed", (label, api.text)
    assert contact_count(w, a) == before
    # what is allowed stays allowed: upper case, and a bare "+00"
    for extra in ({"email": f"{uid()}@EXAMPLE.COM"}, {"phone": "+00"}):
        body = {"id": uid(), "tenant_id": a.id, "company_id": company, "full_name": "DEMO Fine", **extra}
        r = pg(w.stack, owner, "POST", "/contacts", json=body, representation=False)
        assert r.status_code in (200, 201, 204), (extra, r.status_code, r.text)


def test_nobody_can_open_the_gate_from_a_request(w: World) -> None:
    a, b = w.a, w.b
    forged = {
        "tenant_id": a.id,
        "real_data_allowed": True,
        "erasure_ref": "adr:1",
        "hosting_ref": "adr:1",
        "dpdp_review_ref": "adr:1",
        "restore_drill_ref": "adr:1",
        "opened_at": "2026-10-05T00:00:00Z",
    }
    for user in (a.users["owner"], a.users["admin"], b.users["owner"], None):
        r = pg(w.stack, user, "POST", "/tenant_data_policy", json=forged, representation=False)
        assert r.status_code in (401, 403) and code_of(r) == "42501", (user and user.label, r.text)
        up = pg(
            w.stack,
            user,
            "PATCH",
            f"/tenant_data_policy?tenant_id=eq.{a.id}",
            json={"real_data_allowed": True},
            representation=False,
        )
        assert (
            up.status_code in (401, 403)
            and code_of(up) == "42501"
            or (up.status_code == 200 and up.json() == [])
        ), (user and user.label, up.text)
    # the operator functions are not reachable at all: unknown to the default schema, refused in the private one
    for name in (
        "operator_open_real_data_gate",
        "operator_close_real_data_gate",
        "real_data_gate_open",
        "guard_real_data",
    ):
        for user in (a.users["owner"], None):
            plain = pg(w.stack, user, "POST", f"/rpc/{name}", json={"p_tenant_slug": "x"})
            assert plain.status_code == 404 and code_of(plain) == "PGRST202", (name, plain.text)
            private = httpx.post(
                f"{w.stack.rest}/rpc/{name}",
                headers=w.stack.headers(user.token if user else None, **{"Content-Profile": "app"}),
                json={},
                timeout=15,
            )
            assert private.status_code == 406 and private.json()["code"] == "PGRST106", (
                name,
                private.text,
            )
    assert policy(w, a).json() == {"real_data_allowed": False}
    assert refused_by_gate(
        pg(
            w.stack,
            a.users["owner"],
            "POST",
            "/contacts",
            json={"id": uid(), "tenant_id": a.id, "full_name": "DEMO X", "email": REAL_EMAIL},
            representation=False,
        )
    )


def test_opening_one_workspace_does_not_open_another_and_closing_restores_the_refusal(
    w: World,
) -> None:
    a, b = w.a, w.b
    operator_sql.open_real_data_gate(a.id)
    try:
        assert policy(w, a).json() == {"real_data_allowed": True}
        assert policy(w, b).json() == {"real_data_allowed": False}
        real = api_contact(w, a, email=REAL_EMAIL, phone=REAL_PHONE, full_name="Real Person")
        assert real.status_code == 201, real.text
        assert api_contact(w, b, email=f"x{uid()[:6]}@gmail.com").status_code == 409, (
            "tenant b is independent"
        )
        # the opening is on the audit log, as the system, with the references and nothing else
        log = pg(
            w.stack,
            a.users["owner"],
            "GET",
            "/audit_events?entity_type=eq.tenant_data_policy&select=actor_type,new_values&order=id.desc&limit=1",
        )
        assert log.status_code == 200 and log.json()[0]["actor_type"] == "system"
        assert log.json()[0]["new_values"]["real_data_allowed"] is True
    finally:
        operator_sql.close_real_data_gate(a.id)
    assert policy(w, a).json() == {"real_data_allowed": False}
    assert api_contact(w, a, email=f"y{uid()[:6]}@gmail.com").status_code == 409, (
        "closed again: refused again"
    )
    # real data already in is neither locked nor hidden: the Owner can still archive it, and erase it
    real_id = real.json()["id"]
    archived = w.call(a.users["owner"], "POST", a, "contacts", f"/{real_id}/archive")
    assert archived.status_code == 200, archived.text
    rid = uid()
    asked = w.client.post(
        f"/v1/tenants/{a.id}/erasure-requests",
        json={"id": rid, "scope": "contact", "subject_id": real_id},
        headers=bearer(a.users["owner"]),
    )
    assert asked.status_code == 201, asked.text
    done = w.client.post(
        f"/v1/tenants/{a.id}/erasure-requests/{rid}/execute",
        json={},
        headers=bearer(a.users["owner"]),
    )
    assert done.status_code == 200, done.text
    gone = pg(
        w.stack, a.users["owner"], "GET", f"/contacts?id=eq.{real_id}&select=email,phone,full_name"
    ).json()[0]
    assert gone == {"email": None, "phone": None, "full_name": "erased:1"}, (
        "the gate does not stand in the way of an erasure"
    )
