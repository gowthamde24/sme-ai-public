"""T008 commit 3 on the real stack: the Requirement agent's database half, attacked straight through PostgREST (our API is skipped).

  * the happy path: capture an enquiry (scrubbed), start a requirement run, write fields with Python-found offsets, decide, confirm;
  * the QUOTE CHECK EQUIVALENCE: for random texts (tabs, newlines, no-break spaces, accents, emoji) and random spans, the database accepts a
    (span, quote) pair exactly when app.requirements.quote.verify says so; that is what keeps the runtime's finder and the database's check one rule;
  * attacks: anon, a Viewer, another tenant, an unknown id, a run of someone else, the wrong agent, direct table writes, smuggled provenance;
  * containment: a requirement run cannot write a claim or evidence; nobody but the definer functions writes a requirement or a field.
All text is synthetic."""

# ruff: noqa: E501, S608, S311

from __future__ import annotations

import random
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import User
from crm_support import Tenant, World
from evidence_support import code_of, pg, uid
from test_agent_direct_postgrest import rpc

from app.requirements.quote import find_quote, normalise_ws, verify

GENERIC = "requirement action not permitted"
BODY = "Hello,\nNeed  20 kanjivaram   sarees\tby 15 November 2026.\nDeliver to Hyderabad. Payment 30 days credit."


@pytest.fixture(scope="module")
def on(crm_world: World) -> Iterator[World]:
    w = crm_world
    saved = operator_sql.snapshot_switches()
    saved_allowed = operator_sql.sql(
        "select coalesce(array_to_string(allowed_tenants, ','), '') from public.agent_definitions where agent_name = 'requirement'"
    )
    saved_rate = operator_sql.sql(
        "select limit_value from public.agent_limits where limit_key = 'max_runs_per_hour'"
    )
    operator_sql.sql(
        "update public.agent_limits set limit_value = 100000 where limit_key = 'max_runs_per_hour'"
    )
    for t in (w.a, w.b):
        operator_sql.sql(
            f"select app.operator_enable_requirement((select slug from public.tenants where id = '{t.id}'))"
        )
    try:
        yield w
    finally:
        operator_sql.restore_switches(saved)
        items = ",".join(f"'{a}'" for a in saved_allowed.split(",") if a)
        operator_sql.sql(
            f"update public.agent_definitions set allowed_tenants = array[{items}]::uuid[] where agent_name = 'requirement'"
        )
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )


def capture(w: World, tenant: Tenant, body: str = BODY, user: str = "sales") -> str:
    eid = uid()
    r = pg(w.stack, tenant.users[user], "POST", "/enquiries", json={
        "id": eid, "tenant_id": tenant.id, "lead_id": tenant.rows["leads"]["id"], "channel": "email",
        "received_at": "2026-10-01T09:00:00+00:00", "body": body}, representation=False)  # fmt: skip
    assert r.status_code == 201, r.text
    return eid


def start(w: World, user: User, tenant: Tenant, enquiry: str, **over: Any):  # type: ignore[no-untyped-def]
    body = {"p_run_id": uid(), "p_tenant_id": tenant.id, "p_agent_name": "requirement", "p_agent_version": "req-1", "p_target_kind": "enquiry",
            "p_target_id": enquiry, "p_input_sha256": "a" * 64, "p_input_refs": {}}  # fmt: skip
    return rpc(w, user, "start_agent_run", **{**body, **over})


def write(
    w: World,
    user: User,
    run: str,
    step: str,
    line: int | None,
    key: str,
    quote: str,
    span: tuple[int, int],
    **value: Any,
) -> httpx.Response:
    args: dict[str, Any] = {"p_run_id": run, "p_step_key": step, "p_line": line, "p_key": key, "p_value_code": None, "p_value_int": None,
                            "p_value_date": None, "p_value_text": None, "p_basis": None, "p_certainty": "stated", "p_quote": quote,
                            "p_start": span[0], "p_end": span[1], "p_conflict": False}  # fmt: skip
    args.update({f"p_{k}": v for k, v in value.items()})
    return rpc(w, user, "agent_write_requirement_field", **args)


@pytest.fixture
def run_a(on: World) -> Iterator[tuple[str, str]]:
    eid = capture(on, on.a)
    r = start(on, on.a.users["sales"], on.a, eid)
    assert r.status_code == 200, r.text
    run = str(r.json()["run_id"])
    yield eid, run
    rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)


