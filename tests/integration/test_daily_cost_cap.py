"""The per-tenant DAILY COST CAP against the REAL local stack (T007 M2 / 3, ADR 0013 "Daily cost cap").

pgTAP (supabase/tests/database/49_daily_cost_cap.test.sql) proves every rule inside ONE transaction. What a single
transaction cannot show is the race, so this module runs two REAL database sessions at once (two `psql` processes in the
local database container, each acting as a different signed-in user the way PostgREST would) and checks that exactly
one of two concurrent reservations fits into the last headroom of a tenant's day. Each session HOLDS its transaction
open for a moment after it reserved (`hold_seconds`), so the window between "read today's spend" and "commit" is wide:
without the per-tenant lock both sessions read the same spend and both are granted; with it the second waits for the
first to commit and is refused. Mutation check: remove the lock (app.agent_cost_lock) and this test fails.

It also attacks the new surface directly over PostgREST, as real signed-in users: the clock helper and the other
internals are unreachable, the ledger is read-only and only for Owner / Admin of the tenant, the cap can be set only by
the tenant's Owner with a second factor and never above the ceiling, and a cap hit is audited.

The agent switches are OFF by default and only the operator can turn them on, so this module turns them on for its own
two tenants and restores the previous state afterwards."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import dataclasses
import json
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import User, aal1_token
from crm_support import Tenant, World
from evidence_support import code_of, pg, uid

ITERATIONS = 3
GENERIC = "agent action not permitted"
MFA = "a second factor is required for this action"


# ------------------------------------------------------------------------------ plumbing
def rpc(w: World, user: User | None, name: str, **body: Any) -> httpx.Response:
    return pg(w.stack, user, "POST", f"/rpc/{name}", json=body)


def start(w: World, user: User, tenant: Tenant) -> str:
    r = rpc(
        w,
        user,
        "start_agent_run",
        p_run_id=uid(),
        p_tenant_id=tenant.id,
        p_agent_name="selftest",
        p_agent_version="it-cap",
        p_target_kind="company",
        p_target_id=tenant.rows["companies"]["id"],
        p_input_sha256="a" * 64,
        p_input_refs={},
    )
    assert r.status_code == 200, (r.status_code, r.text)
    return str(r.json()["run_id"])


def reserve(
    w: World,
    user: User,
    run: str,
    key: str,
    tokens_in: int,
    tokens_out: int = 0,
    model: str = "fake-selftest",
) -> httpx.Response:
    return rpc(
        w,
        user,
        "agent_reserve_cost",
        p_run_id=run,
        p_step_key=key,
        p_model=model,
        p_max_input_tokens=tokens_in,
        p_max_output_tokens=tokens_out,
    )


def spent(tenant: Tenant) -> int:
    """What the tenant's agents have spent or reserved today (India time), read as the operator."""
    return int(
        operator_sql.sql(f"select app.agent_day_spend('{tenant.id}', app.agent_utc_today())")
    )


def set_cap(tenant: Tenant, cap: int | None) -> None:
    value = "null" if cap is None else str(cap)
    operator_sql.sql(
        f"insert into public.tenant_agent_settings (tenant_id, daily_cost_cap_micros) values ('{tenant.id}', {value}) "
        f"on conflict (tenant_id) do update set daily_cost_cap_micros = excluded.daily_cost_cap_micros"
    )


def cancel(w: World, tenant: Tenant, run: str) -> None:
    rpc(w, tenant.users["owner"], "cancel_agent_run", p_run_id=run)


