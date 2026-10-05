"""The HTTP side of agent runs against in-memory fakes: authorization order, role matrix,
idempotent start and review, fixed error messages. (The database rules and RLS are proved
against the real stack in tests/integration/test_agent_runs_api.py.)"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.agent_runs.executor import RunTask
from app.agent_runs.repository import (
    AgentsDisabledError,
    CostCapError,
    RunLimitError,
    TokenExpiringError,
)
from app.agent_runs.wiring import AgentsRuntime
from app.agents import inputs
from app.crm.repository import ConflictError, InvalidValueError, NotFoundError
from app.tenancy.repository import Forbidden, UpstreamError
from tests.agent_runs_fakes import (
    FakeAgentRunsRepository,
    FakeExecutor,
    claim_row,
)
from tests.fakes import TENANT_A, TENANT_B, FakeCrmRepository, auth, make_client

COMPANY = uuid.UUID(int=0xC1)
LEAD = uuid.UUID(int=0x1EAD)
RUN = uuid.UUID(int=0xA11)
CLAIM = uuid.UUID(int=0xC1A1)
CANARY = "CANARY-5b0e77"


class World:
    def __init__(
        self,
        *,
        unavailable: str | None = None,
        with_executor: bool = True,
        research: bool = False,
    ) -> None:
        self.repo = FakeAgentRunsRepository()
        self.repo.enabled[TENANT_A.id] = True
        self.executor = FakeExecutor()
        self.crm = FakeCrmRepository()
        self.crm.seed(
            "companies",
            TENANT_A.id,
            COMPANY,
            name="DEMO Silk House",
            city="Mysuru",
            website="https://demo-silk.test/x",
        )
        self.crm.seed("leads", TENANT_A.id, LEAD, company_id=str(COMPANY))
        self.agents = AgentsRuntime(
            repository=self.repo,
            executor=self.executor if with_executor else None,
            unavailable=unavailable,
            research_available=research,
        )
        self.client, _ = make_client(crm=self.crm, agents=self.agents)

    def url(self, path: str, tenant: uuid.UUID = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}{path}"

    def body(self, **over: Any) -> dict[str, Any]:
        return {
            "id": str(RUN),
            "agent": "selftest",
            "target_kind": "company",
            "target_id": str(COMPANY),
            **over,
        }


@pytest.fixture
def w() -> World:
    return World()


def post_start(w: World, user: str = "a_sales", **over: Any) -> Any:
    return w.client.post(w.url("/agent-runs"), json=w.body(**over), headers=auth(user))


# ---- authorization order
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/agent-runs"),
        ("GET", "/agent-runs"),
        ("GET", f"/agent-runs/{RUN}"),
        ("POST", f"/agent-runs/{RUN}/cancel"),
        ("GET", "/agent-settings"),
        ("PUT", "/agent-settings"),
        ("GET", f"/companies/{COMPANY}/claims"),
        ("GET", f"/leads/{LEAD}/claims"),
        ("POST", f"/claims/{CLAIM}/reviews"),
    ],
)
def test_every_endpoint_needs_a_token_and_hides_a_foreign_tenant(
    w: World, method: str, path: str
) -> None:
    anon = w.client.request(method, w.url(path), json={})
    assert anon.status_code == 401
    foreign = w.client.request(method, w.url(path), json={}, headers=auth("b_owner"))
    assert foreign.status_code == 404
    assert foreign.json() == {"error": {"code": "not_found", "message": "Not found."}}


def test_the_role_matrix_for_starting_a_run(w: World) -> None:
    assert post_start(w, "a_viewer").status_code == 403
    for i, user in enumerate(("a_owner", "a_admin", "a_sales")):
        r = post_start(w, user, id=str(uuid.UUID(int=0x500 + i)))
        assert r.status_code == 202, (user, r.text)


def test_the_role_matrix_for_the_tenant_switch(w: World) -> None:
    for user in ("a_sales", "a_viewer"):
        r = w.client.put(w.url("/agent-settings"), json={"enabled": False}, headers=auth(user))
        assert r.status_code == 403
    for user in ("a_owner", "a_admin"):
        r = w.client.put(w.url("/agent-settings"), json={"enabled": False}, headers=auth(user))
        assert r.status_code == 200 and r.json() == {"enabled": False}
    for user in ("a_viewer", "a_sales"):
        assert w.client.get(w.url("/agent-settings"), headers=auth(user)).status_code == 200


def test_the_role_matrix_for_reviews(w: World) -> None:
    w.repo.seed_claim(TENANT_A.id, claim_row(CLAIM, COMPANY))
    body = {"id": str(uuid.uuid4()), "decision": "accepted", "confidence": "medium"}
    for user in ("a_sales", "a_viewer"):
        r = w.client.post(w.url(f"/claims/{CLAIM}/reviews"), json=body, headers=auth(user))
        assert r.status_code == 403, user
    assert not w.repo.reviews, "no review was attempted for the refused roles"
    for i, user in enumerate(("a_owner", "a_admin")):
        r = w.client.post(
            w.url(f"/claims/{CLAIM}/reviews"),
            json={**body, "id": str(uuid.UUID(int=0x700 + i))},
            headers=auth(user),
        )
        assert r.status_code == 201, (user, r.text)


# ---- start
def test_a_start_runs_nothing_inline_it_hands_the_run_and_the_callers_token_to_the_executor(
    w: World,
) -> None:
    headers = auth("a_sales")
    r = w.client.post(w.url("/agent-runs"), json=w.body(), headers=headers)
    assert r.status_code == 202
    out = r.json()
    assert out["id"] == str(RUN) and out["status"] == "running" and out["agent_name"] == "selftest"
    assert len(w.executor.tasks) == 1
    task: RunTask = w.executor.tasks[0]
    assert task.run_id == RUN
    assert task.token == headers["Authorization"].split(" ", 1)[1]
    assert task.token not in repr(task) and task.token not in str(task)


def test_the_input_hash_and_refs_are_computed_from_the_allowlisted_company_fields(w: World) -> None:
    captured: dict[str, Any] = {}
    original = w.repo.start_run

    def spy(*args: Any, **kwargs: Any) -> Any:
        captured.update(kwargs)
        return original(*args, **kwargs)

    w.repo.start_run = spy  # type: ignore[method-assign]
    assert post_start(w).status_code == 202
    expected = inputs.input_sha256(
        inputs.ModelInput("DEMO Silk House", "Mysuru", None, "demo-silk.test")
    )
    assert captured["input_sha256"] == expected
    assert captured["input_refs"] == {"company_id": str(COMPANY)}
    assert captured["agent_version"] == "selftest-1" and captured["agent_name"] == "selftest"


def test_a_lead_target_records_the_lead_and_hashes_its_companys_fields(w: World) -> None:
    captured: dict[str, Any] = {}
    original = w.repo.start_run

    def spy(*args: Any, **kwargs: Any) -> Any:
        captured.update(kwargs)
        return original(*args, **kwargs)

    w.repo.start_run = spy  # type: ignore[method-assign]
    r = post_start(w, target_kind="lead", target_id=str(LEAD))
    assert r.status_code == 202, r.text
    assert captured["input_refs"] == {"lead_id": str(LEAD), "company_id": str(COMPANY)}
    assert captured["input_sha256"] == inputs.input_sha256(
        inputs.ModelInput("DEMO Silk House", "Mysuru", None, "demo-silk.test")
    )


def test_the_research_agent_is_unavailable_unless_the_runtime_says_so(w: World) -> None:
    r = post_start(w, agent="research", target_kind="lead", target_id=str(LEAD))
    assert r.status_code == 503 and r.json()["error"]["code"] == "agents_unavailable"
    assert not w.executor.tasks and "start" not in w.repo.calls


def test_a_research_run_on_a_lead_queues_the_research_agent() -> None:
    w = World(research=True)
    r = post_start(w, agent="research", target_kind="lead", target_id=str(LEAD))
    assert r.status_code == 202, r.text
    (task,) = w.executor.tasks
    assert task.agent == "research" and task.run_id == RUN


def test_a_research_run_on_a_company_without_a_website_is_refused_before_any_run() -> None:
    w = World(research=True)
    w.crm.seed("companies", TENANT_A.id, uuid.UUID(int=0xC9), name="No Site Ltd")
    r = post_start(w, agent="research", target_kind="company", target_id=str(uuid.UUID(int=0xC9)))
    assert r.status_code == 409 and r.json()["error"]["code"] == "company_has_no_website"
    assert not w.executor.tasks and "start" not in w.repo.calls


def test_a_selftest_run_still_queues_the_selftest_agent(w: World) -> None:
    assert post_start(w).status_code == 202
    assert w.executor.tasks[0].agent == "selftest"


def test_a_lead_without_a_company_is_refused_before_any_run_exists(w: World) -> None:
    orphan = uuid.UUID(int=0x1E)
    w.crm.seed("leads", TENANT_A.id, orphan, company_id=None)
    r = post_start(w, target_kind="lead", target_id=str(orphan))
    assert r.status_code == 409 and r.json()["error"]["code"] == "lead_has_no_company", r.text
    assert not w.executor.tasks and "start" not in w.repo.calls, "no run, nothing queued"


def test_a_lead_whose_company_cannot_be_read_is_a_404_not_an_empty_run(w: World) -> None:
    ghost = uuid.UUID(int=0x1F)
    w.crm.seed("leads", TENANT_A.id, ghost, company_id=str(uuid.UUID(int=0xDEAD)))
    r = post_start(w, target_kind="lead", target_id=str(ghost))
    assert r.status_code == 404, r.text
    assert not w.executor.tasks and "start" not in w.repo.calls


def test_a_retry_with_the_same_id_is_a_replay_and_runs_nothing_twice(w: World) -> None:
    assert post_start(w).status_code == 202
    again = post_start(w)
    assert again.status_code == 200 and again.json()["id"] == str(RUN)
    assert len(w.executor.tasks) == 1


def test_the_same_id_with_another_target_is_a_conflict(w: World) -> None:
    assert post_start(w).status_code == 202
    w.crm.seed("companies", TENANT_A.id, uuid.UUID(int=0xC2), name="Other")
    other = post_start(w, target_id=str(uuid.UUID(int=0xC2)))
    assert other.status_code == 409 and other.json()["error"]["code"] == "conflict"
    assert len(w.executor.tasks) == 1


def test_a_missing_foreign_or_malformed_target_is_a_404(w: World) -> None:
    assert post_start(w, target_id=str(uuid.uuid4())).status_code == 404
    w.crm.seed("companies", TENANT_B.id, uuid.UUID(int=0xB1), name="B company")
    assert post_start(w, target_id=str(uuid.UUID(int=0xB1))).status_code == 404
    assert post_start(w, target_id="not-a-uuid").status_code == 422
    assert not w.executor.tasks and "start" not in w.repo.calls


def test_an_archived_target_cannot_be_started_on(w: World) -> None:
    import datetime as dt

    archived = uuid.UUID(int=0xC9)
    w.crm.seed(
        "companies",
        TENANT_A.id,
        archived,
        name="Old",
        archived_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC),
    )
    r = post_start(w, target_id=str(archived))
    assert r.status_code == 409 and r.json()["error"]["code"] == "archived"
    assert not w.executor.tasks and "start" not in w.repo.calls


def test_unknown_or_privileged_keys_are_rejected(w: World) -> None:
    for extra in (
        {"tenant_id": str(TENANT_A.id)},
        {"created_via": "manual"},
        {"started_by": str(uuid.uuid4())},
        {"agent_version": "x"},
        {"budgets": {"max_writes": 10**9}},
        {"model": "any"},
    ):
        r = post_start(w, **extra)
        assert r.status_code == 422, extra
    assert post_start(w, agent="other").status_code == 422
    assert not w.executor.tasks


def test_database_refusals_have_fixed_messages_and_no_database_text(w: World) -> None:
    cases: list[tuple[Exception, int, str]] = [
        (AgentsDisabledError("SM204"), 409, "agents_disabled"),
        (RunLimitError("SM206"), 429, "run_limit_reached"),
        (CostCapError("SM207"), 429, "cost_cap_reached"),
        (TokenExpiringError("SM202"), 409, "token_expiring"),
        (Forbidden("42501"), 403, "forbidden"),
        (InvalidValueError("23514"), 422, "invalid_value"),
        (UpstreamError(f"{CANARY} 22003 numeric value out of range"), 502, "upstream_error"),
    ]
    for error, status, code in cases:
        w.repo.start_error = error
        r = post_start(w)
        assert r.status_code == status, (error, r.text)
        assert r.json()["error"]["code"] == code
        assert CANARY not in r.text and "22003" not in r.text
    assert not w.executor.tasks


def test_a_workspace_without_the_switch_cannot_start(w: World) -> None:
    w.repo.enabled[TENANT_A.id] = False
    r = post_start(w)
    assert r.status_code == 409 and r.json()["error"]["code"] == "agents_disabled"


def test_when_the_runtime_is_unavailable_a_start_is_503_and_creates_nothing() -> None:
    for world in (World(unavailable="llm_not_configured"), World(with_executor=False)):
        r = post_start(world)
        assert r.status_code == 503 and r.json()["error"]["code"] == "agents_unavailable"
        assert "start" not in world.repo.calls
        # everything that only reads the database still works
        assert (
            world.client.get(world.url("/agent-runs"), headers=auth("a_owner")).status_code == 200
        )


def test_a_busy_executor_is_503_and_nothing_is_started(w: World) -> None:
    w.executor.busy = True
    r = post_start(w)
    assert r.status_code == 503 and r.json()["error"]["code"] == "agents_busy"
    assert "start" not in w.repo.calls


# ---- read, cancel, settings
def test_a_run_can_be_listed_read_and_cancelled(w: World) -> None:
    assert post_start(w).status_code == 202
    listed = w.client.get(w.url("/agent-runs"), headers=auth("a_sales")).json()
    assert [r["id"] for r in listed["items"]] == [str(RUN)] and listed["next_cursor"] is None
    one = w.client.get(w.url(f"/agent-runs/{RUN}"), headers=auth("a_sales"))
    assert one.status_code == 200 and one.json()["status"] == "running"
    assert (
        w.client.get(w.url(f"/agent-runs/{uuid.uuid4()}"), headers=auth("a_sales")).status_code
        == 404
    )
    assert w.client.get(w.url("/agent-runs/not-a-uuid"), headers=auth("a_sales")).status_code == 404
    cancelled = w.client.post(w.url(f"/agent-runs/{RUN}/cancel"), headers=auth("a_sales"))
    assert cancelled.status_code == 200 and cancelled.json() == {
        "status": "cancelled",
        "replayed": False,
    }
    again = w.client.post(w.url(f"/agent-runs/{RUN}/cancel"), headers=auth("a_sales"))
    assert again.json() == {"status": "cancelled", "replayed": True}


def test_cancelling_a_run_the_caller_cannot_see_is_a_404_and_asks_the_database_nothing(
    w: World,
) -> None:
    assert (
        w.client.post(
            w.url(f"/agent-runs/{uuid.uuid4()}/cancel"), headers=auth("a_viewer")
        ).status_code
        == 404
    )
    assert "cancel" not in w.repo.calls


def test_a_cancel_the_database_refuses_is_a_fixed_403(w: World) -> None:
    assert post_start(w).status_code == 202
    w.repo.cancel_error = Forbidden("42501")
    r = w.client.post(w.url(f"/agent-runs/{RUN}/cancel"), headers=auth("a_viewer"))
    assert r.status_code == 403 and CANARY not in r.text


# ---- claims and reviews
def test_claims_of_a_target_are_listed_with_their_review_state(w: World) -> None:
    w.repo.seed_claim(TENANT_A.id, claim_row(CLAIM, COMPANY))
    w.repo.seed_claim(
        TENANT_A.id,
        claim_row(
            uuid.UUID(int=0xC1A2),
            COMPANY,
            review_state="accepted",
            review_confidence="high",
            confidence="high",
        ),
    )
    r = w.client.get(w.url(f"/companies/{COMPANY}/claims"), headers=auth("a_viewer"))
    assert r.status_code == 200
    states = sorted(c["review_state"] for c in r.json())
    assert states == ["accepted", "unreviewed"]
    assert (
        w.client.get(
            w.url(f"/companies/{uuid.uuid4()}/claims"), headers=auth("a_viewer")
        ).status_code
        == 404
    )
    assert w.client.get(w.url(f"/leads/{LEAD}/claims"), headers=auth("a_viewer")).status_code == 200


def test_a_review_is_created_then_replayed_and_a_changed_replay_is_a_conflict(w: World) -> None:
    w.repo.seed_claim(TENANT_A.id, claim_row(CLAIM, COMPANY))
    rid = str(uuid.uuid4())
    body = {"id": rid, "decision": "accepted", "confidence": "low"}
    first = w.client.post(w.url(f"/claims/{CLAIM}/reviews"), json=body, headers=auth("a_owner"))
    assert first.status_code == 201 and first.json()["replayed"] is False
    again = w.client.post(w.url(f"/claims/{CLAIM}/reviews"), json=body, headers=auth("a_owner"))
    assert again.status_code == 200 and again.json()["replayed"] is True
    changed = w.client.post(
        w.url(f"/claims/{CLAIM}/reviews"),
        json={"id": rid, "decision": "rejected", "reason_code": "incorrect"},
        headers=auth("a_owner"),
    )
    assert changed.status_code == 409


def test_a_review_of_an_unknown_or_foreign_claim_is_a_404(w: World) -> None:
    w.repo.seed_claim(TENANT_B.id, claim_row(uuid.UUID(int=0xB1A1), COMPANY))
    body = {"id": str(uuid.uuid4()), "decision": "rejected", "reason_code": "duplicate"}
    for claim in (uuid.uuid4(), uuid.UUID(int=0xB1A1)):
        r = w.client.post(w.url(f"/claims/{claim}/reviews"), json=body, headers=auth("a_owner"))
        assert r.status_code == 404
    assert "review" not in w.repo.calls


@pytest.mark.parametrize(
    "bad",
    [
        {"decision": "accepted"},
        {"decision": "accepted", "confidence": "unverified"},
        {"decision": "accepted", "confidence": "low", "reason_code": "incorrect"},
        {"decision": "rejected"},
        {"decision": "rejected", "reason_code": "incorrect", "confidence": "low"},
        {"decision": "maybe", "confidence": "low"},
        {"decision": "accepted", "confidence": "low", "created_via": "manual"},
        {"decision": "accepted", "confidence": "low", "self_review": False},
    ],
)
def test_a_malformed_review_is_a_422(w: World, bad: dict[str, Any]) -> None:
    w.repo.seed_claim(TENANT_A.id, claim_row(CLAIM, COMPANY))
    r = w.client.post(
        w.url(f"/claims/{CLAIM}/reviews"),
        json={"id": str(uuid.uuid4()), **bad},
        headers=auth("a_owner"),
    )
    assert r.status_code == 422
    assert "review" not in w.repo.calls


def test_a_review_the_database_refuses_has_a_fixed_message(w: World) -> None:
    w.repo.seed_claim(TENANT_A.id, claim_row(CLAIM, COMPANY))
    w.repo.review_error = InvalidValueError("23514")
    body = {"id": str(uuid.uuid4()), "decision": "accepted", "confidence": "high"}
    r = w.client.post(w.url(f"/claims/{CLAIM}/reviews"), json=body, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_value"
    w.repo.review_error = ConflictError("23505")
    r = w.client.post(w.url(f"/claims/{CLAIM}/reviews"), json=body, headers=auth("a_owner"))
    assert r.status_code == 409
    w.repo.review_error = NotFoundError("42501")
    r = w.client.post(w.url(f"/claims/{CLAIM}/reviews"), json=body, headers=auth("a_owner"))
    assert r.status_code == 404


def test_the_callers_token_is_the_only_credential_the_repository_ever_sees(w: World) -> None:
    headers = auth("a_owner")
    token = headers["Authorization"].split(" ", 1)[1]
    w.client.post(w.url("/agent-runs"), json=w.body(), headers=headers)
    w.client.get(w.url("/agent-runs"), headers=headers)
    w.client.put(w.url("/agent-settings"), json={"enabled": True}, headers=headers)
    assert w.repo.tokens_seen and set(w.repo.tokens_seen) == {token}


def test_a_suggestion_says_whether_its_predicate_can_change_a_score(w: World) -> None:
    import json
    from pathlib import Path

    template = json.loads(
        (
            Path(__file__).resolve().parents[3] / "config" / "icp" / "silk-wholesale.v1.json"
        ).read_text()
    )
    w.repo.seed_claim(TENANT_A.id, claim_row(CLAIM, COMPANY))
    w.repo.seed_claim(
        TENANT_A.id,
        claim_row(uuid.UUID(int=0xC1A2), COMPANY, predicate="buyer_type", value="saree_shop"),
    )

    def flags() -> dict[str, bool]:
        r = w.client.get(w.url(f"/companies/{COMPANY}/claims"), headers=auth("a_viewer"))
        assert r.status_code == 200
        return {c["predicate"]: c["counts_toward_score"] for c in r.json()}

    unscored = {"selftest.observation": False, "buyer_type": False}
    assert flags() == unscored, "no profile: none scored"
    published = w.client.post(
        w.url("/icp-configs"), json={"config": template}, headers=auth("a_admin")
    )
    assert published.status_code == 201, published.text
    assert flags() == {"selftest.observation": False, "buyer_type": True}