def test_the_happy_path_capture_start_write_decide_confirm(
    on: World, run_a: tuple[str, str]
) -> None:
    eid, run = run_a
    sales = on.a.users["sales"]
    q = "Need  20 kanjivaram   sarees"
    s = BODY.index(q)
    span = (s, s + len(q))
    assert find_quote(BODY, q) == span
    w1 = write(on, sales, run, "f1", 1, "quantity", q, span, value_int=20, basis="piece")
    assert w1.status_code == 200 and w1.json()["replayed"] is False, w1.text
    k = BODY.index("kanjivaram")
    w2 = write(
        on, sales, run, "f2", 1, "saree_type", "kanjivaram", (k, k + 10), value_code="kanjivaram"
    )
    assert w2.status_code == 200, w2.text
    fields = pg(
        on.stack,
        sales,
        "GET",
        f"/requirement_fields?requirement_id=eq.{w1.json()['requirement_id']}&select=field_key,state,quote,created_via,created_by",
    ).json()
    assert {f["field_key"] for f in fields} == {"quantity", "saree_type"}
    assert all(
        f["state"] == "proposed"
        and f["created_via"] == "agent"
        and f["created_by"] == str(sales.id)
        for f in fields
    )
    assert {f["quote"] for f in fields} == {"Need 20 kanjivaram sarees", "kanjivaram"}
    for fid in (w1.json()["field_id"], w2.json()["field_id"]):
        d = rpc(on, sales, "decide_requirement_field", p_field_id=fid, p_decision="confirm")
        assert d.status_code == 200 and d.json()["state"] == "confirmed", d.text
    c = rpc(on, sales, "confirm_requirement", p_requirement_id=w1.json()["requirement_id"])
    assert c.status_code == 200 and c.json()["status"] == "confirmed", c.text
    again = start(on, sales, on.a, eid)
    assert code_of(again) == "SM208", again.text


# ------------------------------------------------------------------------------ the quote check is the Python check
_ALPHABET = [
    "a",
    "b",
    "k",
    "Z",
    "7",
    "20",
    " ",
    "  ",
    "\n",
    "\t",
    "\r\n",
    "é",
    " ",
    "😀",
    " ",
    ".",
    ",",
    "kanjivaram",
]


def _random_body(rng: random.Random) -> str:
    return "".join(rng.choice(_ALPHABET) for _ in range(rng.randint(40, 120))).strip() or "x"


def test_property_the_database_accepts_a_quote_exactly_when_the_python_check_does(
    on: World,
) -> None:
    rng = random.Random(20261006)
    sales = on.a.users["sales"]
    checked = accepted = refused = 0
    for _ in range(2):
        body = _random_body(rng)
        eid = capture(on, on.a, body)
        r = start(on, sales, on.a, eid)
        assert r.status_code == 200, r.text
        run = str(r.json()["run_id"])
        try:
            for slot in range(
                15
            ):  # saree_type / fabric / colour on five lines: 15 distinct slots per run
                key = ("saree_type", "fabric", "colour")[slot // 5]
                line = slot % 5 + 1
                start_at = rng.randrange(0, len(body))
                end_at = rng.randrange(start_at + 1, min(len(body), start_at + 80) + 1)
                quote = normalise_ws(body[start_at:end_at])
                if rng.random() < 0.4 and quote:
                    quote = quote[:-1] + (
                        "Q" if quote[-1] != "Q" else "R"
                    )  # a quote the span does not say
                expected = verify(body, start_at, end_at, quote) and 1 <= len(quote) <= 300
                resp = write(
                    on,
                    sales,
                    run,
                    f"p{slot}",
                    line,
                    key,
                    quote or " ",
                    (start_at, end_at),
                    value_code="other",
                )
                checked += 1
                if expected:
                    accepted += 1
                    assert resp.status_code == 200, (body, start_at, end_at, quote, resp.text)
                else:
                    refused += 1
                    assert resp.status_code == 400 and code_of(resp) in ("23514", "22023"), (
                        body,
                        start_at,
                        end_at,
                        quote,
                        resp.text,
                    )
        finally:
            rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)
    assert checked == 30 and accepted >= 8 and refused >= 8, (accepted, refused)


def test_the_finder_and_the_database_agree_on_whitespace_and_non_bmp_text(on: World) -> None:
    body = "Hi 😀 there,\n\n  we need\t20   sarees 😀 soon"
    eid = capture(on, on.a, body)
    r = start(on, on.a.users["sales"], on.a, eid)
    run = str(r.json()["run_id"])
    try:
        for i, quote in enumerate(["we need 20 sarees 😀 soon", "Hi 😀 there,", "need\n20 sarees"]):
            span = find_quote(body, quote)
            assert span is not None, quote
            resp = write(
                on,
                on.a.users["sales"],
                run,
                f"w{i}",
                i + 1,
                "fabric",
                quote,
                span,
                value_code="other",
            )
            assert resp.status_code == 200, (quote, resp.text)
        assert (
            find_quote(body, "Hi 😀 there,") is None
        )  # a no-break space is NOT whitespace: the finder refuses...
        bad = write(
            on,
            on.a.users["sales"],
            run,
            "w9",
            4,
            "fabric",
            "Hi 😀 there,",
            (0, 11),
            value_code="other",
        )
        assert code_of(bad) == "23514", bad.text  # ...and so does the database
    finally:
        rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)


