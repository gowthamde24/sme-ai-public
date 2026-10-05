"""Erasure against the real stack (ADR 0014). PostgREST is reachable by anyone holding a user JWT and the
public anon key, so these tests skip OUR API and attack the three erasure functions and the request log
directly, as real signed-in users: anon, a foreign tenant, Sales, a Viewer, an Admin where only the Owner may
act, and unknown ids; direct INSERT / UPDATE / DELETE on the request log; subjects of another tenant; the
immutable tables and the erased-row guard after an erasure; a workspace-wide request inside its 24 hours; and
a concurrent double execute. What an attack achieved is judged by the victim data afterwards, never by the
response alone.

The happy paths go through OUR API (the Owner's page uses the same calls) and are validated against
packages/contracts/erasure.schema.json."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import operator_sql
import pytest
from conftest import User, bearer
from crm_support import Tenant, World, create_payload
from evidence_support import body as evidence_body
from evidence_support import code_of, pg, uid
from fastapi.testclient import TestClient

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "packages/contracts/erasure.schema.json").read_text()
)
GENERIC = "erasure action not permitted"
EMAIL = "zed.qxjv@canary.test"


def check_schema(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


def with_open_gate(world: World) -> World:
    """The erasure suites plant real-looking phone numbers: the gate is opened for their own workspaces (ADR 0015)."""
    for tenant in (world.a, world.b):
        operator_sql.open_real_data_gate(tenant.id)
    return world


@pytest.fixture(scope="module")
def w(client: TestClient, stack: Any, signup: Any) -> World:
    return with_open_gate(World(client, stack, signup))


@pytest.fixture(scope="module")
def w2(client: TestClient, stack: Any, signup: Any) -> World:
    """A second pair of tenants, for the destructive workspace-wide erasure."""
    return with_open_gate(World(client, stack, signup))


# ------------------------------------------------------------------------------ plumbing
def rpc(w: World, user: User | None, name: str, **args: Any) -> httpx.Response:
    return pg(w.stack, user, "POST", f"/rpc/{name}", json=args)


def api(
    w: World, user: User, method: str, tenant: Tenant, path: str = "", **kw: Any
) -> httpx.Response:
    response: httpx.Response = w.client.request(
        method, f"/v1/tenants/{tenant.id}/erasure-requests{path}", headers=bearer(user), **kw
    )
    return response


def is_generic(r: httpx.Response) -> bool:
    return (
        r.status_code in (401, 403) and code_of(r) == "42501" and r.json().get("message") == GENERIC
    )


def is_state(r: httpx.Response, code: str) -> bool:
    return r.status_code in (400, 403, 409) and code_of(r) == code


def add_person(w: World, t: Tenant, **over: Any) -> dict[str, str]:
    """A contact with an e-mail and a phone, a lead linked to it whose source carries the number, and evidence on
    the company whose snippet carries the e-mail."""
    owner = t.users["owner"]
    cid = uid()
    digits = str(int(cid[:8], 16) % 10**10).zfill(
        10
    )  # a number of its own, so a sweep for one person finds only that person
    contact = w.call(
        owner,
        "POST",
        t,
        "contacts",
        json=create_payload(
            "contacts",
            t,
            cid,
            full_name="Zed Qxjv",
            email=f"{cid[:8]}.{EMAIL}",
            phone=f"+91 {digits[:5]} {digits[5:]}",
            job_title="Director",
            **over,
        ),
    )
    assert contact.status_code == 201, contact.text
    lid = uid()
    lead = w.call(
        owner,
        "POST",
        t,
        "leads",
        json=create_payload("leads", t, lid, contact_id=cid, source=f"Intro {digits}"),
    )
    assert lead.status_code == 201, lead.text
    eid = uid()
    ev = w.call(
        owner,
        "POST",
        t,
        "companies",
        f"/{t.rows['companies']['id']}/evidence",
        json=evidence_body(id=eid, snippet=f"Mail {cid[:8]}.{EMAIL} today"),
    )
    assert ev.status_code == 201, ev.text
    return {"contact": cid, "lead": lid, "evidence": eid, "email": f"{cid[:8]}.{EMAIL}"}


def request(
    w: World, user: User, t: Tenant, scope: str, subject: str | None, rid: str | None = None
) -> str:
    rid = rid or uid()
    r = api(
        w,
        user,
        "POST",
        t,
        json={"id": rid, "scope": scope, **({"subject_id": subject} if subject else {})},
    )
    assert r.status_code == 201, r.text
    check_schema(r.json(), "ErasureRequestOut")
    return rid


def row(w: World, user: User, table: str, row_id: str) -> dict[str, Any] | None:
    r = pg(w.stack, user, "GET", f"/{table}?id=eq.{row_id}&select=*")
    assert r.status_code == 200, r.text
    rows = r.json()
    return rows[0] if rows else None


def must(w: World, user: User, table: str, row_id: str) -> dict[str, Any]:
    found = row(w, user, table, row_id)
    assert found is not None, (table, row_id)
    return found


def snapshot(w: World, t: Tenant) -> str:
    """Everything tenant t's owner can read in the tables an erasure could touch, as one string."""
    owner = t.users["owner"]
    parts = []
    for table in (
        "contacts",
        "companies",
        "leads",
        "opportunities",
        "evidence",
        "claims",
        "products",
    ):
        r = pg(w.stack, owner, "GET", f"/{table}?select=*&order=id")
        assert r.status_code == 200, (table, r.text)
        parts.append(json.dumps(r.json(), sort_keys=True))
    return "|".join(parts)