@pytest.fixture(scope="module")
def on(crm_world: World) -> Iterator[World]:
    w = crm_world
    saved = operator_sql.snapshot_switches()
    saved_rate = operator_sql.sql(
        "select limit_value from public.agent_limits where limit_key = 'max_runs_per_hour'"
    )
    operator_sql.sql(
        "update public.agent_limits set limit_value = 100000 where limit_key = 'max_runs_per_hour'"
    )
    tenants = ",".join(f"'{t.id}'" for t in (w.a, w.b))
    operator_sql.sql(
        "update public.platform_flags set enabled = true; "
        f"update public.agent_definitions set allowed_tenants = coalesce(allowed_tenants, '{{}}') || array[{tenants}]::uuid[] "
        "where agent_name = 'selftest'"
    )
    for t in (w.a, w.b):
        r = rpc(w, t.users["owner"], "set_tenant_agents_enabled", p_tenant_id=t.id, p_enabled=True)
        assert r.status_code == 200, r.text
    try:
        yield w
    finally:
        for t in (w.a, w.b):
            set_cap(t, None)
        operator_sql.restore_switches(saved)
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )


@pytest.fixture
def run_a(on: World) -> Iterator[str]:
    run = start(on, on.a.users["sales"], on.a)
    yield run
    cancel(on, on.a, run)


# ------------------------------------------------------------------------------ the race
def reserve_in_session(user: User, run: str, key: str, tokens: int) -> dict[str, Any]:
    """One real database session: reserve `tokens` micros (the fake model costs one micro per token) as `user`, then HOLD
    the transaction open before it commits."""
    out_code, out, err = operator_sql.sql_result(
        operator_sql.as_user(
            str(user.id),
            f"select public.agent_reserve_cost('{run}', '{key}', 'fake-selftest', {tokens}, 0);",
            hold_seconds=2,
        ),
        timeout=90,
    )
    assert out_code == 0, err
    for line in out.splitlines():
        if '"granted"' in line:
            parsed: dict[str, Any] = json.loads(line)
            return parsed
    pytest.fail(f"no reservation result in: {out!r} {err!r}")


@pytest.mark.parametrize("iteration", range(ITERATIONS))
def test_two_concurrent_reservations_cannot_both_fit_into_the_last_headroom(
    on: World, iteration: int
) -> None:
    """Two runs of ONE tenant, started by two different users, each reserve 700 against 1,000 of headroom, at the same
    moment (a barrier lines the two sessions up; each holds its transaction open for two seconds after reserving).
    Exactly one fits."""
    w = on
    sales, admin = w.a.users["sales"], w.a.users["admin"]
    run1, run2 = start(w, sales, w.a), start(w, admin, w.a)
    try:
        cap = spent(w.a) + 1000
        set_cap(w.a, cap)
        key = f"race-{iteration}-{uid()[:8]}"
        barrier = threading.Barrier(2)

        def go(user: User, run: str) -> dict[str, Any]:
            barrier.wait(timeout=15)
            return reserve_in_session(user, run, key, 700)

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(go, sales, run1), pool.submit(go, admin, run2)]
            results = [f.result(timeout=120) for f in futures]
        assert sorted(r["granted"] for r in results) == [False, True], results
        rows = operator_sql.sql(
            f"select count(*) from public.agent_cost_reservations where tenant_id = '{w.a.id}' and step_key = '{key}'"
        )
        assert rows == "1", "exactly one reservation was stored"
        assert spent(w.a) <= cap, "the day never exceeds its cap"
        refused = [r for r in results if not r["granted"]]
        assert refused[0]["reason"] == "daily_cap"
    finally:
        cancel(w, w.a, run1)
        cancel(w, w.a, run2)
        set_cap(w.a, None)


def test_a_cap_filled_by_another_tenant_is_not_ours(on: World) -> None:
    """The same race across TWO tenants: each has its own day and its own lock, so both are granted."""
    w = on
    run_a, run_b = start(w, w.a.users["sales"], w.a), start(w, w.b.users["sales"], w.b)
    try:
        set_cap(w.a, spent(w.a) + 700)
        set_cap(w.b, spent(w.b) + 700)
        key = f"iso-{uid()[:8]}"
        barrier = threading.Barrier(2)

        def go(user: User, run: str) -> dict[str, Any]:
            barrier.wait(timeout=15)
            return reserve_in_session(user, run, key, 700)

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(go, w.a.users["sales"], run_a),
                pool.submit(go, w.b.users["sales"], run_b),
            ]
            results = [f.result(timeout=120) for f in futures]
        assert [r["granted"] for r in results] == [True, True], results
    finally:
        cancel(w, w.a, run_a)
        cancel(w, w.b, run_b)
        set_cap(w.a, None)
        set_cap(w.b, None)


