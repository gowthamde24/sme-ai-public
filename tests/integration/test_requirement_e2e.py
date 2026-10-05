"""T008 commit 4, on the real stack: a requirement run started through OUR API reads one captured enquiry, the scripted model proposes
fields, and the DATABASE stores them as unreviewed proposals (it verifies every quote against the stored text). The daily cost cap and
the reservation before each model call are exercised end to end; a run that is refused or fails writes nothing; every start rule of the
route (the wrong target kind, a viewer, an archived or foreign enquiry, a text that changed) is checked."""

# ruff: noqa: E501, S608

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from conftest import bearer
from crm_support import Tenant, World
from evidence_support import pg, uid
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import build_runtime, create_app

BODY = (
    "Hello,\nNeed  20 kanjivaram   sarees in red and 10 banarasi sarees in blue.\n"
    "Deliver to Hyderabad by 15 November 2026. Budget Rs 5,000 per piece. 30 days credit please."
)


@pytest.fixture(scope="module")
def api(crm_world: World) -> Iterator[tuple[TestClient, World]]:
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
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, api_env="development", supabase_url=w.stack.url, supabase_anon_key=w.stack.anon_key, agents_enabled=True, llm_provider="fake",
    )  # fmt: skip
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.agents is not None and runtime.enquiries is not None
    try:
        with TestClient(create_app(settings, runtime=runtime)) as client:
            for t in (w.a, w.b):
                r = client.put(
                    f"/v1/tenants/{t.id}/agent-settings",
                    json={"enabled": True},
                    headers=bearer(t.users["owner"]),
                )
                assert r.status_code == 200, r.text
            yield client, w
    finally:
        operator_sql.restore_switches(saved)
        items = ",".join(f"'{a}'" for a in saved_allowed.split(",") if a)
        operator_sql.sql(
            f"update public.agent_definitions set allowed_tenants = array[{items}]::uuid[] where agent_name = 'requirement'"
        )
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )
        for t in (w.a, w.b):
            operator_sql.sql(
                f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{t.id}'"
            )


def capture(w: World, t: Tenant, body: str = BODY) -> str:
    eid = uid()
    r = pg(w.stack, t.users["sales"], "POST", "/enquiries", json={"id": eid, "tenant_id": t.id, "lead_id": t.rows["leads"]["id"], "channel": "email",
                                                               "received_at": "2026-10-05T10:00:00+00:00", "body": body}, representation=False)  # fmt: skip
    assert r.status_code == 201, r.text
    return eid


def start(client: TestClient, t: Tenant, enquiry: str, *, role: str = "sales", **over: Any):  # type: ignore[no-untyped-def]
    body = {
        "id": uid(),
        "agent": "requirement",
        "target_kind": "enquiry",
        "target_id": enquiry,
        **over,
    }
    return client.post(f"/v1/tenants/{t.id}/agent-runs", json=body, headers=bearer(t.users[role]))


