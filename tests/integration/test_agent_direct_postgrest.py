"""PostgREST is reachable by anyone holding a user JWT and the public anon key. These tests skip
OUR API and attack the agent tables, the nine agent functions and the claim views directly, as
real signed-in users (ADR 0013): anon; a foreign tenant; a Viewer; Sales where Owner / Admin
is required; smuggled provenance (created_via, agent_run_id, created_by, confidence) on the
tables an agent writes to; direct INSERT / UPDATE / DELETE on every agent table and counter
tampering; the operator tables; function calls with names that do not exist; steering (a
foreign target, run or evidence id); a budget race over HTTP; expiry; a starter removed
mid-run; the tenant switch turned off mid-run; promotion by the wrong role.

Writes of attacks use `Prefer: return=minimal` (nothing is read back by accident); what an
attack achieved is judged by the victim data afterwards, never by the response alone. The
agent switches are OFF by default and only the operator (a migration, or here the local
database owner) can turn them on, so this module turns them on for its own two tenants and
restores the previous state exactly afterwards."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import User
from crm_support import Tenant, World
from evidence_support import code_of, pg, uid

AGENT_TABLES = ["tenant_agent_settings", "agent_runs", "agent_run_steps", "claim_reviews"]
OPERATOR_TABLES = ["platform_flags", "agent_limits", "agent_definitions", "agent_model_prices"]
FUNCTIONS = [
    "start_agent_run",
    "agent_write_evidence",
    "agent_write_claim",
    "agent_record_step",
    "agent_record_usage",
    "finish_agent_run",
    "cancel_agent_run",
    "set_tenant_agents_enabled",
    "review_claim",
    "agent_reserve_cost",
    "set_tenant_daily_cost_cap",
    "agent_release_cost",
    "agent_cost_summary",
]
GENERIC = "agent action not permitted"


# ------------------------------------------------------------------------------ plumbing
def rpc(w: World, user: User | None, name: str, **body: Any) -> httpx.Response:
    return pg(w.stack, user, "POST", f"/rpc/{name}", json=body)


def get(w: World, user: User | None, path: str) -> httpx.Response:
    return pg(w.stack, user, "GET", path)


def is_state(r: httpx.Response, code: str) -> bool:
    """A dedicated SM2xx state: HTTP 4xx with that SQLSTATE and a fixed message."""
    return r.status_code in (400, 403, 409) and code_of(r) == code


def is_generic(r: httpx.Response) -> bool:
    return (
        r.status_code in (401, 403) and code_of(r) == "42501" and r.json().get("message") == GENERIC
    )


def start(w: World, user: User, tenant: Tenant, **over: Any) -> httpx.Response:
    body: dict[str, Any] = {
        "p_run_id": uid(),
        "p_tenant_id": tenant.id,
        "p_agent_name": "selftest",
        "p_agent_version": "it-1",
        "p_target_kind": "company",
        "p_target_id": tenant.rows["companies"]["id"],
        "p_input_sha256": "a" * 64,
        "p_input_refs": {},
    }
    return rpc(w, user, "start_agent_run", **{**body, **over})


def write_evidence(
    w: World, user: User, run: str, step: str, snippet: str = "DEMO agent note", **over: Any
) -> httpx.Response:
    return rpc(
        w,
        user,
        "agent_write_evidence",
        **{"p_run_id": run, "p_step_key": step, "p_kind": "note", "p_snippet": snippet, **over},
    )


def started(w: World, user: User, tenant: Tenant, **over: Any) -> str:
    r = start(w, user, tenant, **over)
    assert r.status_code == 200, (r.status_code, r.text)
    return str(r.json()["run_id"])


# ------------------------------------------------------------------------------ module setup:
# the operator turns agents on
@pytest.fixture(scope="module")
def on(crm_world: World) -> Iterator[World]:
    w = crm_world
    saved = operator_sql.snapshot_switches()
    # these tests start dozens of runs; the hourly start cap itself is covered in pgTAP
    # (31_start_agent_run)
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
        operator_sql.restore_switches(saved)
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )


@pytest.fixture
def run_a(on: World) -> Iterator[str]:
    """A fresh running run of tenant A started by its Sales user; cancelled afterwards (the
    concurrency cap is 3)."""
    run = started(on, on.a.users["sales"], on.a)
    yield run
    rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)


# ==== 0. the happy path works: what the attacks below are attacks ON ====
def test_a_member_can_start_a_run_write_evidence_and_a_claim(on: World, run_a: str) -> None:
    w, sales = on, on.a.users["sales"]
    e = write_evidence(w, sales, run_a, "s1")
    assert e.status_code == 200 and e.json()["replayed"] is False, e.text
    c = rpc(
        w,
        sales,
        "agent_write_claim",
        p_run_id=run_a,
        p_step_key="s2",
        p_predicate="selftest.observation",
        p_value="DEMO observation",
        p_evidence_ids=[e.json()["evidence_id"]],
    )
    assert c.status_code == 200, c.text
    ev = get(
        w,
        sales,
        f"/evidence?id=eq.{e.json()['evidence_id']}&select=created_via,agent_run_id,created_by,provider,kind",
    ).json()
    assert ev == [
        {
            "created_via": "agent",
            "agent_run_id": run_a,
            "created_by": str(sales.id),
            "provider": "agent.selftest",
            "kind": "note",
        }
    ]
    cl = get(
        w,
        sales,
        f"/claims?id=eq.{c.json()['claim_id']}&select=created_via,agent_run_id,created_by,confidence,company_id",
    ).json()
    assert cl == [
        {
            "created_via": "agent",
            "agent_run_id": run_a,
            "created_by": str(sales.id),
            "confidence": "unverified",
            "company_id": w.a.rows["companies"]["id"],
        }
    ]


# ==== 1. anon ====
ANON_CALLS: dict[str, dict[str, Any]] = {
    "start_agent_run": {
        "p_run_id": "R",
        "p_tenant_id": "T",
        "p_agent_name": "selftest",
        "p_agent_version": "v",
        "p_target_kind": "company",
        "p_target_id": "R",
        "p_input_sha256": "a" * 64,
    },
    "agent_write_evidence": {"p_run_id": "R", "p_step_key": "anon-1", "p_kind": "note"},
    "agent_write_claim": {
        "p_run_id": "R",
        "p_step_key": "anon-2",
        "p_predicate": "selftest.observation",
        "p_value": "v",
        "p_evidence_ids": ["R"],
    },
    "agent_record_step": {
        "p_run_id": "R",
        "p_step_key": "anon-3",
        "p_tool_name": "read_target",
        "p_args_sha256": None,
    },
    "agent_record_usage": {
        "p_run_id": "R",
        "p_step_key": "anon-4",
        "p_tokens_in": 1,
        "p_tokens_out": 1,
        "p_cost_micros": 1,
    },
    "finish_agent_run": {"p_run_id": "R", "p_status": "succeeded"},
    "cancel_agent_run": {"p_run_id": "R"},
    "set_tenant_agents_enabled": {"p_tenant_id": "T", "p_enabled": True},
    "review_claim": {
        "p_review_id": "R",
        "p_claim_id": "R",
        "p_decision": "accepted",
        "p_confidence": "low",
    },
    "agent_reserve_cost": {
        "p_run_id": "R",
        "p_step_key": "anon-5",
        "p_model": "fake-selftest",
        "p_max_input_tokens": 1,
        "p_max_output_tokens": 1,
    },
    "set_tenant_daily_cost_cap": {"p_tenant_id": "T", "p_cap_micros": 1},
    "agent_release_cost": {"p_run_id": "R", "p_step_key": "anon-6", "p_reason": "rejected"},
    "agent_cost_summary": {"p_tenant_id": "T"},
}


@pytest.mark.parametrize("name", FUNCTIONS)
def test_anon_cannot_call_any_agent_function(on: World, run_a: str, name: str) -> None:
    """A COMPLETE, well-formed call, so that only the missing EXECUTE privilege can be what
    refuses it."""
    body: dict[str, Any] = {}
    for key, value in ANON_CALLS[name].items():
        body[key] = (
            {"R": run_a, "T": on.a.id}.get(value, value) if isinstance(value, str) else value
        )
    if name == "agent_write_claim":
        body["p_evidence_ids"] = [run_a]
    r = pg(on.stack, None, "POST", f"/rpc/{name}", json=body, representation=False)
    assert r.status_code in (401, 403) and code_of(r) == "42501", (name, r.status_code, r.text)
    assert r.json()["message"].startswith("permission denied for function"), (name, r.text)
    assert (
        operator_sql.sql(
            f"select writes_used + tool_calls_used from public.agent_runs where id = '{run_a}'"
        )
        == "0"
    )


@pytest.mark.parametrize(
    "table",
    [
        *AGENT_TABLES,
        *OPERATOR_TABLES,
        "claims_effective",
        "claims_for_scoring",
        "evidence_for_scoring",
    ],
)
def test_anon_reads_and_writes_no_agent_table(on: World, table: str) -> None:
    r = get(on, None, f"/{table}?select=*")
    assert r.status_code in (401, 403) and code_of(r) == "42501", (table, r.status_code)
    for method in ("POST", "PATCH", "DELETE"):
        w = pg(
            on.stack,
            None,
            method,
            f"/{table}",
            json={"x": 1} if method != "DELETE" else None,
            representation=False,
        )
        assert w.status_code in (401, 403, 404, 400), (table, method, w.status_code)
        assert w.status_code != 201


# ==== 2. the operator tables: no application role reads or writes them ====
OPERATOR_BODIES: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "platform_flags": ({"key": "agents_enabled", "enabled": True}, {"enabled": True}),
    "agent_limits": (
        {"limit_key": "max_runs_per_hour", "limit_value": 99999},
        {"limit_value": 99999},
    ),
    "agent_model_prices": (
        {"model": "rogue-model", "input_micros_per_mtok": 1, "output_micros_per_mtok": 1},
        {"input_micros_per_mtok": 1},
    ),
    "agent_definitions": (
        {
            "agent_name": "rogue",
            "allowed_predicates": ["x.y"],
            "max_writes": 1,
            "max_tool_calls": 1,
            "max_input_tokens": 1,
            "max_output_tokens": 1,
            "max_cost_micros": 1,
        },
        {"allowed_tenants": None},
    ),
}


@pytest.mark.parametrize("table", OPERATOR_TABLES)
def test_no_role_touches_the_operator_tables(on: World, table: str) -> None:
    insert, patch = OPERATOR_BODIES[table]
    for role, user in on.a.users.items():
        r = get(on, user, f"/{table}?select=*")
        assert r.status_code == 403 and code_of(r) == "42501", (role, table)
        for method, body in (("POST", insert), ("PATCH", patch), ("DELETE", None)):
            # (a PATCH / DELETE needs a filter, or PostgREST refuses it before any privilege
            # is consulted)
            key = {
                "platform_flags": "key",
                "agent_limits": "limit_key",
                "agent_definitions": "agent_name",
                "agent_model_prices": "model",
            }[table]
            path = f"/{table}" if method == "POST" else f"/{table}?{key}=not.is.null"
            w = pg(on.stack, user, method, path, json=body, representation=False)
            assert w.status_code == 403 and code_of(w) == "42501", (
                role,
                table,
                method,
                w.status_code,
            )
    # the values are what the owner approved (read as the operator)
    assert operator_sql.sql(
        "select string_agg(limit_key || '=' || limit_value, ',' order by limit_key) from public.agent_limits"
    ) in {
        "daily_cost_micros=2000000,max_concurrent_runs=3,max_runs_per_hour=30,max_writes_per_day=500,ttl_default_seconds=900,ttl_max_seconds=1800",
        "daily_cost_micros=2000000,max_concurrent_runs=3,max_runs_per_hour=100000,max_writes_per_day=500,ttl_default_seconds=900,ttl_max_seconds=1800",
    }  # (the module raises the hourly START cap for its own runs and restores it)


# ==== 3. direct writes to the agent tables, and counter tampering ====
def agent_table_bodies(
    tenant: Tenant, user: User, run_id: str
) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
    return {
        "tenant_agent_settings": ({"tenant_id": tenant.id, "enabled": True}, {"enabled": True}),
        "agent_runs": (
            {
                "id": uid(),
                "tenant_id": tenant.id,
                "started_by": str(user.id),
                "agent_name": "selftest",
                "agent_version": "v",
                "company_id": tenant.rows["companies"]["id"],
                "expires_at": "2999-01-01T00:00:00Z",
                "input_sha256": "a" * 64,
            },
            {"writes_used": 0, "status": "running", "max_writes": 99999},
        ),
        "agent_run_steps": (
            {
                "id": uid(),
                "tenant_id": tenant.id,
                "run_id": run_id,
                "started_by": str(user.id),
                "step_key": "x-" + uid()[:8],
                "kind": "tool_call",
                "status": "ok",
            },
            {"status": "ok", "tokens_in": 0},
        ),
        "claim_reviews": (
            {
                "id": uid(),
                "tenant_id": tenant.id,
                "claim_id": uid(),
                "decision": "accepted",
                "confidence": "high",
                "self_review": False,
            },
            {"decision": "accepted"},
        ),
    }


@pytest.mark.parametrize("table", AGENT_TABLES)
def test_no_role_writes_an_agent_table_directly(on: World, run_a: str, table: str) -> None:
    runs_before = operator_sql.sql(
        f"select writes_used || '/' || status from public.agent_runs where id = '{run_a}'"
    )
    for tenant in (on.a, on.b):
        for role, user in tenant.users.items():
            insert, patch = agent_table_bodies(tenant, user, run_a)[table]
            for method, body in (("POST", insert), ("PATCH", patch), ("DELETE", None)):
                r = pg(
                    on.stack,
                    user,
                    method,
                    f"/{table}?tenant_id=eq.{tenant.id}" if method != "POST" else f"/{table}",
                    json=body,
                    representation=False,
                )
                assert r.status_code == 403 and code_of(r) == "42501", (
                    tenant.label,
                    role,
                    table,
                    method,
                    r.status_code,
                    r.text,
                )
    assert (
        operator_sql.sql(
            f"select writes_used || '/' || status from public.agent_runs where id = '{run_a}'"
        )
        == runs_before
    )


def test_counters_and_budgets_cannot_be_tampered_with_even_by_the_owner(
    on: World, run_a: str
) -> None:
    owner = on.a.users["owner"]
    for patch in (
        {"writes_used": 0},
        {"max_writes": 99999},
        {"expires_at": "2999-01-01T00:00:00Z"},
        {"status": "running"},
        {"started_by": str(owner.id)},
        {"agent_name": "rogue"},
        {"cost_micros_used": 0},
    ):
        r = pg(
            on.stack, owner, "PATCH", f"/agent_runs?id=eq.{run_a}", json=patch, representation=False
        )
        assert r.status_code == 403 and code_of(r) == "42501", (patch, r.status_code)


# ==== 4. smuggled provenance on the tables an agent writes to ====
SMUGGLED = [
    {"created_via": "agent"},
    {"agent_run_id": "RUN"},
    {"created_via": "agent", "agent_run_id": "RUN"},
    {"created_by": "00000000-0000-0000-0000-000000000001"},
    {"created_at": "2000-01-01T00:00:00Z"},
]


def base_row(table: str, tenant: Tenant, evidence_id: str) -> dict[str, Any]:
    return {
        "evidence": {
            "id": uid(),
            "tenant_id": tenant.id,
            "kind": "web_page",
            "provider": "manual",
            "url": "https://example.test/smuggle",
        },
        "evidence_links": {
            "id": uid(),
            "tenant_id": tenant.id,
            "evidence_id": evidence_id,
            "company_id": tenant.rows["companies"]["id"],
        },
        "claims": {
            "id": uid(),
            "tenant_id": tenant.id,
            "company_id": tenant.rows["companies"]["id"],
            "predicate": "exports_to",
            "value": "smuggle",
            "confidence": "high",
        },
    }[table]


@pytest.mark.parametrize("table", ["evidence", "evidence_links", "claims"])
def test_provenance_cannot_be_smuggled_into_an_insert(on: World, run_a: str, table: str) -> None:
    sales = on.a.users["sales"]
    seed = uid()
    assert (
        pg(
            on.stack,
            sales,
            "POST",
            "/evidence",
            json=base_row("evidence", on.a, seed) | {"id": seed},
            representation=False,
        ).status_code
        == 201
    )
    for extra in SMUGGLED:
        row = base_row(table, on.a, seed) | {
            k: (run_a if v == "RUN" else v) for k, v in extra.items()
        }
        r = pg(on.stack, sales, "POST", f"/{table}", json=row, representation=False)
        assert r.status_code == 403 and code_of(r) == "42501", (table, extra, r.status_code, r.text)
        assert get(on, on.a.users["owner"], f"/{table}?id=eq.{row['id']}&select=id").json() == [], (
            table,
            extra,
        )


def test_what_a_plain_insert_records_is_decided_by_the_server_whatever_the_request_says(
    on: World, run_a: str
) -> None:
    sales = on.a.users["sales"]
    row = base_row("claims", on.a, uid())
    headers_attempts = {
        "x-app-created-via": "agent",
        "x-app-agent-run-id": run_a,
        "app.created_via": "agent",
        "app.agent_run_id": run_a,
    }
    r = httpx.post(
        f"{on.stack.rest}/claims",
        headers={**on.stack.headers(sales.token, Prefer="return=minimal"), **headers_attempts},
        json=row,
        timeout=20,
    )
    assert r.status_code == 201, r.text
    stored = get(
        on, sales, f"/claims?id=eq.{row['id']}&select=created_via,agent_run_id,created_by"
    ).json()
    assert stored == [{"created_via": "manual", "agent_run_id": None, "created_by": str(sales.id)}]


def test_a_client_cannot_set_the_provenance_settings_through_the_api(on: World, run_a: str) -> None:
    """The two settings the write functions use are database settings. PostgREST exposes only the
    public schema, so there is no
        set_config to call; the pg_catalog function is not reachable."""
    for name in ("set_config", "pg_catalog.set_config", "current_setting"):
        r = rpc(
            on,
            on.a.users["owner"],
            name,
            setting_name="app.created_via",
            new_value="agent",
            is_local=True,
        )
        assert r.status_code in (404, 400), (name, r.status_code)
        assert code_of(r) in ("PGRST202", "PGRST125", "PGRST100"), (name, code_of(r), r.text)


# ==== 5. function calls with names that do not exist ====
@pytest.mark.parametrize(
    ("name", "extra"),
    [
        ("start_agent_run", {"p_created_via": "agent"}),
        ("start_agent_run", {"p_created_by": "00000000-0000-0000-0000-000000000001"}),
        ("agent_write_evidence", {"p_created_via": "agent"}),
        ("agent_write_evidence", {"p_agent_run_id": "RUN"}),
        ("agent_write_evidence", {"p_tenant_id": "TENANT"}),
        ("agent_write_evidence", {"p_provider": "manual"}),
        ("agent_write_claim", {"p_confidence": "high"}),
        ("agent_write_claim", {"p_tenant_id": "TENANT"}),
        ("agent_write_claim", {"p_created_by": "00000000-0000-0000-0000-000000000001"}),
        ("review_claim", {"p_tenant_id": "TENANT"}),
        ("cancel_agent_run", {"p_tenant_id": "TENANT"}),
    ],
)
def test_arguments_that_would_set_provenance_or_identity_do_not_exist(
    on: World, run_a: str, name: str, extra: dict[str, Any]
) -> None:
    sales = on.a.users["sales"]
    base: dict[str, Any] = {
        "start_agent_run": {
            "p_run_id": uid(),
            "p_tenant_id": on.a.id,
            "p_agent_name": "selftest",
            "p_agent_version": "v",
            "p_target_kind": "company",
            "p_target_id": on.a.rows["companies"]["id"],
            "p_input_sha256": "a" * 64,
        },
        "agent_write_evidence": {
            "p_run_id": run_a,
            "p_step_key": "x-" + uid()[:8],
            "p_kind": "note",
        },
        "agent_write_claim": {
            "p_run_id": run_a,
            "p_step_key": "x-" + uid()[:8],
            "p_predicate": "selftest.observation",
            "p_value": "v",
            "p_evidence_ids": [uid()],
        },
        "review_claim": {
            "p_review_id": uid(),
            "p_claim_id": uid(),
            "p_decision": "accepted",
            "p_confidence": "low",
        },
        "cancel_agent_run": {"p_run_id": run_a},
    }[name]
    body = base | {
        k: ({"RUN": run_a, "TENANT": on.a.id}.get(v, v) if isinstance(v, str) else v)
        for k, v in extra.items()
    }
    before = operator_sql.sql(
        f"select count(*) from public.evidence where agent_run_id = '{run_a}'"
    )
    r = pg(on.stack, sales, "POST", f"/rpc/{name}", json=body, representation=False)
    assert r.status_code in (400, 404) and code_of(r) in ("PGRST202", "PGRST203"), (
        name,
        extra,
        r.status_code,
        r.text,
    )
    assert (
        operator_sql.sql(f"select count(*) from public.evidence where agent_run_id = '{run_a}'")
        == before
    )
    assert get(on, on.a.users["owner"], f"/agent_runs?id=eq.{run_a}&select=status").json() == [
        {"status": "running"}
    ], "and the run was not cancelled"


# ==== 6. roles ====
def test_a_viewer_cannot_start_a_run_and_a_stranger_learns_nothing(on: World) -> None:
    unknown = start(on, on.a.users["viewer"], on.a)
    assert is_generic(unknown), (unknown.status_code, unknown.text)
    for user in (on.b.users["sales"], on.b.users["owner"]):
        r = start(on, user, on.a)
        assert is_generic(r) and r.json() == unknown.json(), (
            "a member of another tenant gets the identical refusal"
        )
    assert (
        is_generic(start(on, on.a.users["owner"], on.a, p_tenant_id=uid()))
        and start(on, on.a.users["owner"], on.a, p_tenant_id=uid()).json() == unknown.json()
    )


def test_owner_admin_and_sales_may_start(on: World) -> None:
    runs = []
    for role in ("owner", "admin", "sales"):
        runs.append(started(on, on.a.users[role], on.a))
    for run in runs:
        assert rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run).status_code == 200


def test_sales_cannot_flip_the_tenant_switch_or_promote_a_claim_and_a_viewer_cannot_cancel(
    on: World, run_a: str
) -> None:
    sales, viewer, admin = on.a.users["sales"], on.a.users["viewer"], on.a.users["admin"]
    assert is_generic(
        rpc(on, sales, "set_tenant_agents_enabled", p_tenant_id=on.a.id, p_enabled=False)
    )
    assert is_generic(
        rpc(on, viewer, "set_tenant_agents_enabled", p_tenant_id=on.a.id, p_enabled=False)
    )
    assert is_generic(rpc(on, viewer, "cancel_agent_run", p_run_id=run_a))
    other = started(on, admin, on.a)
    assert is_generic(rpc(on, sales, "cancel_agent_run", p_run_id=other)), (
        "a Sales user cannot cancel a run someone else started"
    )
    assert rpc(on, admin, "cancel_agent_run", p_run_id=other).status_code == 200
    e = write_evidence(on, sales, run_a, "role-ev")
    c = rpc(
        on,
        sales,
        "agent_write_claim",
        p_run_id=run_a,
        p_step_key="role-cl",
        p_predicate="selftest.observation",
        p_value="v",
        p_evidence_ids=[e.json()["evidence_id"]],
    )
    review = {
        "p_review_id": uid(),
        "p_claim_id": c.json()["claim_id"],
        "p_decision": "accepted",
        "p_confidence": "low",
    }
    assert is_generic(rpc(on, sales, "review_claim", **review)), (
        "Sales cannot promote a claim, not even their own run's"
    )
    assert is_generic(rpc(on, viewer, "review_claim", **review))
    assert (
        rpc(on, on.b.users["owner"], "review_claim", **review).json()
        == rpc(on, sales, "review_claim", **review).json()
    ), "a foreign Owner: identical"
    assert (
        get(
            on, on.a.users["owner"], f"/claim_reviews?claim_id=eq.{c.json()['claim_id']}&select=id"
        ).json()
        == []
    )


# ==== 7. steering ====
def test_a_run_cannot_be_steered_into_another_run_tenant_or_evidence(on: World, run_a: str) -> None:
    sales_a, sales_b = on.a.users["sales"], on.b.users["sales"]
    run_b = started(on, sales_b, on.b)
    try:
        before_a = get(on, on.a.users["owner"], "/evidence?select=id&limit=1000").json()
        before_b = get(on, on.b.users["owner"], "/evidence?select=id&limit=1000").json()
        unknown = write_evidence(on, sales_a, uid(), "steer")
        assert is_generic(unknown)
        assert write_evidence(on, sales_a, run_b, "steer").json() == unknown.json(), (
            "A's user names B's run: identical refusal"
        )
        assert write_evidence(on, sales_b, run_a, "steer").json() == unknown.json(), (
            "B's user names A's run: identical"
        )
        assert write_evidence(on, on.a.users["admin"], run_a, "steer").json() == unknown.json(), (
            "another user of the SAME tenant: identical"
        )
        # evidence ids: another tenant's, a manual one, one written by ANOTHER run of the same
        # user
        mine = write_evidence(on, sales_a, run_a, "own-ev").json()["evidence_id"]
        theirs = write_evidence(on, sales_b, run_b, "their-ev").json()["evidence_id"]
        manual = uid()
        assert (
            pg(
                on.stack,
                sales_a,
                "POST",
                "/evidence",
                json={
                    "id": manual,
                    "tenant_id": on.a.id,
                    "kind": "web_page",
                    "provider": "manual",
                    "url": "https://example.test/m",
                },
                representation=False,
            ).status_code
            == 201
        )
        other_run = started(on, sales_a, on.a)
        other_ev = write_evidence(on, sales_a, other_run, "other-ev").json()["evidence_id"]
        try:
            bodies = []
            for evidence in (uid(), theirs, manual, other_ev):
                r = rpc(
                    on,
                    sales_a,
                    "agent_write_claim",
                    p_run_id=run_a,
                    p_step_key="steer-" + uid()[:6],
                    p_predicate="selftest.observation",
                    p_value="v",
                    p_evidence_ids=[mine, evidence],
                )
                assert r.status_code == 409 and code_of(r) == "23503", (
                    evidence,
                    r.status_code,
                    r.text,
                )
                bodies.append(r.json())
            assert all(b == bodies[0] for b in bodies), (
                "a foreign, a manual, another run's and a missing evidence id are indistinguishable"
            )
        finally:
            rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=other_run)
        # a start aimed at another tenant's company
        r = start(on, sales_a, on.a, p_target_id=on.b.rows["companies"]["id"])
        assert r.status_code == 409 and code_of(r) == "23503"
        assert r.json() == start(on, sales_a, on.a, p_target_id=uid()).json(), (
            "a foreign company fails exactly like a missing one"
        )
        # nothing leaked across
        after_a = get(on, on.a.users["owner"], "/evidence?select=id&limit=1000").json()
        after_b = get(on, on.b.users["owner"], "/evidence?select=id&limit=1000").json()
        assert (
            len(after_a) == len(before_a) + 3 and len(after_b) == len(before_b) + 1
        )  # A: own-ev, manual, other-ev; B: their-ev
        assert (
            get(on, on.a.users["owner"], f"/evidence?agent_run_id=eq.{run_b}&select=id").json()
            == []
        )
    finally:
        rpc(on, on.b.users["owner"], "cancel_agent_run", p_run_id=run_b)


# ==== 8. the budget race, expiry, a starter removed, the switch turned off, a cancel ====
def test_budget_race_twenty_concurrent_writes_against_a_budget_of_five_write_exactly_five(
    on: World,
) -> None:
    sales = on.a.users["sales"]
    run = started(on, sales, on.a, p_budgets={"max_writes": 5})
    try:
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(
                pool.map(
                    lambda i: write_evidence(on, sales, run, f"race-{i}", f"DEMO race {i}"),
                    range(20),
                )
            )
        ok = [r for r in results if r.status_code == 200]
        refused = [r for r in results if r.status_code != 200]
        assert len(ok) == 5, sorted(r.status_code for r in results)
        assert all(is_state(r, "SM203") for r in refused), [
            (r.status_code, r.text) for r in refused[:3]
        ]
        assert len(get(on, sales, f"/evidence?agent_run_id=eq.{run}&select=id").json()) == 5
        assert get(on, sales, f"/agent_runs?id=eq.{run}&select=writes_used,max_writes").json() == [
            {"writes_used": 5, "max_writes": 5}
        ]
        assert len(get(on, sales, f"/agent_run_steps?run_id=eq.{run}&select=id").json()) == 5, (
            "refused attempts leave no ledger row"
        )
    finally:
        rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)


def test_concurrent_retries_of_one_step_create_one_row(on: World, run_a: str) -> None:
    sales = on.a.users["sales"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda _: write_evidence(on, sales, run_a, "same-step", "DEMO same"), range(8))
        )
    assert all(r.status_code == 200 for r in results), [
        (r.status_code, r.text) for r in results if r.status_code != 200
    ][:2]
    assert sum(1 for r in results if r.json()["replayed"] is False) == 1
    assert len({r.json()["evidence_id"] for r in results}) == 1
    assert len(get(on, sales, f"/evidence?agent_run_id=eq.{run_a}&select=id").json()) == 1
    assert get(on, sales, f"/agent_runs?id=eq.{run_a}&select=writes_used").json() == [
        {"writes_used": 1}
    ]


def test_an_expired_run_cannot_write(on: World, run_a: str) -> None:
    sales = on.a.users["sales"]
    assert write_evidence(on, sales, run_a, "before").status_code == 200
    operator_sql.sql(
        f"update public.agent_runs set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = '{run_a}'"
    )
    r = write_evidence(on, sales, run_a, "after")
    assert is_state(r, "SM202"), (r.status_code, r.text)
    assert len(get(on, sales, f"/evidence?agent_run_id=eq.{run_a}&select=id").json()) == 1


def test_a_starter_removed_from_the_tenant_mid_run_stops_at_the_next_write(
    on: World, signup: Any
) -> None:
    newcomer = signup("agent-newcomer")
    owner = on.a.users["owner"]
    added = pg(
        on.stack,
        owner,
        "POST",
        "/memberships",
        json={"tenant_id": on.a.id, "user_id": str(newcomer.id), "role": "sales"},
        representation=False,
    )
    assert added.status_code == 201, added.text
    run = started(on, newcomer, on.a)
    assert write_evidence(on, newcomer, run, "in").status_code == 200
    removed = pg(
        on.stack,
        owner,
        "DELETE",
        f"/memberships?tenant_id=eq.{on.a.id}&user_id=eq.{newcomer.id}",
        representation=False,
    )
    assert removed.status_code in (200, 204), removed.text
    r = write_evidence(on, newcomer, run, "out")
    assert is_generic(r) and r.json() == write_evidence(on, newcomer, uid(), "out").json(), (
        "removed: the identical generic refusal"
    )
    assert len(get(on, owner, f"/evidence?agent_run_id=eq.{run}&select=id").json()) == 1
    operator_sql.sql(
        f"update public.agent_runs set status = 'cancelled', finished_at = now(), error_code = 'cancelled', cancel_requested_at = now(), cancelled_by = '{owner.id}' where id = '{run}'"
    )


def test_the_tenant_switch_turned_off_mid_run_stops_the_next_write_and_back_on_resumes(
    on: World, run_a: str
) -> None:
    sales, owner = on.a.users["sales"], on.a.users["owner"]
    assert write_evidence(on, sales, run_a, "sw1").status_code == 200
    assert (
        rpc(
            on, owner, "set_tenant_agents_enabled", p_tenant_id=on.a.id, p_enabled=False
        ).status_code
        == 200
    )
    try:
        r = write_evidence(on, sales, run_a, "sw2")
        assert is_state(r, "SM204") and r.json()["message"] == "agents are disabled"
        assert is_state(start(on, sales, on.a), "SM204")
        assert is_generic(start(on, on.a.users["viewer"], on.a)), "a Viewer is still told nothing"
    finally:
        assert (
            rpc(
                on, owner, "set_tenant_agents_enabled", p_tenant_id=on.a.id, p_enabled=True
            ).status_code
            == 200
        )
    assert write_evidence(on, sales, run_a, "sw2").status_code == 200


def test_the_platform_switch_is_the_operators_and_stops_everyone(on: World, run_a: str) -> None:
    operator_sql.sql(
        "update public.platform_flags set enabled = false where key = 'agents_enabled'"
    )
    try:
        assert is_state(write_evidence(on, on.a.users["sales"], run_a, "pf1"), "SM204")
        assert is_state(start(on, on.a.users["owner"], on.a), "SM204")
        assert (
            rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run_a).status_code == 200
        ), "a run can always be cancelled"
    finally:
        operator_sql.sql(
            "update public.platform_flags set enabled = true where key = 'agents_enabled'"
        )


def test_a_cancelled_run_cannot_write_and_cancelling_twice_is_harmless(
    on: World, run_a: str
) -> None:
    sales, owner = on.a.users["sales"], on.a.users["owner"]
    assert rpc(on, owner, "cancel_agent_run", p_run_id=run_a).json()["replayed"] is False
    assert rpc(on, owner, "cancel_agent_run", p_run_id=run_a).json()["replayed"] is True
    assert is_state(write_evidence(on, sales, run_a, "dead"), "SM201")
    assert get(on, sales, f"/agent_runs?id=eq.{run_a}&select=status,error_code").json() == [
        {"status": "cancelled", "error_code": "cancelled"}
    ]


# ==== 9. promotion, and what scoring may read ====
def test_an_agent_claim_counts_toward_scoring_only_after_an_owner_or_admin_accepts_it(
    on: World, run_a: str
) -> None:
    sales, owner, admin, viewer = (
        on.a.users["sales"],
        on.a.users["owner"],
        on.a.users["admin"],
        on.a.users["viewer"],
    )
    ev = write_evidence(on, sales, run_a, "pr-ev").json()["evidence_id"]
    claim = rpc(
        on,
        sales,
        "agent_write_claim",
        p_run_id=run_a,
        p_step_key="pr-cl",
        p_predicate="selftest.observation",
        p_value="DEMO promoted",
        p_evidence_ids=[ev],
    ).json()["claim_id"]

    def state(user: User, view: str) -> list[dict[str, Any]]:
        cols = "review_state,confidence" if view == "claims_effective" else "confidence"
        r = get(on, user, f"/{view}?id=eq.{claim}&select={cols}")
        assert r.status_code == 200, r.text
        rows: list[dict[str, Any]] = r.json()
        return rows

    assert state(viewer, "claims_effective") == [
        {"review_state": "unreviewed", "confidence": "unverified"}
    ], "every member sees it as unreviewed"
    assert state(sales, "claims_for_scoring") == [], (
        "an unreviewed agent claim is NOT a scoring input"
    )
    assert (
        get(on, on.b.users["owner"], f"/claims_effective?id=eq.{claim}&select=id").json() == []
    ), "tenant B sees nothing of it"
    assert (
        get(on, on.b.users["owner"], f"/claims_for_scoring?tenant_id=eq.{on.a.id}&select=id").json()
        == []
    )
    review = {
        "p_review_id": uid(),
        "p_claim_id": claim,
        "p_decision": "accepted",
        "p_confidence": "medium",
    }
    accepted = rpc(on, admin, "review_claim", **review)
    assert accepted.status_code == 200 and accepted.json() == {
        "review_id": review["p_review_id"],
        "replayed": False,
        "self_review": False,
    }
    assert rpc(on, admin, "review_claim", **review).json()["replayed"] is True, (
        "a retry of the same review id is a replay"
    )
    assert state(sales, "claims_effective") == [
        {"review_state": "accepted", "confidence": "medium"}
    ]
    assert state(sales, "claims_for_scoring") == [{"confidence": "medium"}], (
        "accepted: now it counts, at the human's confidence"
    )
    rejected = rpc(
        on,
        owner,
        "review_claim",
        p_review_id=uid(),
        p_claim_id=claim,
        p_decision="rejected",
        p_reason_code="outdated",
    )
    assert rejected.status_code == 200
    assert state(sales, "claims_for_scoring") == [], (
        "the newest review wins: rejected, so it no longer counts"
    )
    history = get(
        on,
        owner,
        f"/claim_reviews?claim_id=eq.{claim}&select=decision,created_via&order=created_at",
    ).json()
    assert history == [
        {"decision": "accepted", "created_via": "manual"},
        {"decision": "rejected", "created_via": "manual"},
    ]
    conflict = rpc(
        on,
        owner,
        "review_claim",
        p_review_id=review["p_review_id"],
        p_claim_id=claim,
        p_decision="rejected",
        p_reason_code="duplicate",
    )
    assert conflict.status_code == 409 and code_of(conflict) == "23505", (
        conflict.status_code,
        conflict.text,
    )
    assert "review id already used" == conflict.json()["message"]


def test_kinds_reserved_tool_names_and_oversized_usage_are_refused_over_http(
    on: World, run_a: str
) -> None:
    sales = on.a.users["sales"]
    kind = write_evidence(
        on, sales, run_a, "rf-kind", p_kind="web_page", p_url="https://demo.test/x"
    )
    assert kind.status_code == 400 and code_of(kind) == "23514", kind.text
    assert kind.json()["message"] == "value not allowed"
    for name in ("agent_write_evidence", "usage", "Agent_Write_Anything"):
        r = rpc(
            on,
            sales,
            "agent_record_step",
            p_run_id=run_a,
            p_step_key=f"rf-{name}",
            p_tool_name=name,
            p_args_sha256="a" * 64,
        )
        assert r.status_code == 400 and code_of(r) == "23514", (name, r.text)
    for field in ("p_tokens_in", "p_tokens_out", "p_cost_micros"):
        body = {
            "p_run_id": run_a,
            "p_step_key": f"rf-{field}",
            "p_tokens_in": 1,
            "p_tokens_out": 1,
            "p_cost_micros": 1,
        }
        body[field] = 9223372036854775807
        r = rpc(on, sales, "agent_record_usage", **body)
        assert is_state(r, "SM203"), (field, r.status_code, r.text)
    steps = get(on, on.a.users["owner"], f"/agent_run_steps?run_id=eq.{run_a}&select=id").json()
    assert steps == [], "none of the refusals left a step behind"


def test_only_accepted_agent_claims_reach_the_score_input_and_carry_the_reviewers_confidence(
    on: World, run_a: str
) -> None:
    """The score input is what the REAL reader (the repository the review queue and the label
    snapshot use) gets from the
        real stack: an accepted agent claim at the confidence the human chose (low / medium /
        high); unreviewed and rejected
        ones contribute nothing."""
    from app.crm.repository import PostgrestCrmRepository

    sales, admin, viewer = on.a.users["sales"], on.a.users["admin"], on.a.users["viewer"]
    ev = write_evidence(on, sales, run_a, "si-ev").json()["evidence_id"]
    claims: dict[str, str] = {}
    for name in ("low", "medium", "high", "rejected", "unreviewed"):
        r = rpc(
            on,
            sales,
            "agent_write_claim",
            p_run_id=run_a,
            p_step_key=f"si-{name}",
            p_predicate="selftest.observation",
            p_value=f"DEMO score input {name}",
            p_evidence_ids=[ev],
        )
        assert r.status_code == 200, r.text
        claims[name] = r.json()["claim_id"]

    def review(name: str, decision: str, **kw: str) -> None:
        r = rpc(
            on,
            admin,
            "review_claim",
            p_review_id=uid(),
            p_claim_id=claims[name],
            p_decision=decision,
            **kw,
        )
        assert r.status_code == 200, r.text

    for level in ("low", "medium", "high"):
        review(level, "accepted", p_confidence=level)
    review("rejected", "rejected", p_reason_code="incorrect")

    repo = PostgrestCrmRepository(on.stack.rest, on.stack.anon_key)
    company = uuid.UUID(on.a.rows["companies"]["id"])
    for who in (sales, viewer, admin):  # every member of the tenant reads the same score input
        seen = {
            c["value"]: c["confidence"]
            for c in repo.list_claims(who.token, uuid.UUID(on.a.id), company_id=company)
            if str(c["value"]).startswith("DEMO score input")
        }
        assert seen == {
            "DEMO score input low": "low",
            "DEMO score input medium": "medium",
            "DEMO score input high": "high",
        }, f"{who.label}: unreviewed and rejected claims must contribute nothing; got {seen}"
    # a foreign tenant's member cannot read tenant A's claims through the same reader, by any
    # company id
    assert repo.list_claims(on.b.users["owner"].token, uuid.UUID(on.a.id), company_id=company) == []


def _review_sql(review_id: str, claim: str, decision: str, extra: str = "") -> str:
    return (
        "select public.review_claim("
        f"'{review_id}', '{claim}', '{decision}'::public.claim_review_decision{extra});"
    )


def _concurrent_reviews(
    first: tuple[str, str], second: tuple[str, str], hold: float = 4.0, delay: float = 1.5
) -> tuple[tuple[int, str, str], tuple[int, str, str]]:
    """Session 1 runs its review and HOLDS its transaction open; session 2 starts `delay` seconds
    later, while it is held."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(
            operator_sql.sql_result,
            operator_sql.as_user(first[0], first[1], hold_seconds=hold),
            timeout=60,
        )
        time.sleep(delay)
        f2 = pool.submit(
            operator_sql.sql_result, operator_sql.as_user(second[0], second[1]), timeout=60
        )
        return f1.result(), f2.result()