# ------------------------------------------------------------------------------ the refusals
def test_every_refusal_before_the_role_is_proven_is_the_same_generic_error(w: World) -> None:
    a, b = w.a, w.b
    person = add_person(w, a)
    rid = request(w, a.users["owner"], a, "contact", person["contact"])
    before = snapshot(w, a), snapshot(w, b)

    attempts: list[tuple[str, User | None, str, dict[str, Any]]] = []
    for who, user in (
        ("anon", None),
        ("foreign owner", b.users["owner"]),
        ("sales", a.users["sales"]),
        ("viewer", a.users["viewer"]),
    ):
        attempts += [
            (
                who,
                user,
                "request_erasure",
                {
                    "p_request_id": uid(),
                    "p_tenant_id": a.id,
                    "p_scope": "contact",
                    "p_subject_id": person["contact"],
                },
            ),
            (who, user, "execute_erasure", {"p_request_id": rid, "p_dry_run": False}),
            (who, user, "cancel_erasure", {"p_request_id": rid}),
        ]
    attempts += [
        (
            "admin executes",
            a.users["admin"],
            "execute_erasure",
            {"p_request_id": rid, "p_dry_run": False},
        ),
        (
            "unknown request",
            a.users["owner"],
            "execute_erasure",
            {"p_request_id": uid(), "p_dry_run": False},
        ),
        ("unknown request", a.users["owner"], "cancel_erasure", {"p_request_id": uid()}),
        (
            "unknown tenant",
            a.users["owner"],
            "request_erasure",
            {"p_request_id": uid(), "p_tenant_id": uid(), "p_scope": "tenant"},
        ),
        (
            "null request id",
            a.users["owner"],
            "request_erasure",
            {"p_request_id": None, "p_tenant_id": a.id, "p_scope": "tenant"},
        ),
    ]
    bodies = set()
    for who, user, name, args in attempts:
        r = rpc(w, user, name, **args)
        if user is None:
            assert r.status_code in (401, 403) and code_of(r) == "42501", (who, name, r.text)
            continue
        assert is_generic(r), (who, name, r.status_code, r.text)
        bodies.add(json.dumps(r.json(), sort_keys=True))
    assert len(bodies) == 1, "unknown, foreign and wrong-role refusals are indistinguishable"
    assert (snapshot(w, a), snapshot(w, b)) == before, "no attack changed a byte"
    assert must(w, a.users["owner"], "erasure_requests", rid)["status"] == "pending"


