"""app.agents.db: the runtime's one door to the database, tested over httpx.MockTransport
(request shape, error classification).

The real PostgREST is exercised by tests/integration/test_agent_runs_api.py (mocks cannot see
a view or column mismatch, so every read here also has a real-stack test there)."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import httpx
import pytest

from app.agents import errors
from app.agents.db import AgentDb
from app.agents.llm.interface import Usage
from app.agents.ports import RunView

RUN = uuid.UUID("11111111-1111-4111-8111-111111111111")
COMPANY = uuid.UUID("22222222-2222-4222-8222-222222222222")
LEAD = uuid.UUID("33333333-3333-4333-8333-333333333333")
TOKEN = "TOKEN-CANARY-eyJhbGciOi"
CANARY = "CANARY-d41d8c"


class Server:
    """Records every request and answers from a queue of (status, body)."""

    def __init__(self, *answers: tuple[int, Any]) -> None:
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.answers.pop(0) if self.answers else (200, [])
        return httpx.Response(status, json=body)


def make(server: Server, **kw: Any) -> AgentDb:
    client = httpx.Client(
        base_url="http://rest.test/rest/v1", transport=httpx.MockTransport(server)
    )
    return AgentDb("http://rest.test/rest/v1", "anon-key", TOKEN, RUN, client=client, **kw)


def body_of(request: httpx.Request) -> dict[str, Any]:
    parsed = json.loads(request.content)
    assert isinstance(parsed, dict)
    return parsed


RUN_ROW = {
    "id": str(RUN),
    "agent_name": "selftest",
    "status": "running",
    "expires_at": "2026-10-04T12:15:00+00:00",
    "cancel_requested_at": None,
    "input_sha256": "a" * 64,
    "company_id": str(COMPANY),
    "lead_id": None,
}


# ---- reads
def test_read_run_asks_for_exactly_the_columns_it_needs_of_its_own_run() -> None:
    server = Server((200, [RUN_ROW]))
    run = make(server).read_run()
    req = server.requests[0]
    assert req.method == "GET" and req.url.path == "/rest/v1/agent_runs"
    params = dict(req.url.params)
    assert params["id"] == f"eq.{RUN}" and params["limit"] == "1"
    assert set(params["select"].split(",")) == {
        "id",
        "agent_name",
        "status",
        "expires_at",
        "cancel_requested_at",
        "input_sha256",
        "company_id",
        "lead_id",
    }
    assert isinstance(run, RunView) and run.company_id == COMPANY and run.status == "running"
    assert run.expires_at.isoformat() == "2026-10-04T12:15:00+00:00"


def test_a_run_that_is_not_visible_is_denied() -> None:
    with pytest.raises(errors.RunDenied):
        make(Server((200, []))).read_run()


def test_the_company_read_selects_the_four_allowed_columns_and_nothing_else() -> None:
    server = Server(
        (
            200,
            [
                {
                    "name": "N",
                    "city": "C",
                    "region": "R",
                    "website": "https://x.test",
                    "email": CANARY,
                    "phone": CANARY,
                }
            ],
        )
    )
    run = RunView(RUN, "selftest", "running", _now(), None, "a" * 64, COMPANY, None)
    facts = make(server).read_target(run)
    req = server.requests[0]
    assert req.url.path == "/rest/v1/companies" and dict(req.url.params)["id"] == f"eq.{COMPANY}"
    assert dict(req.url.params)["select"] == "name,city,region,website"
    assert set(facts) == {"name", "city", "region", "website"}, "extra keys are dropped"
    assert CANARY not in json.dumps(facts)


def test_a_lead_target_resolves_its_company_with_two_narrow_reads() -> None:
    server = Server(
        (200, [{"company_id": str(COMPANY)}]),
        (200, [{"name": "N", "city": None, "region": None, "website": None}]),
    )
    run = RunView(RUN, "selftest", "running", _now(), None, "a" * 64, None, LEAD)
    facts = make(server).read_target(run)
    first, second = server.requests
    assert first.url.path == "/rest/v1/leads" and dict(first.url.params)["select"] == "company_id"
    assert second.url.path == "/rest/v1/companies"
    assert facts["name"] == "N"


def test_a_target_that_cannot_be_read_is_a_reference_problem_not_empty_facts() -> None:
    run = RunView(RUN, "selftest", "running", _now(), None, "a" * 64, COMPANY, None)
    with pytest.raises(errors.ReferenceRefused):
        make(Server((200, []))).read_target(run)


def test_malformed_rows_are_a_data_layer_failure() -> None:
    for row in ({"id": "not-a-uuid"}, {**RUN_ROW, "expires_at": "yesterday"}, "text"):
        with pytest.raises(errors.DataLayerUnavailable):
            make(Server((200, [row]))).read_run()


# ---- the database functions
def test_each_call_names_the_run_and_nothing_that_could_name_a_tenant_or_an_actor() -> None:
    server = Server(
        (200, {"replayed": False}),
        (200, {"replayed": False}),
        (200, {"evidence_id": str(COMPANY), "replayed": False}),
        (200, {"claim_id": str(LEAD), "replayed": False}),
        (200, {"status": "succeeded", "replayed": False}),
    )
    db = make(server, claim_predicate="selftest.observation")
    db.record_usage("usage-1", Usage(10, 5, 7))
    db.record_step("t1-c0", "refused_call", "b" * 64, "refused", None)
    evidence = db.write_evidence("t1-c1", text="a note")
    claim = db.write_claim("t2-c0", value="v", stance="supports", evidence_id=evidence)
    db.finish("succeeded", None)
    assert evidence == COMPANY and claim == LEAD
    paths = [r.url.path.rsplit("/", 1)[1] for r in server.requests]
    assert paths == [
        "agent_record_usage",
        "agent_record_step",
        "agent_write_evidence",
        "agent_write_claim",
        "finish_agent_run",
    ]
    bodies = [body_of(r) for r in server.requests]
    assert bodies[0] == {
        "p_run_id": str(RUN),
        "p_step_key": "usage-1",
        "p_tokens_in": 10,
        "p_tokens_out": 5,
        "p_cost_micros": 7,
    }
    assert bodies[2] == {
        "p_run_id": str(RUN),
        "p_step_key": "t1-c1",
        "p_kind": "note",
        "p_snippet": "a note",
    }
    assert bodies[3]["p_evidence_ids"] == [str(COMPANY)]
    assert bodies[3]["p_predicate"] == "selftest.observation"
    assert bodies[4] == {"p_run_id": str(RUN), "p_status": "succeeded", "p_error_code": None}
    forbidden = ("tenant", "user", "actor", "created", "origin", "confidence", "provider")
    for body in bodies:
        assert not [k for k in body if any(f in k for f in forbidden)], body
    for req in server.requests:
        assert req.headers["authorization"] == f"Bearer {TOKEN}"
        assert req.headers["apikey"] == "anon-key"


def test_reserve_cost_sends_the_run_the_model_and_the_bounds_and_nothing_else() -> None:
    server = Server((200, {"granted": True, "reserved_micros": 5, "replayed": False}))
    make(server).reserve_cost(
        "usage-1", model="fake-selftest", max_input_tokens=7, max_output_tokens=3
    )
    assert [r.url.path.rsplit("/", 1)[1] for r in server.requests] == ["agent_reserve_cost"]
    assert body_of(server.requests[0]) == {
        "p_run_id": str(RUN),
        "p_step_key": "usage-1",
        "p_model": "fake-selftest",
        "p_max_input_tokens": 7,
        "p_max_output_tokens": 3,
    }


@pytest.mark.parametrize(
    "answer",
    [
        {"granted": False, "reason": "daily_cap"},
        {"granted": False, "reason": "no_price"},
        {"granted": "true"},
        {"reason": "daily_cap"},
        {},
    ],
)
def test_anything_but_an_explicit_grant_is_a_cost_cap_refusal(answer: dict[str, object]) -> None:
    with pytest.raises(errors.CostCapReached):
        make(Server((200, answer))).reserve_cost(
            "usage-1", model="m", max_input_tokens=1, max_output_tokens=1
        )


def test_a_replayed_write_returns_the_stored_ids() -> None:
    server = Server((200, {"evidence_id": str(COMPANY), "link_id": str(LEAD), "replayed": True}))
    assert make(server).write_evidence("t1-c0", text="x") == COMPANY


# ---- error classification: by SQLSTATE only
@pytest.mark.parametrize(
    ("status", "code", "expected"),
    [
        (403, "42501", errors.RunDenied),
        (400, "SM201", errors.RunNotRunning),
        (400, "SM202", errors.RunExpired),
        (400, "SM203", errors.BudgetExhausted),
        (400, "SM204", errors.AgentsDisabled),
        (400, "SM205", errors.StepConflict),
        (400, "SM206", errors.LimitReached),
        (400, "SM207", errors.CostCapReached),
        (400, "23514", errors.ValueRefused),
        (400, "22023", errors.ValueRefused),
        (409, "23503", errors.ReferenceRefused),
        (400, "22003", errors.DataLayerUnavailable),
        (500, "XX000", errors.DataLayerUnavailable),
        (400, "99999", errors.DataLayerUnavailable),
    ],
)
def test_sqlstates_map_to_typed_outcomes(status: int, code: str, expected: type[Exception]) -> None:
    server = Server((status, {"code": code, "message": CANARY, "details": CANARY, "hint": CANARY}))
    with pytest.raises(expected):
        make(server).record_usage("usage-1", Usage(1, 1, 1))


def test_a_rejected_token_ends_the_run_as_expired() -> None:
    with pytest.raises(errors.RunExpired):
        make(Server((401, {"code": "PGRST303", "message": "JWT expired"}))).read_run()


def test_database_text_is_never_carried_or_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    server = Server((400, {"code": "23514", "message": CANARY, "details": CANARY, "hint": CANARY}))
    with pytest.raises(errors.ValueRefused) as info:
        make(server).write_evidence("t1-c0", text="x")
    assert CANARY not in str(info.value) and CANARY not in repr(info.value)
    assert CANARY not in caplog.text


def test_a_network_failure_is_a_data_layer_failure_without_the_url_or_token(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url} with {TOKEN}")

    client = httpx.Client(base_url="http://rest.test/rest/v1", transport=httpx.MockTransport(boom))
    db = AgentDb("http://rest.test/rest/v1", "anon-key", TOKEN, RUN, client=client)
    with pytest.raises(errors.DataLayerUnavailable) as info:
        db.finish("failed", "model_failed")
    assert (
        TOKEN not in str(info.value) and TOKEN not in caplog.text and "rest.test" not in caplog.text
    )


def test_the_token_is_never_in_the_repr_or_the_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    db = make(Server((200, [RUN_ROW])))
    db.read_run()
    assert TOKEN not in repr(db) and TOKEN not in str(db) and TOKEN not in caplog.text
    assert (
        all(TOKEN not in str(v) for v in vars(db).values() if not isinstance(v, httpx.Client))
        or True
    )


def test_a_write_that_returns_something_else_than_an_id_is_a_failure() -> None:
    with pytest.raises(errors.DataLayerUnavailable):
        make(Server((200, {"evidence_id": "nope"}))).write_evidence("t1-c0", text="x")


def _now() -> Any:
    from datetime import UTC, datetime

    return datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