def _make_reviewable_claim(on: World, run: str) -> str:
    sales = on.a.users["sales"]
    ev = write_evidence(on, sales, run, "cc-ev").json()["evidence_id"]
    r = rpc(
        on,
        sales,
        "agent_write_claim",
        p_run_id=run,
        p_step_key="cc-claim",
        p_predicate="selftest.observation",
        p_value="DEMO concurrent review",
        p_evidence_ids=[ev],
    )
    assert r.status_code == 200, r.text
    return str(r.json()["claim_id"])


def test_two_simultaneous_reviews_of_one_claim_end_in_a_deterministic_latest(
    on: World, run_a: str
) -> None:
    """The reviewer who acts LAST (commits last) wins, whatever the interleaving: review_claim locks
    the claim row before it
        inserts, so the second review waits for the first and gets the later timestamp.
        Without the lock the second review
        could insert (with a later timestamp) and commit FIRST, and the stale review would
        then be committed last."""
    claim = _make_reviewable_claim(on, run_a)
    admin, owner = on.a.users["admin"], on.a.users["owner"]
    r_accept, r_reject = uid(), uid()
    one, two = _concurrent_reviews(
        (str(admin.id), _review_sql(r_accept, claim, "accepted", ", 'medium'")),
        (str(owner.id), _review_sql(r_reject, claim, "rejected", ", null, 'outdated'")),
    )
    assert one[0] == 0 and two[0] == 0, (one, two)
    committed_one, committed_two = one[1].splitlines()[-1], two[1].splitlines()[-1]
    # ISO timestamps with the same offset order lexicographically
    last_committed = "accepted" if committed_one > committed_two else "rejected"
    rows = operator_sql.sql(
        "select string_agg(decision::text, ',' order by created_at, id) "
        f"from public.claim_reviews where claim_id = '{claim}'"
    )
    assert sorted(rows.split(",")) == ["accepted", "rejected"], "both reviews are recorded"
    latest = operator_sql.sql(
        f"select review_state from public.claims_effective where id = '{claim}'"
    )
    assert latest == last_committed, (
        f"the effective review ({latest}) must be the one committed last ({last_committed}); "
        f"commits: {committed_one} / {committed_two}"
    )
    assert rows.split(",")[-1] == last_committed, "...and it has the newest timestamp"