# ------------------------------------------------------------------------------ the new surface, attacked directly
@pytest.mark.parametrize(
    "name",
    [
        "agent_utc_today",
        "agent_cost_day",
        "agent_cost_micros",
        "agent_daily_cap",
        "agent_day_spend",
        "agent_cost_lock",
    ],
)
def test_the_internal_helpers_including_the_clock_are_not_reachable_by_any_caller(
    on: World, name: str
) -> None:
    for user in (None, on.a.users["owner"], on.a.users["sales"], on.b.users["owner"]):
        r = rpc(on, user, name)
        assert r.status_code == 404, (name, user and user.label, r.status_code, r.text)


def test_a_cap_hit_and_an_unknown_model_are_refusals_that_are_returned_and_audited(
    on: World, run_a: str
) -> None:
    w, sales, owner = on, on.a.users["sales"], on.a.users["owner"]
    set_cap(w.a, spent(w.a) + 100)
    ok = reserve(w, sales, run_a, "audit-1", 100)
    assert ok.status_code == 200 and ok.json()["granted"] is True, ok.text
    over = reserve(w, sales, run_a, "audit-2", 1)
    assert over.status_code == 200 and over.json() == {"granted": False, "reason": "daily_cap"}, (
        over.text
    )
    nomodel = reserve(w, sales, run_a, "audit-3", 1, model="no-such-model")
    assert nomodel.json() == {"granted": False, "reason": "no_price"}, nomodel.text
    # the audit rows were KEPT (the refusals were returned, not raised): the Owner reads them
    events = pg(
        w.stack,
        owner,
        "GET",
        f"/audit_events?tenant_id=eq.{w.a.id}&entity_id=eq.{run_a}&action=eq.agent_cost.refused&select=new_values,actor_user_id",
    ).json()
    assert sorted(e["new_values"]["reason"] for e in events) == ["daily_cap", "no_price"], events
    assert {e["actor_user_id"] for e in events} == {str(sales.id)}
    set_cap(w.a, None)


def test_a_member_cannot_reserve_on_a_run_they_did_not_start_or_that_belongs_to_another_tenant(
    on: World, run_a: str
) -> None:
    for user in (
        on.a.users["admin"],
        on.a.users["viewer"],
        on.b.users["sales"],
        on.b.users["owner"],
    ):
        r = reserve(on, user, run_a, "steer-1", 1)
        assert (
            r.status_code in (401, 403) and code_of(r) == "42501" and r.json()["message"] == GENERIC
        ), (user.label, r.text)
    assert (
        operator_sql.sql(
            f"select count(*) from public.agent_cost_reservations where run_id = '{run_a}'"
        )
        == "0"
    )