def test_the_request_log_is_readable_by_owner_and_admin_only_and_writable_by_nobody(
    w: World,
) -> None:
    a, b = w.a, w.b
    rid = request(w, a.users["owner"], a, "tenant", None)
    assert row(w, a.users["owner"], "erasure_requests", rid) is not None
    assert row(w, a.users["admin"], "erasure_requests", rid) is not None
    for user in (a.users["sales"], a.users["viewer"], b.users["owner"]):
        assert row(w, user, "erasure_requests", rid) is None, (
            "the log is invisible to everyone else"
        )
    forged = {
        "id": uid(),
        "tenant_id": a.id,
        "scope": "tenant",
        "requested_by": str(a.users["owner"].id),
        "execute_after": "2020-01-01T00:00:00Z",
        "status": "executed",
    }
    writers: list[User | None] = [a.users["owner"], a.users["admin"], b.users["owner"], None]
    for writer in writers:
        r = pg(w.stack, writer, "POST", "/erasure_requests", json=forged, representation=False)
        assert r.status_code in (401, 403) and code_of(r) == "42501", (
            writer and writer.label,
            r.text,
        )
    for user in (a.users["owner"], a.users["admin"]):
        up = pg(
            w.stack,
            user,
            "PATCH",
            f"/erasure_requests?id=eq.{rid}",
            json={"execute_after": "2020-01-01T00:00:00Z", "status": "executed"},
            representation=False,
        )
        assert up.status_code in (401, 403) and code_of(up) == "42501"
        de = pg(w.stack, user, "DELETE", f"/erasure_requests?id=eq.{rid}", representation=False)
        assert de.status_code in (401, 403) and code_of(de) == "42501"
    after = row(w, a.users["owner"], "erasure_requests", rid)
    assert after is not None and after["status"] == "pending"
    assert after["execute_after"] > after["created_at"], "the 24-hour window was not shortened"


def test_a_subject_of_another_tenant_is_an_invalid_reference_and_nothing_moves(w: World) -> None:
    a, b = w.a, w.b
    before = snapshot(w, b)
    for scope, subject in (
        ("contact", b.rows["contacts"]["id"]),
        ("company", b.rows["companies"]["id"]),
        ("contact", a.rows["companies"]["id"]),
        ("company", a.rows["contacts"]["id"]),
    ):
        r = rpc(
            w,
            a.users["owner"],
            "request_erasure",
            p_request_id=uid(),
            p_tenant_id=a.id,
            p_scope=scope,
            p_subject_id=subject,
        )
        assert r.status_code in (400, 403, 409) and code_of(r) == "23503", (scope, r.text)
        assert r.json()["message"] == "invalid reference"
    api_r = api(
        w,
        a.users["owner"],
        "POST",
        a,
        json={"id": uid(), "scope": "contact", "subject_id": b.rows["contacts"]["id"]},
    )
    assert api_r.status_code == 422 and api_r.json()["error"]["code"] == "invalid_reference"
    assert snapshot(w, b) == before


# ------------------------------------------------------------------------------ a contact, end to end
def test_a_contact_erasure_end_to_end(w: World) -> None:
    a, b = w.a, w.b
    owner = a.users["owner"]
    person = add_person(w, a)
    other = add_person(w, a)  # another person in the same workspace: must be unaffected
    b_before = snapshot(w, b)
    rid = request(w, owner, a, "contact", person["contact"])

    # idempotent request
    again = api(
        w, owner, "POST", a, json={"id": rid, "scope": "contact", "subject_id": person["contact"]}
    )
    assert again.status_code == 200
    clash = api(
        w,
        owner,
        "POST",
        a,
        json={"id": rid, "scope": "company", "subject_id": a.rows["companies"]["id"]},
    )
    assert clash.status_code == 409

    # a preview changes nothing
    live = row(w, owner, "contacts", person["contact"])
    assert live is not None
    dry = api(w, owner, "POST", a, f"/{rid}/execute", json={"dry_run": True})
    assert dry.status_code == 200, dry.text
    check_schema(dry.json(), "ErasureResultOut")
    assert dry.json()["dry_run"] is True and dry.json()["counts"]["contacts.email"] == 1
    assert row(w, owner, "contacts", person["contact"]) == live
    assert must(w, owner, "erasure_requests", rid)["status"] == "pending"

    # the admin cannot execute; the owner can
    assert api(w, a.users["admin"], "POST", a, f"/{rid}/execute", json={}).status_code == 403
    done = api(w, owner, "POST", a, f"/{rid}/execute", json={})
    assert done.status_code == 200, done.text
    check_schema(done.json(), "ErasureResultOut")
    result = done.json()
    assert result["status"] == "executed" and result["replayed"] is False
    assert result["counts"]["contacts.full_name"] == 1 and result["counts"]["leads.source"] == 1
    assert "names" in result["note"].lower()

    # what happened
    c = row(w, owner, "contacts", person["contact"])
    assert (
        c is not None
        and c["full_name"] == "erased:1"
        and c["email"] is None
        and c["phone"] is None
        and c["job_title"] is None
    )
    assert c["erased_at"] is not None and c["archived_at"] is not None
    assert must(w, owner, "leads", person["lead"])["source"] == "erased:1"
    snippet = must(w, owner, "evidence", person["evidence"])["snippet"]
    assert snippet == "Mail erased-1 today", "the e-mail was replaced INSIDE the free text"
    o = row(w, owner, "contacts", other["contact"])
    assert o is not None and o["full_name"] == "Zed Qxjv" and o["email"] == other["email"], (
        "another person is untouched"
    )
    assert snapshot(w, b) == b_before, "the other tenant is byte-identical"
    # the name is shared by the other person's contact: not an identifier, so it is not swept out of free text
    assert must(w, owner, "evidence", other["evidence"])["snippet"].startswith("Mail ")

    # replay, and nothing to cancel any more
    replay = api(w, owner, "POST", a, f"/{rid}/execute", json={})
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    cancel = api(w, owner, "POST", a, f"/{rid}/cancel")
    assert (
        cancel.status_code == 409 and cancel.json()["error"]["code"] == "erasure_already_executed"
    )
    listed = api(w, owner, "GET", a)
    assert listed.status_code == 200
    check_schema(listed.json(), "Page_ErasureRequestOut_")
    assert "qxjv" not in json.dumps(listed.json()).lower(), "the log holds no value"