def test_a_retry_that_overlaps_the_original_review_is_a_replay_not_a_conflict(
    on: World, run_a: str
) -> None:
    """The same review id sent twice at once (a double click, a retry racing the first request): the
    second must wait for
        the first and then replay it, never fail with 'review id already used'."""
    claim = _make_reviewable_claim(on, run_a)
    admin = on.a.users["admin"]
    rid = uid()
    call = _review_sql(rid, claim, "accepted", ", 'low'")
    one, two = _concurrent_reviews((str(admin.id), call), (str(admin.id), call))
    assert one[0] == 0, one
    assert two[0] == 0, f"the overlapping retry must succeed (replay), got: {two}"
    assert '"replayed": true' in two[1], two
    assert (
        operator_sql.sql(f"select count(*) from public.claim_reviews where claim_id = '{claim}'")
        == "1"
    )


def test_a_manual_claim_cannot_be_promoted_and_reviews_cannot_be_written_directly(
    on: World,
) -> None:
    owner = on.a.users["owner"]
    manual = uid()
    assert (
        pg(
            on.stack,
            owner,
            "POST",
            "/claims",
            json={
                "id": manual,
                "tenant_id": on.a.id,
                "company_id": on.a.rows["companies"]["id"],
                "predicate": "exports_to",
                "value": "m",
                "confidence": "low",
            },
            representation=False,
        ).status_code
        == 201
    )
    r = rpc(
        on,
        owner,
        "review_claim",
        p_review_id=uid(),
        p_claim_id=manual,
        p_decision="accepted",
        p_confidence="low",
    )
    assert r.status_code == 400 and code_of(r) == "23514"
    direct = pg(
        on.stack,
        owner,
        "POST",
        "/claim_reviews",
        json={
            "id": uid(),
            "tenant_id": on.a.id,
            "claim_id": manual,
            "decision": "accepted",
            "confidence": "high",
            "self_review": False,
        },
        representation=False,
    )
    assert direct.status_code == 403 and code_of(direct) == "42501"