def test_the_ledger_is_read_only_and_only_for_owner_and_admin_of_the_tenant(
    on: World, run_a: str
) -> None:
    w = on
    set_cap(w.a, spent(w.a) + 50)
    assert reserve(w, w.a.users["sales"], run_a, "led-1", 50).json()["granted"] is True
    own = pg(
        w.stack,
        w.a.users["owner"],
        "GET",
        "/agent_cost_reservations?select=tenant_id,run_id,reserved_micros,cost_day",
    )
    assert own.status_code == 200 and own.json(), own.text
    assert {r["tenant_id"] for r in own.json()} == {w.a.id}
    assert run_a in {r["run_id"] for r in own.json()}
    assert pg(w.stack, w.a.users["admin"], "GET", "/agent_cost_reservations?select=id").json()
    for role in ("sales", "viewer"):
        assert (
            pg(w.stack, w.a.users[role], "GET", "/agent_cost_reservations?select=id").json() == []
        ), role
    other = pg(
        w.stack, w.b.users["owner"], "GET", f"/agent_cost_reservations?run_id=eq.{run_a}&select=id"
    )
    assert other.json() == [], "another tenant's Owner sees nothing of ours"
    for user in (w.a.users["owner"], w.a.users["admin"], w.a.users["sales"]):
        for method, path, body in (
            (
                "POST",
                "/agent_cost_reservations",
                {
                    "tenant_id": w.a.id,
                    "run_id": run_a,
                    "step_key": "x",
                    "cost_day": "2030-01-01",
                    "max_input_tokens": 0,
                    "max_output_tokens": 0,
                    "reserved_micros": 0,
                    "args_sha256": "0" * 64,
                },
            ),
            ("PATCH", f"/agent_cost_reservations?run_id=eq.{run_a}", {"reserved_micros": 0}),
            ("DELETE", f"/agent_cost_reservations?run_id=eq.{run_a}", None),
        ):
            r = pg(w.stack, user, method, path, json=body, representation=False)
            assert r.status_code == 403 and code_of(r) == "42501", (
                user.label,
                method,
                r.status_code,
            )
    assert pg(
        w.stack, None, "GET", "/agent_cost_reservations?select=id", representation=False
    ).status_code in (401, 403)
    set_cap(w.a, None)


def test_the_price_table_is_invisible_and_immutable_to_every_signed_in_role(on: World) -> None:
    for user in (
        on.a.users["owner"],
        on.a.users["admin"],
        on.a.users["sales"],
        on.b.users["owner"],
    ):
        assert pg(on.stack, user, "GET", "/agent_model_prices?select=*").status_code == 403
        r = pg(
            on.stack,
            user,
            "POST",
            "/agent_model_prices",
            json={"model": "x", "input_micros_per_mtok": 1, "output_micros_per_mtok": 1},
            representation=False,
        )
        assert r.status_code == 403 and code_of(r) == "42501"


# ---- set_tenant_daily_cost_cap
def test_only_the_tenants_owner_with_a_second_factor_sets_the_cap_and_never_above_the_ceiling(
    on: World,
) -> None:
    w, tenant = on, on.a
    owner, admin = tenant.users["owner"], tenant.users["admin"]
    try:
        r = rpc(w, owner, "set_tenant_daily_cost_cap", p_tenant_id=tenant.id, p_cap_micros=5000)
        assert r.status_code == 200 and r.json()["daily_cost_cap_micros"] == 5000, r.text
        # who: Admin, Sales, Viewer, a foreign Owner and an unknown tenant all get the same generic refusal
        for user in (admin, tenant.users["sales"], tenant.users["viewer"], w.b.users["owner"]):
            r = rpc(w, user, "set_tenant_daily_cost_cap", p_tenant_id=tenant.id, p_cap_micros=1)
            assert (
                r.status_code in (401, 403)
                and code_of(r) == "42501"
                and r.json()["message"] == GENERIC
            ), (user.label, r.text)
        r = rpc(w, owner, "set_tenant_daily_cost_cap", p_tenant_id=uid(), p_cap_micros=1)
        assert code_of(r) == "42501" and r.json()["message"] == GENERIC
        # a password-only session of the Owner is refused (ADR 0016); the role is proven first, so an Admin still gets the generic refusal
        weak_owner = dataclasses.replace(owner, token=aal1_token(w.stack, owner))
        r = rpc(w, weak_owner, "set_tenant_daily_cost_cap", p_tenant_id=tenant.id, p_cap_micros=1)
        assert code_of(r) == "SM306" and r.json()["message"] == MFA, r.text
        weak_admin = dataclasses.replace(admin, token=aal1_token(w.stack, admin))
        r = rpc(w, weak_admin, "set_tenant_daily_cost_cap", p_tenant_id=tenant.id, p_cap_micros=1)
        assert code_of(r) == "42501" and r.json()["message"] == GENERIC
        # the ceiling
        ok = rpc(
            w, owner, "set_tenant_daily_cost_cap", p_tenant_id=tenant.id, p_cap_micros=500_000_000
        )
        # the response is the cap IN FORCE, which the plan's month may squeeze (job AK K2); the stored value is asserted below
        assert ok.status_code == 200
        for bad in (500_000_001, -1):
            r = rpc(w, owner, "set_tenant_daily_cost_cap", p_tenant_id=tenant.id, p_cap_micros=bad)
            assert r.status_code == 400 and code_of(r) == "23514", (bad, r.text)
        assert (
            operator_sql.sql(
                f"select daily_cost_cap_micros from public.tenant_agent_settings where tenant_id = '{tenant.id}'"
            )
            == "500000000"
        )
        # the change is audited (who, old, new)
        events = pg(
            w.stack,
            owner,
            "GET",
            f"/audit_events?tenant_id=eq.{tenant.id}&entity_type=eq.tenant_agent_settings&actor_user_id=eq.{owner.id}&select=old_values,new_values&order=id.desc&limit=1",
        ).json()
        assert events and events[0]["new_values"]["daily_cost_cap_micros"] == 500_000_000
        assert events[0]["old_values"]["daily_cost_cap_micros"] == 5000
    finally:
        set_cap(tenant, None)