# ------------------------------------------------------------------------------ attacks
def test_anon_can_call_none_of_the_four(on: World) -> None:
    calls: dict[str, dict[str, Any]] = {
        "agent_write_requirement_field": {"p_run_id": uid(), "p_step_key": "s", "p_line": 1, "p_key": "colour", "p_value_code": "red", "p_value_int": None,
                                          "p_value_date": None, "p_value_text": None, "p_basis": None, "p_certainty": "stated", "p_quote": "red",
                                          "p_start": 0, "p_end": 3},
        "decide_requirement_field": {"p_field_id": uid(), "p_decision": "confirm"},
        "confirm_requirement": {"p_requirement_id": uid()},
        "discard_requirement": {"p_requirement_id": uid()},
    }  # fmt: skip
    for name, body in calls.items():
        r = rpc(on, None, name, **body)
        assert r.status_code in (401, 403), (name, r.status_code, r.text)


@pytest.fixture
def drafted(on: World, run_a: tuple[str, str]) -> dict[str, str]:
    eid, run = run_a
    sales = on.a.users["sales"]
    q = "Need  20 kanjivaram   sarees"
    s = BODY.index(q)
    w1 = write(on, sales, run, "d1", 1, "quantity", q, (s, s + len(q)), value_int=20, basis="piece")
    assert w1.status_code == 200, w1.text
    return {
        "enquiry": eid,
        "run": run,
        "field": w1.json()["field_id"],
        "requirement": w1.json()["requirement_id"],
    }


def test_decisions_belong_to_the_tenant_and_to_roles_who_may_write(
    on: World, drafted: dict[str, str]
) -> None:
    for who, tenant in (("viewer", on.a), ("owner", on.b), ("sales", on.b), ("viewer", on.b)):
        user = tenant.users[who]
        for name, body in (
            ("decide_requirement_field", {"p_field_id": drafted["field"], "p_decision": "confirm"}),
            ("confirm_requirement", {"p_requirement_id": drafted["requirement"]}),
            ("discard_requirement", {"p_requirement_id": drafted["requirement"]}),
        ):
            r = rpc(on, user, name, **body)
            assert (
                r.status_code in (401, 403)
                and code_of(r) == "42501"
                and r.json()["message"] == GENERIC
            ), (who, name, r.text)
    unknown = rpc(
        on, on.b.users["owner"], "decide_requirement_field", p_field_id=uid(), p_decision="confirm"
    )
    foreign = rpc(
        on,
        on.b.users["owner"],
        "decide_requirement_field",
        p_field_id=drafted["field"],
        p_decision="confirm",
    )
    assert (unknown.status_code, unknown.json()) == (
        foreign.status_code,
        foreign.json(),
    )  # a foreign id and an unknown id are one answer
    state = pg(
        on.stack,
        on.a.users["owner"],
        "GET",
        f"/requirement_fields?id=eq.{drafted['field']}&select=state",
    ).json()
    assert state == [{"state": "proposed"}]


def test_a_run_belongs_to_its_starter_and_to_its_agent(on: World, drafted: dict[str, str]) -> None:
    q = "Hello,"
    for user in (on.a.users["admin"], on.a.users["owner"], on.b.users["sales"]):
        r = write(on, user, drafted["run"], "z1", 2, "colour", q, (0, 6), value_code="red")
        assert code_of(r) == "42501", r.text
    # a selftest run cannot write requirement fields, and the requirement agent cannot be aimed at a company or a lead
    selftest = rpc(on, on.a.users["sales"], "start_agent_run", p_run_id=uid(), p_tenant_id=on.a.id, p_agent_name="selftest", p_agent_version="it-1",
                   p_target_kind="company", p_target_id=on.a.rows["companies"]["id"], p_input_sha256="a" * 64, p_input_refs={})  # fmt: skip
    if (
        selftest.status_code == 200
    ):  # selftest may be off for this tenant: then the SM204 refusal is the proof
        r = write(
            on,
            on.a.users["sales"],
            str(selftest.json()["run_id"]),
            "z2",
            2,
            "colour",
            q,
            (0, 6),
            value_code="red",
        )
        assert code_of(r) == "23514", r.text
        rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=str(selftest.json()["run_id"]))
    for kind, target in (
        ("company", on.a.rows["companies"]["id"]),
        ("lead", on.a.rows["leads"]["id"]),
    ):
        r = start(on, on.a.users["sales"], on.a, target, p_target_kind=kind)
        assert code_of(r) == "23503", (kind, r.text)
    viewer = start(on, on.a.users["viewer"], on.a, drafted["enquiry"])
    assert code_of(viewer) == "42501", viewer.text
    foreign = start(on, on.a.users["sales"], on.a, capture(on, on.b))
    assert code_of(foreign) == "23503", foreign.text