def test_after_an_erasure_the_immutable_tables_and_the_erased_row_stay_protected(w: World) -> None:
    a = w.a
    owner = a.users["owner"]
    person = add_person(w, a)
    rid = request(w, owner, a, "contact", person["contact"])
    assert api(w, owner, "POST", a, f"/{rid}/execute", json={}).status_code == 200
    live = add_person(w, a)

    def refused(r: httpx.Response) -> bool:
        return (r.status_code in (401, 403) and code_of(r) == "42501") or (
            r.status_code == 200 and r.json() == []
        )

    for patch, table, rid_ in (
        ({"snippet": "forged"}, "evidence", person["evidence"]),
        ({"full_name": "Back Again"}, "contacts", person["contact"]),
        ({"email": "back@example.test"}, "contacts", person["contact"]),
        ({"erased_at": None}, "contacts", person["contact"]),
        ({"erased_at": "2020-01-01T00:00:00Z"}, "contacts", live["contact"]),
    ):
        r = pg(w.stack, owner, "PATCH", f"/{table}?id=eq.{rid_}", json=patch, representation=False)
        assert refused(r), (table, patch, r.status_code, r.text)
    c = must(w, owner, "contacts", person["contact"])
    assert c["full_name"] == "erased:1" and c["email"] is None and c["erased_at"] is not None
    assert must(w, owner, "contacts", live["contact"])["erased_at"] is None, (
        "a client cannot mark a live contact erased"
    )
    assert must(w, owner, "evidence", person["evidence"])["snippet"] == "Mail erased-1 today"
    # the settings that open the door are not reachable through the API
    for name in ("set_config", "erasure_running"):
        r = pg(w.stack, owner, "POST", f"/rpc/{name}", json={"p_tenant_id": a.id})
        assert r.status_code in (404, 406), (name, r.text)


def test_a_second_execute_that_arrives_mid_run_waits_and_is_a_replay(w: World) -> None:
    """The first execute is held open (its transaction sleeps before it commits). The second arrives meanwhile over
    PostgREST: it must WAIT for the per-workspace lock and then answer with the stored result, not do the work again."""
    a = w.a
    owner = a.users["owner"]
    person = add_person(w, a)
    rid = request(w, owner, a, "contact", person["contact"])
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(
            operator_sql.sql_result,
            operator_sql.as_user(
                str(owner.id),
                f"select public.execute_erasure('{rid}', false) ->> 'replayed';",
                hold_seconds=3.0,
            ),
            timeout=60,
        )
        # wait until the held transaction has done its work and is sleeping before its commit (a docker exec takes a moment)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if (
                operator_sql.sql(
                    "select count(*) from pg_stat_activity where wait_event = 'PgSleep'"
                )
                != "0"
            ):
                break
            time.sleep(0.1)
        else:
            pytest.fail("the held transaction never reached its sleep")
        started = time.monotonic()
        second = rpc(w, owner, "execute_erasure", p_request_id=rid, p_dry_run=False)
        waited = time.monotonic() - started
        code, output, error = first.result(timeout=60)
    assert second.status_code == 200, second.text
    assert second.json()["replayed"] is True, "the late call found the work done"
    assert waited > 0.5, f"the late call did not wait for the lock ({waited:.2f}s)"
    assert code == 0 and "false" in output.splitlines(), (output, error)
    assert must(w, owner, "contacts", person["contact"])["full_name"] == "erased:1"