def test_a_client_cannot_write_the_cap_column_or_the_operator_default_directly(on: World) -> None:
    w, tenant = on, on.a
    for user in (tenant.users["owner"], tenant.users["admin"]):
        r = pg(
            w.stack,
            user,
            "PATCH",
            f"/tenant_agent_settings?tenant_id=eq.{tenant.id}",
            json={"daily_cost_cap_micros": 500_000_000},
            representation=False,
        )
        assert r.status_code == 403 and code_of(r) == "42501", (user.label, r.status_code)
        r = pg(
            w.stack,
            user,
            "PATCH",
            "/agent_limits?limit_key=eq.daily_cost_micros",
            json={"limit_value": 500_000_000},
            representation=False,
        )
        assert r.status_code == 403 and code_of(r) == "42501"
    assert (
        operator_sql.sql(
            "select limit_value from public.agent_limits where limit_key = 'daily_cost_micros'"
        )
        == "2000000"
    )


def test_the_agents_switch_does_not_touch_the_cap(on: World) -> None:
    w, tenant = on, on.a
    try:
        assert (
            rpc(
                w,
                tenant.users["owner"],
                "set_tenant_daily_cost_cap",
                p_tenant_id=tenant.id,
                p_cap_micros=7000,
            ).status_code
            == 200
        )
        assert (
            rpc(
                w,
                tenant.users["admin"],
                "set_tenant_agents_enabled",
                p_tenant_id=tenant.id,
                p_enabled=True,
            ).status_code
            == 200
        )
        assert (
            operator_sql.sql(
                f"select daily_cost_cap_micros from public.tenant_agent_settings where tenant_id = '{tenant.id}'"
            )
            == "7000"
        )
    finally:
        set_cap(tenant, None)


def test_start_is_refused_with_the_dedicated_state_once_the_day_is_full(on: World) -> None:
    w, tenant = on, on.a
    try:
        set_cap(tenant, 0)
        r = rpc(
            w,
            tenant.users["sales"],
            "start_agent_run",
            p_run_id=uid(),
            p_tenant_id=tenant.id,
            p_agent_name="selftest",
            p_agent_version="it-cap",
            p_target_kind="company",
            p_target_id=tenant.rows["companies"]["id"],
            p_input_sha256="a" * 64,
            p_input_refs={},
        )
        assert r.status_code in (400, 403, 409) and code_of(r) == "SM207", (r.status_code, r.text)
        assert r.json()["message"] == "agent daily cost cap reached"
        # the other tenant is not affected
        other = start(w, w.b.users["sales"], w.b)
        cancel(w, w.b, other)
    finally:
        set_cap(tenant, None)