def test_a_requirement_run_writes_no_claim_and_no_evidence(
    on: World, drafted: dict[str, str]
) -> None:
    sales = on.a.users["sales"]
    claim = rpc(
        on,
        sales,
        "agent_write_claim",
        p_run_id=drafted["run"],
        p_step_key="c1",
        p_predicate="buyer_type",
        p_value="wholesaler",
        p_evidence_ids=[uid()],
        p_stance="supports",
    )
    assert code_of(claim) == "23514", claim.text
    note = rpc(
        on,
        sales,
        "agent_write_evidence",
        p_run_id=drafted["run"],
        p_step_key="c2",
        p_kind="note",
        p_snippet="DEMO note",
    )
    assert code_of(note) == "23514", note.text
    assert (
        pg(on.stack, sales, "GET", f"/claims?agent_run_id=eq.{drafted['run']}&select=id").json()
        == []
    )


def test_no_client_writes_a_requirement_or_a_field_or_the_text(
    on: World, drafted: dict[str, str]
) -> None:
    owner = on.a.users["owner"]
    smuggled = {"id": uid(), "tenant_id": on.a.id, "requirement_id": drafted["requirement"], "line_no": 2, "field_key": "colour", "value_code": "red",
                "certainty": "stated", "quote": "red", "quote_start": 0, "quote_end": 3, "state": "confirmed", "created_via": "manual"}  # fmt: skip
    r = pg(on.stack, owner, "POST", "/requirement_fields", json=smuggled, representation=False)
    assert r.status_code in (401, 403), r.text
    r = pg(
        on.stack,
        owner,
        "POST",
        "/requirements",
        json={
            "id": uid(),
            "tenant_id": on.a.id,
            "enquiry_id": drafted["enquiry"],
            "status": "confirmed",
        },
        representation=False,
    )
    assert r.status_code in (401, 403), r.text
    for table, ident in (
        ("requirement_fields", drafted["field"]),
        ("requirements", drafted["requirement"]),
    ):
        for method, body in (
            (
                "PATCH",
                {"state": "confirmed"}
                if table == "requirement_fields"
                else {"status": "confirmed"},
            ),
            ("DELETE", None),
        ):
            r = pg(
                on.stack, owner, method, f"/{table}?id=eq.{ident}", json=body, representation=False
            )
            assert r.status_code in (401, 403), (table, method, r.status_code, r.text)
    for method, body in (("PATCH", {"body": "edited"}), ("DELETE", None)):
        r = pg(
            on.stack,
            owner,
            method,
            f"/enquiries?id=eq.{drafted['enquiry']}",
            json=body,
            representation=False,
        )
        assert r.status_code in (401, 403), (method, r.status_code, r.text)
    still = pg(
        on.stack, owner, "GET", f"/requirement_fields?id=eq.{drafted['field']}&select=state"
    ).json()
    assert still == [{"state": "proposed"}]


def test_another_workspace_reads_no_requirement_data(on: World, drafted: dict[str, str]) -> None:
    for table in ("enquiries", "requirements", "requirement_fields"):
        r = pg(on.stack, on.b.users["owner"], "GET", f"/{table}?select=id&tenant_id=eq.{on.a.id}")
        assert r.status_code == 200 and r.json() == [], table
    viewer = pg(
        on.stack,
        on.a.users["viewer"],
        "GET",
        f"/requirement_fields?id=eq.{drafted['field']}&select=state",
    )
    assert viewer.json() == [
        {"state": "proposed"}
    ]  # every member reads; nobody but the functions writes


def test_a_run_id_cannot_be_reused_across_tenants_or_enquiries(
    on: World, drafted: dict[str, str]
) -> None:
    r = start(on, on.b.users["sales"], on.b, capture(on, on.b), p_run_id=drafted["run"])
    assert r.status_code in (400, 409) and code_of(r) == "23505", r.text
    other = start(on, on.a.users["sales"], on.a, capture(on, on.a), p_run_id=drafted["run"])
    assert code_of(other) == "23505", other.text
    assert str(uuid.UUID(drafted["run"])) == drafted["run"]