# ------------------------------------------------------------------------------ the whole workspace
def test_a_workspace_erasure_waits_24_hours_can_be_cancelled_and_then_wipes_only_its_own_tenant(
    w2: World,
) -> None:
    a, b = w2.a, w2.b
    owner, admin = a.users["owner"], a.users["admin"]
    person = add_person(w2, a)
    b_person = add_person(w2, b)
    b_before = snapshot(w2, b)

    rid = request(w2, admin, a, "tenant", None)  # an Admin may ask
    window = api(w2, owner, "POST", a, f"/{rid}/execute", json={})
    assert window.status_code == 409 and window.json()["error"]["code"] == "erasure_window_open"
    assert is_state(rpc(w2, owner, "execute_erasure", p_request_id=rid, p_dry_run=False), "SM302")
    preview = api(w2, owner, "POST", a, f"/{rid}/execute", json={"dry_run": True})
    assert preview.status_code == 200 and preview.json()["counts"]["contacts.email"] >= 1, (
        "the owner may preview inside the window"
    )

    # cancel, and it can never run
    assert api(w2, admin, "POST", a, f"/{rid}/cancel").json()["status"] == "cancelled"
    gone = api(w2, owner, "POST", a, f"/{rid}/execute", json={})
    assert gone.status_code == 409 and gone.json()["error"]["code"] == "erasure_cancelled"
    assert is_state(rpc(w2, owner, "execute_erasure", p_request_id=rid, p_dry_run=False), "SM304")
    assert must(w2, owner, "contacts", person["contact"])["email"] is not None, "still intact"

    # a second request; the window is moved into the past by the operator (a test cannot wait a day)
    rid2 = request(w2, owner, a, "tenant", None)
    operator_sql.sql(
        f"update public.erasure_requests set execute_after = now() - interval '1 minute' where id = '{rid2}'"
    )
    done = api(w2, owner, "POST", a, f"/{rid2}/execute", json={})
    assert done.status_code == 200, done.text
    check_schema(done.json(), "ErasureResultOut")
    assert done.json()["counts"]["contacts.erased"] >= 2

    contacts = pg(
        w2.stack, owner, "GET", "/contacts?select=full_name,email,phone,job_title,erased_at"
    )
    assert contacts.status_code == 200 and contacts.json()
    assert all(
        c["full_name"] == "erased:1"
        and c["email"] is None
        and c["phone"] is None
        and c["erased_at"] is not None
        for c in contacts.json()
    )
    assert must(w2, owner, "leads", person["lead"])["source"] == "erased:1"
    assert must(w2, owner, "evidence", person["evidence"])["snippet"] == "erased:1"
    company = must(w2, owner, "companies", a.rows["companies"]["id"])
    assert company["name"] == a.rows["companies"]["name"] and company["erased_at"] is None, (
        "a company's identity is erased through the company scope"
    )
    assert snapshot(w2, b) == b_before, "the other workspace is byte-identical"
    assert must(w2, b.users["owner"], "contacts", b_person["contact"])["email"] == b_person["email"]


def test_a_company_erasure_is_chosen_separately_and_leaves_its_contacts_alone(w2: World) -> None:
    b = w2.b
    owner = b.users["owner"]
    company = b.rows["companies"]["id"]
    person = add_person(w2, b)
    rid = request(w2, owner, b, "company", company)
    done = api(w2, owner, "POST", b, f"/{rid}/execute", json={})
    assert done.status_code == 200, done.text
    c = must(w2, owner, "companies", company)
    assert c["name"] == "erased:1" and c["website"] is None and c["erased_at"] is not None
    assert must(w2, owner, "contacts", person["contact"])["email"] == person["email"], (
        "contacts are their own data principals"
    )
    # the erased company cannot be written back
    r = pg(
        w2.stack,
        owner,
        "PATCH",
        f"/companies?id=eq.{company}",
        json={"name": "Back"},
        representation=False,
    )
    assert r.status_code in (401, 403) and code_of(r) == "42501"


def test_the_erasure_schema_is_not_reachable(w: World) -> None:
    owner = w.a.users["owner"]
    r = pg(w.stack, owner, "GET", "/registry", representation=False)
    assert r.status_code in (404, 406), r.text
    r = httpx.get(
        f"{w.stack.rest}/registry",
        headers=w.stack.headers(owner.token, **{"Accept-Profile": "erasure"}),
        timeout=15,
    )
    assert r.status_code == 406 and r.json()["code"] == "PGRST106"
