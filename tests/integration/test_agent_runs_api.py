"""The agent runtime and its HTTP API against the REAL local stack (GoTrue, PostgREST, Postgres),
with the scripted FakeProvider.

Every database read the runtime and the API add is exercised here against the real views and
tables: a mock cannot see a column a view does not have (an earlier mock-only test missed
exactly that). The agent switches are OFF by default and only the operator (a migration, or
here the local database owner) can turn them on, so this module turns them on for its own two
tenants and restores the previous state afterwards.

What is proved end to end: a run is started by a signed-in user, executed in the background
with that user's token, writes only through the definer functions, and leaves UNVERIFIED
suggestions that count toward a score only after an Owner / Admin accepts them; a cancel, a
switch, a lost role and a model that OBEYS an injection each stop or contain a run."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import dataclasses
import json
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import operator_sql
import pytest
from conftest import User, bearer
from crm_support import Tenant, World
from evidence_support import pg, uid
from fastapi.testclient import TestClient

from app.agent_runs.executor import RunTask, ThreadRunExecutor
from app.agent_runs.repository import PostgrestAgentRunsRepository
from app.agent_runs.wiring import AgentsRuntime
from app.agents import errors
from app.agents.db import AgentDb
from app.agents.llm.fake import (
    FakeProvider,
    Step,
    call,
    final,
    respond,
    selftest_responses,
    selftest_script,
)
from app.agents.llm.interface import LlmRequest, LlmResponse
from app.agents.registry import AGENTS
from app.agents.runtime import AgentRunner
from app.config import Settings
from app.crm.repository import PostgrestCrmRepository
from app.main import build_runtime, create_app

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "packages" / "contracts" / "agents.schema.json").read_text())
SELFTEST = AGENTS["selftest"]


def validate(instance: Any, definition: str) -> None:
    jsonschema.validate(instance, {"$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]})


# ------------------------------------------------------------------------------ plumbing
@dataclasses.dataclass
class Rig:
    client: TestClient
    world: World
    gates: dict[str, threading.Event]


def agents_runtime(
    stack: Any, factory: Callable[[], FakeProvider], *, workers: int = 2, queue: int = 8
) -> AgentsRuntime:
    def execute(task: RunTask) -> None:
        db = AgentDb(stack.rest, stack.anon_key, task.token, task.run_id)
        try:
            AgentRunner(db=db, llm=factory(), spec=SELFTEST).run()
        finally:
            db.close()

    return AgentsRuntime(
        repository=PostgrestAgentRunsRepository(stack.rest, stack.anon_key),
        executor=ThreadRunExecutor(execute, max_workers=workers, max_queue=queue),
        unavailable=None,
    )


def app_client(
    stack: Any, factory: Callable[[], FakeProvider] | None = None, **pool: int
) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        agents_enabled=True,
        llm_provider="fake",
    )
    runtime = build_runtime(settings)
    assert runtime is not None
    if factory is not None:
        runtime = dataclasses.replace(runtime, agents=agents_runtime(stack, factory, **pool))
    with TestClient(create_app(settings, runtime=runtime)) as client:
        yield client


@pytest.fixture(scope="module")
def operator_on(crm_world: World) -> Iterator[World]:
    """The operator turns agents on for this module's two tenants (and raises the hourly start
    cap for the whole module)."""
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
    try:
        yield w
    finally:
        operator_sql.restore_switches(saved)
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )


OWN: dict[str, dict[str, str]] = {}


@pytest.fixture(scope="module", autouse=True)
def own_targets(operator_on: World) -> Iterator[None]:
    """This module's own company and lead per tenant: agent notes are linked to their target, and the
    shared CRM world's base
        rows are read by other suites that must not see them."""
    w = operator_on
    for t in (w.a, w.b):
        owner = t.users["owner"]
        company, lead = uid(), uid()
        r = w.client.post(
            f"/v1/tenants/{t.id}/companies",
            json={
                "id": company,
                "name": "DEMO Agent Target Silks",
                "city": "Mysuru",
                "website": "https://agent-target.test/shop",
            },
            headers=bearer(owner),
        )
        assert r.status_code == 201, r.text
        r = w.client.post(
            f"/v1/tenants/{t.id}/leads",
            json={"id": lead, "company_id": company},
            headers=bearer(owner),
        )
        assert r.status_code == 201, r.text
        OWN[t.id] = {"company": company, "lead": lead}
    yield


@pytest.fixture(scope="module")
def stack_(operator_on: World) -> Any:
    return operator_on.stack


@pytest.fixture(scope="module")
def api(operator_on: World, stack_: Any) -> Iterator[Rig]:
    """The default app: the fake provider plays a well-behaved selftest run."""
    for client in app_client(stack_):
        w = operator_on
        # the tenant switch goes through OUR API (Owner), then back is checked through it too
        for t in (w.a, w.b):
            r = client.put(
                f"/v1/tenants/{t.id}/agent-settings",
                json={"enabled": True},
                headers=bearer(t.users["owner"]),
            )
            assert r.status_code == 200 and r.json() == {"enabled": True}, r.text
        yield Rig(client, w, {})


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def start(rig: Rig, user: User, t: Tenant, **over: Any) -> httpx.Response:
    body = {
        "id": uid(),
        "agent": "selftest",
        "target_kind": "company",
        "target_id": OWN[t.id]["company"],
        **over,
    }
    response: httpx.Response = rig.client.post(
        url(t, "/agent-runs"), json=body, headers=bearer(user)
    )
    return response


def wait_run(
    client: TestClient,
    t: Tenant,
    user: User,
    run_id: str,
    *,
    done: Callable[[dict[str, Any]], bool] | None = None,
    timeout: float = 40,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        r = client.get(url(t, f"/agent-runs/{run_id}"), headers=bearer(user))
        assert r.status_code == 200, r.text
        last = r.json()
        if (done or (lambda run: run["status"] != "running"))(last):
            return last
        time.sleep(0.2)
    pytest.fail(f"run {run_id} did not reach the expected state in {timeout}s: {last}")


def cancel_quietly(client: TestClient, t: Tenant, run_id: str) -> None:
    client.post(url(t, f"/agent-runs/{run_id}/cancel"), headers=bearer(t.users["owner"]))


# ==== 1. the happy path, end to end ====
def test_a_run_is_executed_in_the_background_and_leaves_unverified_suggestions(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    r = start(api, sales, w.a)
    assert r.status_code == 202, r.text
    validate(r.json(), "RunOut")
    run_id = r.json()["id"]
    run = wait_run(api.client, w.a, sales, run_id)
    assert run["status"] == "succeeded" and run["error_code"] is None, run
    validate(run, "RunOut")
    assert (
        run["writes_used"] == 3
        and run["input_tokens_used"] == 300
        and run["output_tokens_used"] == 150
    )
    assert run["cost_micros_used"] == 0 and run["cancel_requested"] is False

    # the suggestions: unverified, attributed to the agent run and the starting human
    viewer = w.a.users["viewer"]
    claims = api.client.get(
        url(w.a, f"/companies/{OWN[w.a.id]['company']}/claims"), headers=bearer(viewer)
    )
    assert claims.status_code == 200
    mine = [c for c in claims.json() if c["agent_run_id"] == run_id]
    assert len(mine) == 2
    for c in mine:
        validate(c, "ClaimSuggestionOut")
        assert c["created_via"] == "agent" and c["review_state"] == "unreviewed"
        assert c["confidence"] == "unverified" and c["claim_confidence"] == "unverified"
        assert c["created_by"] == str(sales.id), "the starting human is on the record"
    # the note is evidence of kind note, written as the agent
    evidence = api.client.get(
        url(w.a, f"/companies/{OWN[w.a.id]['company']}/evidence"), headers=bearer(viewer)
    ).json()["items"]
    notes = [e for e in evidence if e["evidence"]["provider"] == "agent.selftest"]
    assert notes and notes[0]["evidence"]["kind"] == "note" and notes[0]["created_via"] == "agent"
    # the run shows up in the list for its starter and for an Owner, not for a Viewer
    listed = api.client.get(url(w.a, "/agent-runs"), headers=bearer(w.a.users["owner"])).json()
    validate(listed, "Page_RunOut_")
    assert run_id in [x["id"] for x in listed["items"]]
    assert run_id not in [
        x["id"]
        for x in api.client.get(url(w.a, "/agent-runs"), headers=bearer(viewer)).json()["items"]
    ]


def test_suggestions_reach_the_score_input_only_after_a_human_accepts_them(api: Rig) -> None:
    w, sales, owner = api.world, api.world.a.users["sales"], api.world.a.users["owner"]
    run_id = start(api, sales, w.a).json()["id"]
    assert wait_run(api.client, w.a, sales, run_id)["status"] == "succeeded"
    company = OWN[w.a.id]["company"]
    suggestions = [
        c
        for c in api.client.get(
            url(w.a, f"/companies/{company}/claims"), headers=bearer(sales)
        ).json()
        if c["agent_run_id"] == run_id
    ]
    repo = PostgrestCrmRepository(w.stack.rest, w.stack.anon_key)

    def score_input() -> dict[str, str]:
        return {
            c["id"]: c["confidence"]
            for c in repo.list_claims(sales.token, uuid.UUID(w.a.id), company_id=uuid.UUID(company))
        }

    assert not {c["id"] for c in suggestions} & set(score_input()), (
        "unreviewed: nothing reaches scoring"
    )
    # medium / high need a SUPPORTING link: observation one has one, observation two is only
    # context
    first = next(c for c in suggestions if "one" in c["value"])
    second = next(c for c in suggestions if "two" in c["value"])
    review = {"id": uid(), "decision": "accepted", "confidence": "high"}
    r = api.client.post(
        url(w.a, f"/claims/{first['id']}/reviews"), json=review, headers=bearer(owner)
    )
    assert r.status_code == 201, r.text
    validate(r.json(), "ReviewOut")
    again = api.client.post(
        url(w.a, f"/claims/{first['id']}/reviews"), json=review, headers=bearer(owner)
    )
    assert again.status_code == 200 and again.json()["replayed"] is True
    seen = score_input()
    assert seen.get(first["id"]) == "high" and second["id"] not in seen
    rej = {"id": uid(), "decision": "rejected", "reason_code": "outdated"}
    assert (
        api.client.post(
            url(w.a, f"/claims/{first['id']}/reviews"), json=rej, headers=bearer(owner)
        ).status_code
        == 201
    )
    assert first["id"] not in score_input(), "the newest review wins"
    states = {
        c["id"]: c["review_state"]
        for c in api.client.get(
            url(w.a, f"/companies/{company}/claims"), headers=bearer(sales)
        ).json()
    }
    assert states[first["id"]] == "rejected" and states[second["id"]] == "unreviewed"


def test_a_lead_target_works_through_its_company(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    r = start(api, sales, w.a, target_kind="lead", target_id=OWN[w.a.id]["lead"])
    assert r.status_code == 202, r.text
    run = wait_run(api.client, w.a, sales, r.json()["id"])
    assert run["status"] == "succeeded" and run["lead_id"] == OWN[w.a.id]["lead"], run
    claims = api.client.get(url(w.a, f"/leads/{OWN[w.a.id]['lead']}/claims"), headers=bearer(sales))
    assert (
        claims.status_code == 200
        and len([c for c in claims.json() if c["agent_run_id"] == run["id"]]) == 2
    )


def test_the_tenant_switch_is_read_back_through_the_api(api: Rig) -> None:
    w = api.world
    for user in ("viewer", "sales", "admin", "owner"):
        r = api.client.get(url(w.a, "/agent-settings"), headers=bearer(w.a.users[user]))
        assert r.status_code == 200, user
        validate(r.json(), "AgentSettingsOut")
    off = api.client.put(
        url(w.a, "/agent-settings"), json={"enabled": False}, headers=bearer(w.a.users["admin"])
    )
    assert off.status_code == 200 and off.json() == {"enabled": False}
    blocked = start(api, w.a.users["sales"], w.a)
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "agents_disabled"
    assert (
        api.client.put(
            url(w.a, "/agent-settings"), json={"enabled": True}, headers=bearer(w.a.users["owner"])
        ).status_code
        == 200
    )
    assert api.client.get(
        url(w.a, "/agent-settings"), headers=bearer(w.a.users["viewer"])
    ).json() == {"enabled": True}


# ==== 2. authorization against the real RLS ====
def test_foreign_tenants_viewers_and_sales_are_refused_by_the_real_database(api: Rig) -> None:
    w = api.world
    run_id = start(api, w.a.users["sales"], w.a).json()["id"]
    wait_run(api.client, w.a, w.a.users["sales"], run_id)
    # tenant B's Owner names tenant A in the path: 404 everywhere, nothing leaks
    for method, path in (
        ("GET", f"/agent-runs/{run_id}"),
        ("POST", f"/agent-runs/{run_id}/cancel"),
        ("GET", "/agent-runs"),
        ("GET", "/agent-settings"),
        ("PUT", "/agent-settings"),
        ("POST", "/agent-runs"),
    ):
        r = api.client.request(
            method, url(w.a, path), json={"enabled": True}, headers=bearer(w.b.users["owner"])
        )
        assert r.status_code == 404, (method, path, r.status_code)
    # the same run id through tenant B's own path: not found, and the generic message
    r = api.client.get(url(w.b, f"/agent-runs/{run_id}"), headers=bearer(w.b.users["owner"]))
    assert r.status_code == 404 and r.json() == {
        "error": {"code": "not_found", "message": "Not found."}
    }
    # a Viewer cannot start, a Sales user cannot flip the switch, a Sales user cannot see
    # another's run
    assert start(api, w.a.users["viewer"], w.a).status_code == 403
    assert (
        api.client.put(
            url(w.a, "/agent-settings"), json={"enabled": False}, headers=bearer(w.a.users["sales"])
        ).status_code
        == 403
    )
    assert (
        api.client.get(
            url(w.a, f"/agent-runs/{run_id}"), headers=bearer(w.a.users["viewer"])
        ).status_code
        == 404
    )
    assert (
        api.client.get(
            url(w.a, f"/agent-runs/{run_id}"), headers=bearer(w.a.users["admin"])
        ).status_code
        == 200
    )
    # a target of tenant A named in tenant B's path is simply not there
    foreign_target = start(api, w.b.users["sales"], w.b, target_id=OWN[w.a.id]["company"])
    assert foreign_target.status_code == 404


def test_reviewing_needs_owner_or_admin_and_a_claim_of_this_tenant(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    run_id = start(api, sales, w.a).json()["id"]
    wait_run(api.client, w.a, sales, run_id)
    claim = next(
        c
        for c in api.client.get(
            url(w.a, f"/companies/{OWN[w.a.id]['company']}/claims"), headers=bearer(sales)
        ).json()
        if c["agent_run_id"] == run_id and "one" in c["value"]
    )
    body = {"id": uid(), "decision": "accepted", "confidence": "low"}
    for user in ("sales", "viewer"):
        assert (
            api.client.post(
                url(w.a, f"/claims/{claim['id']}/reviews"),
                json=body,
                headers=bearer(w.a.users[user]),
            ).status_code
            == 403
        )
    # tenant B's Owner, through B's own path: the claim does not exist there
    assert (
        api.client.post(
            url(w.b, f"/claims/{claim['id']}/reviews"),
            json=body,
            headers=bearer(w.b.users["owner"]),
        ).status_code
        == 404
    )
    # an unknown id: the identical 404
    assert (
        api.client.post(
            url(w.a, f"/claims/{uuid.uuid4()}/reviews"),
            json=body,
            headers=bearer(w.a.users["owner"]),
        ).status_code
        == 404
    )
    # the Admin may; a reused review id with another decision is a conflict, not a silent
    # overwrite
    ok = api.client.post(
        url(w.a, f"/claims/{claim['id']}/reviews"), json=body, headers=bearer(w.a.users["admin"])
    )
    assert ok.status_code == 201
    clash = {"id": body["id"], "decision": "rejected", "reason_code": "duplicate"}
    assert (
        api.client.post(
            url(w.a, f"/claims/{claim['id']}/reviews"),
            json=clash,
            headers=bearer(w.a.users["admin"]),
        ).status_code
        == 409
    )
    # medium / high need a supporting link: this claim has one (its note), so high is allowed
    high = {"id": uid(), "decision": "accepted", "confidence": "high"}
    assert (
        api.client.post(
            url(w.a, f"/claims/{claim['id']}/reviews"),
            json=high,
            headers=bearer(w.a.users["owner"]),
        ).status_code
        == 201
    )


def test_a_manual_claim_cannot_be_reviewed_and_the_refusal_has_a_fixed_message(api: Rig) -> None:
    w, owner = api.world, api.world.a.users["owner"]
    manual = pg(
        w.stack,
        owner,
        "POST",
        "/claims",
        json={
            "id": uid(),
            "tenant_id": w.a.id,
            "company_id": OWN[w.a.id]["company"],
            "predicate": "buyer_type",
            "value": "saree_shop",
            "confidence": "unverified",
        },
    )
    assert manual.status_code == 201, manual.text
    body = {"id": uid(), "decision": "accepted", "confidence": "low"}
    r = api.client.post(
        url(w.a, f"/claims/{manual.json()[0]['id']}/reviews"), json=body, headers=bearer(owner)
    )
    assert r.status_code == 422 and r.json()["error"] == {
        "code": "invalid_value",
        "message": "A value was not accepted.",
    }


# ==== 3. start: idempotency, targets, limits ====
def test_a_retried_start_is_one_run_and_one_execution(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    run_id = uid()
    first = start(api, sales, w.a, id=run_id)
    again = start(api, sales, w.a, id=run_id)
    assert first.status_code == 202 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"] == run_id
    run = wait_run(api.client, w.a, sales, run_id)
    assert run["status"] == "succeeded" and run["writes_used"] == 3, (
        "executed once: three writes, not six"
    )
    other_target = start(
        api, sales, w.a, id=run_id, target_kind="lead", target_id=OWN[w.a.id]["lead"]
    )
    assert other_target.status_code == 409
    # another tenant's user using the same id learns nothing
    clash = start(api, w.b.users["sales"], w.b, id=run_id)
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "conflict"


def test_malformed_requests_and_unknown_targets(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    assert start(api, sales, w.a, target_id=uid()).status_code == 404
    assert start(api, sales, w.a, agent="nope").status_code == 422
    assert start(api, sales, w.a, tenant_id=w.a.id).status_code == 422
    assert (
        api.client.get(url(w.a, "/agent-runs/not-a-uuid"), headers=bearer(sales)).status_code == 404
    )
    unauth = api.client.post(url(w.a, "/agent-runs"), json={})
    assert unauth.status_code == 401


# ==== 4. every database read of the runtime, against the real tables ====
def test_the_runtime_database_module_reads_its_run_and_only_four_columns_of_its_target(
    api: Rig,
) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    run_id = start(api, sales, w.a).json()["id"]
    wait_run(api.client, w.a, sales, run_id)
    db = AgentDb(w.stack.rest, w.stack.anon_key, sales.token, uuid.UUID(run_id))
    run = db.read_run()
    assert run.agent_name == "selftest" and run.status == "succeeded" and run.company_id is not None
    facts = db.read_target(run)
    assert set(facts) == {"name", "city", "region", "website"} and facts["name"]
    # a lead target resolves through its company
    lead_run = start(api, sales, w.a, target_kind="lead", target_id=OWN[w.a.id]["lead"]).json()[
        "id"
    ]
    wait_run(api.client, w.a, sales, lead_run)
    lead_db = AgentDb(w.stack.rest, w.stack.anon_key, sales.token, uuid.UUID(lead_run))
    lead_view = lead_db.read_run()
    assert lead_view.lead_id is not None
    assert lead_db.read_target(lead_view) == facts or set(lead_db.read_target(lead_view)) == set(
        facts
    )
    # someone else's run, another tenant's user, and an unknown run are the same RunDenied
    for stranger in (w.a.users["viewer"], w.b.users["owner"]):
        with pytest.raises(errors.RunDenied):
            AgentDb(w.stack.rest, w.stack.anon_key, stranger.token, uuid.UUID(run_id)).read_run()
    with pytest.raises(errors.RunDenied):
        AgentDb(w.stack.rest, w.stack.anon_key, sales.token, uuid.uuid4()).read_run()
    # an Owner (the real RLS lets Owner/Admin read every run) can read it
    assert AgentDb(
        w.stack.rest, w.stack.anon_key, w.a.users["owner"].token, uuid.UUID(run_id)
    ).read_run().id == uuid.UUID(run_id)


def test_the_runtime_writes_are_refused_for_a_token_that_does_not_own_the_run(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    run_id = uuid.UUID(start(api, sales, w.a).json()["id"])
    wait_run(api.client, w.a, sales, str(run_id))
    for stranger in (w.a.users["owner"], w.b.users["owner"], w.a.users["viewer"]):
        db = AgentDb(w.stack.rest, w.stack.anon_key, stranger.token, run_id)
        with pytest.raises(errors.RunDenied):
            db.write_evidence("x", text="not mine")
        with pytest.raises(errors.RunDenied):
            db.record_usage("x", dataclasses.replace(selftest_responses()[0].usage))
    with pytest.raises(errors.RunExpired):  # a token the data layer rejects: the run cannot go on
        AgentDb(w.stack.rest, w.stack.anon_key, "not-a-jwt", run_id).finish("failed", "tool_failed")


# ==== 5. retries, crashes ====
def test_a_second_runner_for_a_finished_run_leaves_it_alone(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    run_id = start(api, sales, w.a).json()["id"]
    run = wait_run(api.client, w.a, sales, run_id)
    assert run["status"] == "succeeded"
    before = (run["writes_used"], run["tool_calls_used"], run["input_tokens_used"])
    db = AgentDb(w.stack.rest, w.stack.anon_key, sales.token, uuid.UUID(run_id))
    provider = FakeProvider(selftest_script())
    assert AgentRunner(db=db, llm=provider, spec=SELFTEST).run().status == "not_running"
    assert provider.requests == [], "the model was not even called"
    after = api.client.get(url(w.a, f"/agent-runs/{run_id}"), headers=bearer(sales)).json()
    assert (after["writes_used"], after["tool_calls_used"], after["input_tokens_used"]) == before


def test_a_crash_between_turns_is_resumed_by_a_second_runner_without_duplicates(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    company = OWN[w.a.id]["company"]

    class Crash(BaseException):
        pass

    def crash(_: LlmRequest) -> LlmResponse:
        raise Crash

    # create a run through the API whose executor is a no-op, so the test owns its execution
    noop = AgentsRuntime(
        repository=PostgrestAgentRunsRepository(w.stack.rest, w.stack.anon_key),
        executor=ThreadRunExecutor(lambda task: None, max_workers=1, max_queue=1),
        unavailable=None,
    )
    for client in app_client(w.stack):
        client.app.state.runtime = dataclasses.replace(client.app.state.runtime, agents=noop)  # type: ignore[attr-defined]
        run_id = uid()
        r = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": run_id,
                "agent": "selftest",
                "target_kind": "company",
                "target_id": company,
            },
            headers=bearer(sales),
        )
        assert r.status_code == 202, r.text
        db = AgentDb(w.stack.rest, w.stack.anon_key, sales.token, uuid.UUID(run_id))
        first = FakeProvider([*selftest_script()[:2], crash])
        with pytest.raises(Crash):
            AgentRunner(db=db, llm=first, spec=SELFTEST).run()
        mid = client.get(url(w.a, f"/agent-runs/{run_id}"), headers=bearer(sales)).json()
        assert mid["status"] == "running" and mid["writes_used"] == 3
        out = AgentRunner(db=db, llm=FakeProvider(selftest_script()), spec=SELFTEST).run()
        assert out.status == "succeeded"
        done = client.get(url(w.a, f"/agent-runs/{run_id}"), headers=bearer(sales)).json()
        assert done["status"] == "succeeded" and done["writes_used"] == 3, (
            "no second note, no extra claim"
        )
        assert done["input_tokens_used"] == 300, "replayed usage was not charged twice"
    claims = [
        c
        for c in w.client.get(
            url(w.a, f"/companies/{company}/claims"), headers=bearer(sales)
        ).json()
        if c["agent_run_id"] == run_id
    ]
    assert len(claims) == 2


# ==== 6. kill flags, a lost role, a busy pool: runs gated mid-way ====
def gated_script(gate: threading.Event, reached: threading.Event) -> list[Step]:
    """Turn 1 writes the note; turn 2 WAITS at `gate` (the test changes the world meanwhile),
    then asks for observations."""
    steps = selftest_responses()

    def turn_two(_: LlmRequest) -> LlmResponse:
        reached.set()
        assert gate.wait(30), "the test never released the gate"
        return steps[1]

    return [steps[0], turn_two, steps[2]]


def gated_rig(
    stack: Any, gate: threading.Event, reached: threading.Event, **pool: int
) -> Iterator[TestClient]:
    yield from app_client(stack, lambda: FakeProvider(gated_script(gate, reached)), **pool)


def test_a_cancel_while_the_model_is_thinking_stops_the_run_before_it_writes_again(
    operator_on: World,
) -> None:
    w, sales, owner = operator_on, operator_on.a.users["sales"], operator_on.a.users["owner"]
    gate, reached = threading.Event(), threading.Event()
    for client in gated_rig(w.stack, gate, reached):
        run_id = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": uid(),
                "agent": "selftest",
                "target_kind": "company",
                "target_id": OWN[w.a.id]["company"],
            },
            headers=bearer(sales),
        ).json()["id"]
        assert reached.wait(30)
        c = client.post(url(w.a, f"/agent-runs/{run_id}/cancel"), headers=bearer(owner))
        assert c.status_code == 200 and c.json() == {"status": "cancelled", "replayed": False}
        assert (
            client.post(url(w.a, f"/agent-runs/{run_id}/cancel"), headers=bearer(owner)).json()[
                "replayed"
            ]
            is True
        )
        gate.set()
        run = wait_run(client, w.a, sales, run_id, done=lambda r: r["status"] == "cancelled")
        time.sleep(1.0)  # let the worker reach its next write, which must be refused
        after = client.get(url(w.a, f"/agent-runs/{run_id}"), headers=bearer(sales)).json()
        assert after["status"] == "cancelled" and after["writes_used"] == run["writes_used"] == 1, (
            "only the note was written; the cancelled run wrote nothing more"
        )
        claims = client.get(
            url(w.a, f"/companies/{OWN[w.a.id]['company']}/claims"), headers=bearer(sales)
        ).json()
        assert not [x for x in claims if x["agent_run_id"] == run_id]


def test_turning_the_platform_switch_off_kills_a_run_in_flight(operator_on: World) -> None:
    w, sales = operator_on, operator_on.a.users["sales"]
    gate, reached = threading.Event(), threading.Event()
    for client in gated_rig(w.stack, gate, reached):
        run_id = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": uid(),
                "agent": "selftest",
                "target_kind": "company",
                "target_id": OWN[w.a.id]["company"],
            },
            headers=bearer(sales),
        ).json()["id"]
        assert reached.wait(30)
        operator_sql.sql(
            "update public.platform_flags set enabled = false where key = 'agents_enabled'"
        )
        try:
            gate.set()
            run = wait_run(client, w.a, sales, run_id)
        finally:
            operator_sql.sql(
                "update public.platform_flags set enabled = true where key = 'agents_enabled'"
            )
        assert run["status"] == "killed" and run["error_code"] == "killed", run
        assert run["writes_used"] == 1, "nothing was written after the switch went off"


def test_a_starter_who_loses_the_role_mid_run_writes_nothing_more(
    operator_on: World, signup: Any
) -> None:
    w, owner = operator_on, operator_on.a.users["owner"]
    newcomer = signup("agent-api-newcomer")
    added = pg(
        w.stack,
        owner,
        "POST",
        "/memberships",
        json={"tenant_id": w.a.id, "user_id": str(newcomer.id), "role": "sales"},
        representation=False,
    )
    assert added.status_code == 201, added.text
    gate, reached = threading.Event(), threading.Event()
    for client in gated_rig(w.stack, gate, reached):
        run_id = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": uid(),
                "agent": "selftest",
                "target_kind": "company",
                "target_id": OWN[w.a.id]["company"],
            },
            headers=bearer(newcomer),
        ).json()["id"]
        assert reached.wait(30)
        removed = pg(
            w.stack,
            owner,
            "DELETE",
            f"/memberships?tenant_id=eq.{w.a.id}&user_id=eq.{newcomer.id}",
            representation=False,
        )
        assert removed.status_code in (200, 204)
        gate.set()
        time.sleep(2.0)
        # the removed user can no longer see the run; the Owner can: it never got past the
        # note, and is cancellable
        seen = client.get(url(w.a, f"/agent-runs/{run_id}"), headers=bearer(owner)).json()
        assert seen["writes_used"] == 1 and seen["status"] == "running", seen
        claims = client.get(
            url(w.a, f"/companies/{OWN[w.a.id]['company']}/claims"), headers=bearer(owner)
        ).json()
        assert not [c for c in claims if c["agent_run_id"] == run_id]
        assert (
            client.post(url(w.a, f"/agent-runs/{run_id}/cancel"), headers=bearer(owner)).json()[
                "status"
            ]
            == "cancelled"
        )


def test_a_full_pool_refuses_a_start_and_creates_no_run(operator_on: World) -> None:
    w, sales = operator_on, operator_on.a.users["sales"]
    gate, reached = threading.Event(), threading.Event()
    for client in gated_rig(w.stack, gate, reached, workers=1, queue=0):
        first = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": uid(),
                "agent": "selftest",
                "target_kind": "company",
                "target_id": OWN[w.a.id]["company"],
            },
            headers=bearer(sales),
        )
        assert first.status_code == 202 and reached.wait(30)
        second_id = uid()
        second = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": second_id,
                "agent": "selftest",
                "target_kind": "company",
                "target_id": OWN[w.a.id]["company"],
            },
            headers=bearer(sales),
        )
        assert second.status_code == 503 and second.json()["error"]["code"] == "agents_busy"
        assert (
            client.get(url(w.a, f"/agent-runs/{second_id}"), headers=bearer(sales)).status_code
            == 404
        )
        gate.set()
        wait_run(client, w.a, sales, first.json()["id"])


def test_the_hourly_start_cap_is_a_429_with_a_fixed_message(operator_on: World, api: Rig) -> None:
    w, sales = operator_on, operator_on.a.users["sales"]
    saved = operator_sql.sql(
        "select limit_value from public.agent_limits where limit_key = 'max_runs_per_hour'"
    )
    try:
        operator_sql.sql(
            "update public.agent_limits set limit_value = (select count(*) + 1 from public.agent_runs "
            f"where tenant_id = '{w.a.id}' and created_at > now() - interval '1 hour') where limit_key = 'max_runs_per_hour'"
        )
        ok = start(api, sales, w.a)
        assert ok.status_code == 202, ok.text
        wait_run(api.client, w.a, sales, ok.json()["id"])
        over = start(api, sales, w.a)
        assert over.status_code == 429 and over.json()["error"] == {
            "code": "run_limit_reached",
            "message": "Too many agent runs. Try again later.",
        }
    finally:
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved)} where limit_key = 'max_runs_per_hour'"
        )


# ==== 7. a model that OBEYS an injection cannot leave its scope ====
def test_an_obeying_model_changes_nothing_outside_its_run_note_and_observations(
    operator_on: World,
) -> None:
    w, sales = operator_on, operator_on.a.users["sales"]
    foreign_company, foreign_run = OWN[w.b.id]["company"], uid()

    def script() -> FakeProvider:
        return FakeProvider(
            [
                respond(
                    call("write_note", text="ok", tenant_id=w.b.id, company_id=foreign_company),
                    call("agent_write_evidence", p_run_id=foreign_run, p_snippet="steered"),
                    call("send_email", to="someone@example.test"),
                    call("update_price", amount=1),
                    call("write_note", text="the real note", run_id=foreign_run),
                ),
                respond(call("write_note", text="the real note")),
                respond(
                    call(
                        "write_observation", value="steered", stance="supports", evidence_id=uid()
                    ),
                    call("write_observation", value="allowed observation", stance="supports"),
                ),
                final(),
            ]
        )

    before_b = operator_sql.sql(
        f"select (select count(*) from public.evidence where tenant_id = '{w.b.id}') || '/' || (select count(*) from public.claims where tenant_id = '{w.b.id}') || '/' || (select count(*) from public.agent_runs where tenant_id = '{w.b.id}')"
    )
    for client in app_client(w.stack, script):
        run_id = client.post(
            url(w.a, "/agent-runs"),
            json={
                "id": uid(),
                "agent": "selftest",
                "target_kind": "company",
                "target_id": OWN[w.a.id]["company"],
            },
            headers=bearer(sales),
        ).json()["id"]
        run = wait_run(client, w.a, sales, run_id)
        assert run["status"] == "succeeded", run
        assert run["writes_used"] == 2, (
            "one note and the one allowed observation; everything else was refused"
        )
        assert run["tool_calls_used"] >= 5, "the refused calls are counted"
    after_b = operator_sql.sql(
        f"select (select count(*) from public.evidence where tenant_id = '{w.b.id}') || '/' || (select count(*) from public.claims where tenant_id = '{w.b.id}') || '/' || (select count(*) from public.agent_runs where tenant_id = '{w.b.id}')"
    )
    assert after_b == before_b, "nothing happened in the other tenant"
    rows = operator_sql.sql(
        f"select string_agg(distinct created_via::text || ':' || confidence::text, ',') from public.claims where agent_run_id = '{run_id}'"
    )
    assert rows == "agent:unverified"
    steps = operator_sql.sql(
        f"select string_agg(distinct tool_name, ',' order by tool_name) from public.agent_run_steps where run_id = '{run_id}'"
    )
    assert steps == "agent_write_claim,agent_write_evidence,refused_call,usage", steps
    assert "send_email" not in steps and "update_price" not in steps, (
        "the ledger never holds a model's tool name"
    )


# ==== 8. concurrency over HTTP ====
def test_twenty_concurrent_starts_of_one_id_make_one_run(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    run_id = uid()
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _: start(api, sales, w.a, id=run_id).status_code, range(20)))
    assert set(results) <= {200, 202, 409, 429, 503}, results
    assert results.count(202) == 1, results
    run = wait_run(api.client, w.a, sales, run_id)
    assert run["status"] == "succeeded" and run["writes_used"] == 3
    assert operator_sql.sql(f"select count(*) from public.agent_runs where id = '{run_id}'") == "1"


def test_the_agent_endpoints_never_echo_a_token_or_a_database_message(api: Rig) -> None:
    w, sales = api.world, api.world.a.users["sales"]
    bad = api.client.post(
        url(w.a, "/agent-runs"),
        content=b"{not json",
        headers={**bearer(sales), "Content-Type": "application/json"},
    )
    assert bad.status_code == 422 and sales.token not in bad.text
    r = start(api, sales, w.a, target_id="00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404 and sales.token not in r.text


# ==== 9. unaccepted agent EVIDENCE never changes a score (queue and label snapshot, real
# reader) ====
ICP_TEMPLATE = json.loads(
    (ROOT / "config" / "icp" / "silk-wholesale.v1.json").read_text(encoding="utf-8")
)


def queue_score(api: Rig, user: User, t: Tenant, lead_id: str) -> int:
    """The lead's score as the REVIEW QUEUE computes it (unblinded view, real reader)."""
    cursor: str | None = None
    for _ in range(30):
        r = api.client.get(
            url(t, "/leads/review-queue"),
            params={"blind": "false", "limit": 100, **({"cursor": cursor} if cursor else {})},
            headers=bearer(user),
        )
        assert r.status_code == 200, r.text
        page = r.json()
        for item in page["items"]:
            if item["lead_id"] == lead_id:
                assert isinstance(item["score"], int)
                return int(item["score"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    pytest.fail("the lead is not in the review queue")


def label_score(api: Rig, user: User, t: Tenant, lead_id: str) -> int:
    """The lead's score as the LABEL SNAPSHOT computes it (every label stores the score it was
    made with)."""
    r = api.client.post(
        url(t, f"/leads/{lead_id}/labels"),
        json={"id": uid(), "label": "maybe"},
        headers=bearer(user),
    )
    assert r.status_code == 201, r.text
    return int(r.json()["score"])


def test_unaccepted_agent_evidence_does_not_change_a_score_and_accepted_evidence_does(
    api: Rig,
) -> None:
    w, sales, owner = api.world, api.world.a.users["sales"], api.world.a.users["owner"]
    lead = OWN[w.a.id]["lead"]
    published = api.client.post(
        url(w.a, "/icp-configs"), json={"config": ICP_TEMPLATE}, headers=bearer(owner)
    )
    assert published.status_code == 201, published.text
    before_queue, before_label = (
        queue_score(api, sales, w.a, lead),
        label_score(api, sales, w.a, lead),
    )
    assert before_queue == before_label

    # an agent run on the LEAD writes a note linked to the lead and two claims citing it
    run_id = start(api, sales, w.a, target_kind="lead", target_id=lead).json()["id"]
    assert wait_run(api.client, w.a, sales, run_id)["status"] == "succeeded"
    assert (
        operator_sql.sql(
            f"select count(*) from public.evidence_links where lead_id = '{lead}' and agent_run_id = '{run_id}'"
        )
        == "1"
    ), "the agent note is attached to the lead"
    assert queue_score(api, sales, w.a, lead) == before_queue, (
        "queue: unaccepted agent evidence changes nothing"
    )
    assert label_score(api, sales, w.a, lead) == before_label, "label snapshot: the same"

    claims = [
        c
        for c in api.client.get(url(w.a, f"/leads/{lead}/claims"), headers=bearer(sales)).json()
        if c["agent_run_id"] == run_id
    ]
    supports = next(c for c in claims if "one" in c["value"])
    context = next(c for c in claims if "two" in c["value"])
    # a claim accepted that cites the note only as CONTEXT does not make it count
    r = api.client.post(
        url(w.a, f"/claims/{context['id']}/reviews"),
        json={"id": uid(), "decision": "accepted", "confidence": "low"},
        headers=bearer(owner),
    )
    assert r.status_code == 201, r.text
    assert queue_score(api, sales, w.a, lead) == before_queue
    # accepted with a supporting link: the note counts, in both readers
    r = api.client.post(
        url(w.a, f"/claims/{supports['id']}/reviews"),
        json={"id": uid(), "decision": "accepted", "confidence": "medium"},
        headers=bearer(owner),
    )
    assert r.status_code == 201, r.text
    after_queue, after_label = (
        queue_score(api, sales, w.a, lead),
        label_score(api, sales, w.a, lead),
    )
    assert after_queue == after_label == before_queue + 4, (
        "the evidence-quality factor's 'any evidence' points"
    )
    # rejected afterwards: it stops counting
    r = api.client.post(
        url(w.a, f"/claims/{supports['id']}/reviews"),
        json={"id": uid(), "decision": "rejected", "reason_code": "outdated"},
        headers=bearer(owner),
    )
    assert r.status_code == 201, r.text
    assert queue_score(api, sales, w.a, lead) == label_score(api, sales, w.a, lead) == before_queue


def test_a_link_citing_a_claim_under_review_is_not_blocked_by_the_review_lock(api: Rig) -> None:
    """review_claim locks the claim FOR NO KEY UPDATE: concurrent reviews still serialise, but an
    insert that only REFERENCES
        the claim (a link citing it) does not wait for the review to finish."""
    w, sales, admin = api.world, api.world.a.users["sales"], api.world.a.users["admin"]
    run_id = start(api, sales, w.a).json()["id"]
    wait_run(api.client, w.a, sales, run_id)
    claim = next(
        c
        for c in api.client.get(
            url(w.a, f"/companies/{OWN[w.a.id]['company']}/claims"), headers=bearer(sales)
        ).json()
        if c["agent_run_id"] == run_id
    )
    evidence, link_id = uid(), uid()
    reference = (
        "insert into public.evidence (id, tenant_id, kind, provider, reference) "
        f"values ('{evidence}', '{w.a.id}', 'note', 'manual', 'ref:lock-test'); "
        "insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) "
        f"values ('{link_id}', '{w.a.id}', '{evidence}', '{claim['id']}', 'context');"
    )
    review = (
        f"select public.review_claim('{uid()}', '{claim['id']}', 'rejected', null, 'duplicate');"
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        held = pool.submit(
            operator_sql.sql_result,
            operator_sql.as_user(str(admin.id), review, hold_seconds=4.0),
        )
        time.sleep(1.5)  # the review holds its lock now
        started_at = time.monotonic()
        rc, out, err = operator_sql.sql_result(reference, timeout=30)
        waited = time.monotonic() - started_at
        assert held.result()[0] == 0
    assert rc == 0, err
    assert waited < 2.5, f"the reference waited {waited:.1f}s for the review's lock"