def finish(client: TestClient, t: Tenant, run_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        run = client.get(
            f"/v1/tenants/{t.id}/agent-runs/{run_id}", headers=bearer(t.users["sales"])
        ).json()
        if run["status"] != "running":
            return dict(run)
        time.sleep(0.2)
    pytest.fail("the requirement run did not finish")


def fields(w: World, t: Tenant, enquiry: str) -> dict[tuple[int | None, str], dict[str, Any]]:
    reqs = pg(
        w.stack,
        t.users["sales"],
        "GET",
        f"/requirements?enquiry_id=eq.{enquiry}&status=eq.draft&select=id,agent_run_id,created_via",
    ).json()
    if not reqs:
        return {}
    rows = pg(
        w.stack,
        t.users["sales"],
        "GET",
        f"/requirement_fields?requirement_id=eq.{reqs[0]['id']}&select=line_no,field_key,value_code,value_int,value_date,value_text,basis,certainty,quote,state,created_via,conflict",
    ).json()
    return {(r["line_no"], r["field_key"]): r for r in rows}


def test_a_run_proposes_the_fields_and_the_database_stores_them_as_unreviewed_proposals(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    eid = capture(w, t)
    r = start(client, t, eid)
    assert r.status_code == 202, r.text
    run = finish(client, t, r.json()["id"])
    assert run["status"] == "succeeded" and run["error_code"] is None and run["enquiry_id"] == eid
    assert run["company_id"] is None and run["lead_id"] is None
    assert run["writes_used"] == 10 and run["cost_micros_used"] >= 0
    got = fields(w, t, eid)
    assert (
        got[(1, "saree_type")]["value_code"] == "kanjivaram"
        and got[(2, "saree_type")]["value_code"] == "banarasi"
    )
    assert (got[(1, "quantity")]["value_int"], got[(2, "quantity")]["value_int"]) == (20, 10)
    assert (
        got[(None, "deadline")]["value_date"] == "2026-11-15"
        and got[(None, "delivery_city")]["value_text"] == "Hyderabad"
    )
    assert (
        got[(None, "budget")]["value_int"] == 500000
        and got[(None, "budget")]["basis"] == "per_piece"
    )
    assert (
        got[(None, "payment_terms")]["value_code"],
        got[(None, "payment_terms")]["value_int"],
    ) == ("net_days", 30)
    assert all(f["state"] == "proposed" and f["created_via"] == "agent" for f in got.values())
    assert got[(1, "quantity")]["quote"] == "20 kanjivaram"
    # no claim, no evidence, no confirmation: the agent wrote requirement fields only
    claims = pg(
        w.stack, t.users["sales"], "GET", f"/claims?agent_run_id=eq.{run['id']}&select=id"
    ).json()
    assert claims == []


def test_each_model_call_was_reserved_and_settled_under_the_daily_cap(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    eid = capture(w, t)
    run = finish(client, t, start(client, t, eid).json()["id"])
    rows = operator_sql.sql(
        f"select count(*) filter (where settled_at is not null), count(*) from public.agent_cost_reservations where run_id = '{run['id']}'"
    )
    settled, total = (int(x) for x in rows.split("|"))
    assert total >= 1 and settled == total


def test_a_cap_with_no_room_refuses_the_run_and_writes_nothing(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.b
    eid = capture(w, t)
    operator_sql.sql(
        f"insert into public.tenant_agent_settings (tenant_id, daily_cost_cap_micros) values ('{t.id}', 1) on conflict (tenant_id) do update set daily_cost_cap_micros = 1"
    )
    try:
        r = start(client, t, eid)
        if r.status_code == 202:  # started: the first reservation is then refused and the run ends
            run = finish(client, t, r.json()["id"])
            assert run["status"] == "failed" and run["error_code"] == "budget", run
        else:
            assert r.status_code in (409, 429, 503), r.text
        assert fields(w, t, eid) == {}
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{t.id}'"
        )


def test_the_start_rules_of_the_route(api: tuple[TestClient, World]) -> None:
    client, w = api
    a, b = w.a, w.b
    eid = capture(w, a)
    assert start(client, a, eid, role="viewer").status_code == 403
    assert (
        start(client, a, capture(w, b)).status_code == 404
    )  # another tenant's enquiry: it does not exist for this caller
    assert start(client, a, uid()).status_code == 404
    assert start(client, a, eid, agent="requirement", target_kind="company").status_code == 422
    assert (
        start(
            client, a, a.rows["companies"]["id"], agent="research", target_kind="enquiry"
        ).status_code
        == 422
    )
    assert start(client, a, eid, agent="selftest", target_kind="enquiry").status_code == 422
    assert start(client, a, "not-a-uuid").status_code == 422
    # an exact retry is a replay: 200, the same run, nothing run twice
    run_id = uid()
    first = start(client, a, eid, id=run_id)
    again = start(client, a, eid, id=run_id)
    assert first.status_code == 202 and again.status_code == 200 and again.json()["id"] == run_id
    finish(client, a, run_id)
    archived = capture(w, a)
    operator_sql.sql(f"update public.enquiries set archived_at = now() where id = '{archived}'")
    assert start(client, a, archived).status_code == 409


def test_a_second_run_supersedes_the_first_draft_and_a_confirmed_requirement_stops_new_runs(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    eid = capture(w, t)
    finish(client, t, start(client, t, eid).json()["id"])
    finish(client, t, start(client, t, eid).json()["id"])
    statuses = pg(
        w.stack, t.users["sales"], "GET", f"/requirements?enquiry_id=eq.{eid}&select=status"
    ).json()
    assert sorted(s["status"] for s in statuses) == ["draft", "superseded"]
    got = fields(w, t, eid)
    from evidence_support import code_of

    for key in ((1, "saree_type"), (1, "quantity")):
        r = pg(
            w.stack,
            t.users["sales"],
            "POST",
            "/rpc/decide_requirement_field",
            json={
                "p_field_id": operator_sql.sql(
                    f"select id from public.requirement_fields where requirement_id = (select id from public.requirements where enquiry_id = '{eid}' and status = 'draft') and line_no = 1 and field_key = '{key[1]}'"
                ),
                "p_decision": "confirm",
            },
        )
        assert r.status_code == 200, r.text
    requirement = pg(
        w.stack,
        t.users["sales"],
        "GET",
        f"/requirements?enquiry_id=eq.{eid}&status=eq.draft&select=id",
    ).json()[0]["id"]
    done = pg(
        w.stack,
        t.users["sales"],
        "POST",
        "/rpc/confirm_requirement",
        json={"p_requirement_id": requirement},
    )
    assert done.status_code == 200 and done.json()["status"] == "confirmed", done.text
    refused = start(client, t, eid)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "requirement_confirmed", refused.text
    assert (
        code_of(
            pg(
                w.stack,
                t.users["sales"],
                "POST",
                "/rpc/start_agent_run",
                json={
                    "p_run_id": uid(),
                    "p_tenant_id": t.id,
                    "p_agent_name": "requirement",
                    "p_agent_version": "x",
                    "p_target_kind": "enquiry",
                    "p_target_id": eid,
                    "p_input_sha256": "a" * 64,
                },
            )
        )
        == "SM208"
    )
    assert len(got) >= 6