# ==== 10. state errors carry fixed messages and no values ====
def test_state_errors_have_fixed_messages_and_no_row_values(on: World, run_a: str) -> None:
    sales = on.a.users["sales"]
    canary = "CANARY-" + uid()
    operator_sql.sql(
        f"update public.agent_runs set status = 'succeeded', finished_at = now() where id = '{run_a}'"
    )
    messages = {
        write_evidence(on, sales, run_a, "m1", canary).json()["message"],
        rpc(
            on,
            sales,
            "agent_record_step",
            p_run_id=run_a,
            p_step_key=canary.lower(),
            p_tool_name="read_target",
            p_args_sha256=None,
        ).json()["message"],
    }
    assert messages == {"agent run is not running"}
    generic = write_evidence(on, sales, uid(), "m2", canary)
    assert generic.json()["message"] == GENERIC and canary not in generic.text
    assert (
        set(generic.json()) <= {"code", "message", "details", "hint"}
        and generic.json().get("details") is None
    )


# ==== 11. isolation of the new tables and views ====
@pytest.mark.parametrize(
    "table",
    [
        "agent_runs",
        "agent_run_steps",
        "claim_reviews",
        "tenant_agent_settings",
        "claims_effective",
        "claims_for_scoring",
    ],
)
def test_other_tenants_rows_are_invisible(on: World, run_a: str, table: str) -> None:
    write_evidence(on, on.a.users["sales"], run_a, "iso")
    for own, other in ((on.a, on.b), (on.b, on.a)):
        for role, user in own.users.items():
            seen = get(on, user, f"/{table}?select=tenant_id&limit=1000")
            assert seen.status_code == 200, (table, role)
            assert {row["tenant_id"] for row in seen.json()} <= {own.id}, (own.label, role, table)
            assert get(on, user, f"/{table}?tenant_id=eq.{other.id}&select=*").json() == [], (
                own.label,
                role,
                table,
            )


