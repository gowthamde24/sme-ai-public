"""T008 commit 3c, attacked straight through PostgREST: a re-run never replaces a person's work (SM211), and a run cannot add to a requirement
that stopped being its draft (SM209). The refusal is not an oracle (a Viewer or another tenant learns nothing). All text is synthetic."""

# ruff: noqa: E501, F811, S608

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from conftest import User
from crm_support import World
from evidence_support import pg
from test_agent_direct_postgrest import is_state, rpc
from test_requirement_direct_postgrest import BODY, capture, on, start, write  # noqa: F401


def _first_run(on: World, enquiry: str) -> tuple[str, dict[str, Any]]:
    """A requirement run that proposed a saree type; returns (run id, the write's answer)."""
    sales = on.a.users["sales"]
    r = start(on, sales, on.a, enquiry)
    assert r.status_code == 200, r.text
    run = str(r.json()["run_id"])
    k = BODY.index("kanjivaram")
    w = write(
        on, sales, run, "f1", 1, "saree_type", "kanjivaram", (k, k + 10), value_code="kanjivaram"
    )
    assert w.status_code == 200, w.text
    return run, w.json()


@pytest.fixture
def runs(on: World) -> Iterator[list[str]]:
    started: list[str] = []
    yield started
    for run in started:
        rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)


@pytest.mark.parametrize("decision", ["confirm", "correct", "reject", "manual"])
def test_every_kind_of_human_work_blocks_a_rerun_until_the_draft_is_discarded(
    on: World, runs: list[str], decision: str
) -> None:
    sales = on.a.users["sales"]
    eid = capture(on, on.a)
    if decision == "manual":
        added = rpc(
            on,
            sales,
            "add_requirement_field",
            p_enquiry_id=eid,
            p_line=1,
            p_key="saree_type",
            p_value_code="kanjivaram",
        )
        assert added.status_code == 200, added.text
        requirement = added.json()["requirement_id"]
    else:
        run, w = _first_run(on, eid)
        runs.append(run)
        extra: dict[str, Any] = {"p_value_code": "banarasi"} if decision == "correct" else {}
        d = rpc(
            on,
            sales,
            "decide_requirement_field",
            p_field_id=w["field_id"],
            p_decision=decision,
            **extra,
        )
        assert d.status_code == 200, d.text
        requirement = w["requirement_id"]
    refused = start(on, sales, on.a, eid)
    assert is_state(refused, "SM211"), refused.text
    assert refused.json().get("message") == "discard the current draft to re-run"
    # the refusal created no run
    assert pg(on.stack, sales, "GET", f"/agent_runs?enquiry_id=eq.{eid}&select=id").json() == (
        [{"id": runs[-1]}] if runs else []
    )
    discarded = rpc(on, sales, "discard_requirement", p_requirement_id=requirement)
    assert discarded.status_code == 200 and discarded.json()["status"] == "discarded", (
        discarded.text
    )
    again = start(on, sales, on.a, eid)
    assert again.status_code == 200, again.text
    runs.append(str(again.json()["run_id"]))


def test_a_run_started_before_a_decision_cannot_replace_the_draft_afterwards(
    on: World, runs: list[str]
) -> None:
    sales = on.a.users["sales"]
    eid = capture(on, on.a)
    run1, w = _first_run(on, eid)
    run2 = start(on, sales, on.a, eid)
    assert run2.status_code == 200, run2.text  # proposals only: a second run may start
    runs += [run1, str(run2.json()["run_id"])]
    assert (
        rpc(
            on, sales, "decide_requirement_field", p_field_id=w["field_id"], p_decision="confirm"
        ).status_code
        == 200
    )
    k = BODY.index("kanjivaram")
    late = write(
        on,
        sales,
        runs[-1],
        "f1",
        1,
        "saree_type",
        "kanjivaram",
        (k, k + 10),
        value_code="kanjivaram",
    )
    assert is_state(late, "SM211"), late.text
    reqs = pg(
        on.stack, sales, "GET", f"/requirements?enquiry_id=eq.{eid}&select=id,status,agent_run_id"
    ).json()
    assert reqs == [{"id": w["requirement_id"], "status": "draft", "agent_run_id": run1}]


def test_a_run_cannot_write_into_a_requirement_that_is_no_longer_its_draft(
    on: World, runs: list[str]
) -> None:
    sales = on.a.users["sales"]
    eid = capture(on, on.a)
    run1, w = _first_run(on, eid)
    runs.append(run1)
    assert (
        rpc(on, sales, "discard_requirement", p_requirement_id=w["requirement_id"]).status_code
        == 200
    )
    q = "Need  20 kanjivaram   sarees"
    s = BODY.index(q)
    late = write(
        on, sales, run1, "f2", 1, "quantity", q, (s, s + len(q)), value_int=20, basis="piece"
    )
    assert is_state(late, "SM209"), late.text
    assert pg(
        on.stack,
        sales,
        "GET",
        f"/requirement_fields?requirement_id=eq.{w['requirement_id']}&select=field_key",
    ).json() == [{"field_key": "saree_type"}]


def test_the_refusal_is_not_an_oracle_and_the_helper_is_not_exposed(
    on: World, runs: list[str]
) -> None:
    sales = on.a.users["sales"]
    with_work, without_work = capture(on, on.a), capture(on, on.a)
    run, w = _first_run(on, with_work)
    runs.append(run)
    assert (
        rpc(
            on, sales, "decide_requirement_field", p_field_id=w["field_id"], p_decision="confirm"
        ).status_code
        == 200
    )
    for outsider, tenant in ((on.a.users["viewer"], on.a), (on.b.users["owner"], on.a)):
        a = start(on, outsider, tenant, with_work)
        b = start(on, outsider, tenant, without_work)
        assert (a.status_code, a.json().get("code")) == (b.status_code, b.json().get("code")), (
            a.text,
            b.text,
        )
        assert a.json().get("code") != "SM211"
    anon = start(on, None, on.a, with_work)  # type: ignore[arg-type]
    assert anon.status_code in (401, 403) and anon.json().get("code") != "SM211"
    for user in (sales, None):
        helper = rpc(on, user, "requirement_human_work", p_tenant=on.a.id, p_enquiry=with_work)
        assert helper.status_code in (401, 403, 404), helper.text


def test_a_client_cannot_launder_a_decision_back_to_proposed(on: World, runs: list[str]) -> None:
    sales: User = on.a.users["sales"]
    eid = capture(on, on.a)
    run, w = _first_run(on, eid)
    runs.append(run)
    assert (
        rpc(
            on, sales, "decide_requirement_field", p_field_id=w["field_id"], p_decision="confirm"
        ).status_code
        == 200
    )
    patched = pg(
        on.stack,
        sales,
        "PATCH",
        f"/requirement_fields?id=eq.{w['field_id']}",
        json={"state": "proposed", "decided_by": None, "decided_at": None},
    )
    assert patched.status_code in (401, 403) or patched.json() in ([], None), patched.text
    state = pg(
        on.stack, sales, "GET", f"/requirement_fields?id=eq.{w['field_id']}&select=state"
    ).json()
    assert state == [{"state": "confirmed"}]
    assert is_state(start(on, sales, on.a, eid), "SM211")