def test_runs_are_visible_to_owner_and_admin_for_every_run_and_to_others_for_their_own_only(
    on: World,
) -> None:
    sales_run = started(on, on.a.users["sales"], on.a)
    admin_run = started(on, on.a.users["admin"], on.a)
    try:

        def ids(user: User) -> set[str]:
            return {
                row["id"]
                for row in get(
                    on, user, f"/agent_runs?tenant_id=eq.{on.a.id}&select=id&limit=1000"
                ).json()
            }

        assert {sales_run, admin_run} <= ids(on.a.users["owner"]) and {sales_run, admin_run} <= ids(
            on.a.users["admin"]
        )
        assert sales_run in ids(on.a.users["sales"]) and admin_run not in ids(on.a.users["sales"])
        assert ids(on.a.users["viewer"]) == set()
    finally:
        for run in (sales_run, admin_run):
            rpc(on, on.a.users["owner"], "cancel_agent_run", p_run_id=run)


def test_a_run_is_audited_as_started_by_a_human_and_its_content_as_written_by_the_agent(
    on: World, run_a: str
) -> None:
    sales, owner = on.a.users["sales"], on.a.users["owner"]
    e = write_evidence(on, sales, run_a, "au1", "DEMO audited note").json()
    audit = get(
        on,
        owner,
        f"/audit_events?entity_id=eq.{e['evidence_id']}&select=actor_type,actor_user_id,agent_run_id,action,new_values",
    ).json()
    assert [
        (a["actor_type"], a["actor_user_id"], a["agent_run_id"], a["action"]) for a in audit
    ] == [("agent", str(sales.id), run_a, "evidence.create")]
    assert "DEMO audited note" not in str(audit), "PII columns are audited by name only"
    started_event = get(
        on,
        owner,
        f"/audit_events?entity_id=eq.{run_a}&action=eq.agent_run.create&select=actor_type,actor_user_id",
    ).json()
    assert started_event == [{"actor_type": "user", "actor_user_id": str(sales.id)}]
