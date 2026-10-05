"""PostgrestAgentRunsRepository over httpx.MockTransport: request shapes, SQLSTATE
classification, fixed messages.

Every read here has a real-stack twin in tests/integration/test_agent_runs_api.py: a mock
cannot see a column the view does not have (an earlier mock-only test missed exactly that)."""

from __future__ import annotations

import datetime as dt
import json
import logging
import uuid
from typing import Any

import httpx
import pytest

from app.agent_runs import repository as repo
from app.crm.repository import ConflictError, InvalidValueError, NotFoundError
from app.tenancy.repository import Forbidden, TokenRejected, UpstreamError

TENANT = uuid.UUID(int=0xA)
RUN = uuid.UUID(int=0xA11)
CLAIM = uuid.UUID(int=0xC1A1)
COMPANY = uuid.UUID(int=0xC1)
TOKEN = "TOKEN-CANARY-eyJ"
CANARY = "CANARY-0badf00d"
NOW = dt.datetime(2026, 10, 4, 12, 0, tzinfo=dt.UTC)


class Server:
    def __init__(self, *answers: tuple[int, Any]) -> None:
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.answers.pop(0) if self.answers else (200, [])
        return httpx.Response(status, json=body)


def make(server: Server) -> repo.PostgrestAgentRunsRepository:
    client = httpx.Client(
        base_url="http://rest.test/rest/v1", transport=httpx.MockTransport(server)
    )
    return repo.PostgrestAgentRunsRepository("http://rest.test/rest/v1", "anon", client=client)


RUN_ROW = {
    "id": str(RUN),
    "agent_name": "selftest",
    "agent_version": "selftest-1",
    "status": "running",
    "started_by": str(uuid.UUID(int=0x1002)),
    "company_id": str(COMPANY),
    "lead_id": None,
    "created_at": "2026-10-04T11:50:00+00:00",
    "expires_at": "2026-10-04T12:05:00+00:00",
    "finished_at": None,
    "error_code": None,
    "cancel_requested_at": None,
    "max_writes": 6,
    "writes_used": 1,
    "max_tool_calls": 20,
    "tool_calls_used": 2,
    "max_input_tokens": 20000,
    "input_tokens_used": 100,
    "max_output_tokens": 4000,
    "output_tokens_used": 50,
    "max_cost_micros": 250000,
    "cost_micros_used": 0,
}
CLAIM_ROW = {
    "id": str(CLAIM),
    "company_id": str(COMPANY),
    "lead_id": None,
    "predicate": "selftest.observation",
    "value": "DEMO",
    "confidence": "unverified",
    "claim_confidence": "unverified",
    "created_via": "agent",
    "agent_run_id": str(RUN),
    "created_by": str(uuid.UUID(int=0x1002)),
    "created_at": "2026-10-04T11:51:00+00:00",
    "review_state": "unreviewed",
    "review_confidence": None,
    "reviewed_by": None,
    "reviewed_at": None,
}


# ---- request shapes
def test_start_calls_the_function_with_a_run_id_and_no_tenant_derived_fields() -> None:
    server = Server(
        (
            200,
            {
                "run_id": str(RUN),
                "status": "running",
                "expires_at": "2026-10-04T12:05:00+00:00",
                "replayed": False,
            },
        )
    )
    result = make(server).start_run(
        TOKEN,
        TENANT,
        run_id=RUN,
        agent_name="selftest",
        agent_version="selftest-1",
        target_kind="company",
        target_id=COMPANY,
        input_sha256="a" * 64,
        input_refs={"company_id": str(COMPANY)},
    )
    req = server.requests[0]
    assert req.url.path == "/rest/v1/rpc/start_agent_run" and req.method == "POST"
    assert req.headers["authorization"] == f"Bearer {TOKEN}" and req.headers["apikey"] == "anon"
    assert json.loads(req.content) == {
        "p_run_id": str(RUN),
        "p_tenant_id": str(TENANT),
        "p_agent_name": "selftest",
        "p_agent_version": "selftest-1",
        "p_target_kind": "company",
        "p_target_id": str(COMPANY),
        "p_input_sha256": "a" * 64,
        "p_input_refs": {"company_id": str(COMPANY)},
    }
    assert result.run_id == RUN and result.replayed is False


def test_the_run_list_selects_columns_by_name_newest_first_with_a_probe_row() -> None:
    server = Server((200, [RUN_ROW]))
    page = make(server).list_runs(TOKEN, TENANT, limit=10, cursor=None)
    params = dict(server.requests[0].url.params)
    assert server.requests[0].url.path == "/rest/v1/agent_runs"
    assert params["tenant_id"] == f"eq.{TENANT}" and params["order"] == "created_at.desc,id.desc"
    assert params["limit"] == "11" and "input_sha256" not in params["select"]
    assert [r.id for r in page.items] == [RUN] and page.next_cursor is None


def test_a_full_page_has_a_cursor() -> None:
    rows = [{**RUN_ROW, "id": str(uuid.UUID(int=0x900 + i))} for i in range(3)]
    page = make(Server((200, rows))).list_runs(TOKEN, TENANT, limit=2, cursor=None)
    assert len(page.items) == 2 and page.next_cursor


def test_one_run_is_read_by_tenant_and_id() -> None:
    server = Server((200, [RUN_ROW]), (200, []))
    r = make(server)
    assert r.get_run(TOKEN, TENANT, RUN) is not None
    assert r.get_run(TOKEN, TENANT, RUN) is None
    params = dict(server.requests[0].url.params)
    assert params["tenant_id"] == f"eq.{TENANT}" and params["id"] == f"eq.{RUN}"


def test_settings_default_to_off_when_there_is_no_row() -> None:
    server = Server((200, []), (200, [{"enabled": True}]))
    r = make(server)
    assert r.get_enabled(TOKEN, TENANT).enabled is False
    assert r.get_enabled(TOKEN, TENANT).enabled is True
    assert server.requests[0].url.path == "/rest/v1/tenant_agent_settings"
    assert dict(server.requests[0].url.params)["select"] == "enabled"


def test_the_tenant_switch_is_a_function_call() -> None:
    server = Server((200, {"tenant_id": str(TENANT), "enabled": True}))
    assert make(server).set_enabled(TOKEN, TENANT, True).enabled is True
    assert server.requests[0].url.path == "/rest/v1/rpc/set_tenant_agents_enabled"
    assert json.loads(server.requests[0].content) == {"p_tenant_id": str(TENANT), "p_enabled": True}


def test_claims_come_from_the_effective_view_for_one_target_without_archived_rows() -> None:
    server = Server((200, [CLAIM_ROW]))
    claims = make(server).list_claims(
        TOKEN, TENANT, target_kind="company", target_id=COMPANY, limit=50
    )
    req = server.requests[0]
    params = dict(req.url.params)
    assert req.url.path == "/rest/v1/claims_effective"
    assert params["tenant_id"] == f"eq.{TENANT}" and params["home_company_id"] == f"eq.{COMPANY}"
    assert params["archived_at"] == "is.null" and params["limit"] == "50"
    assert "agent_run_id" in params["select"] and "review_state" in params["select"]
    assert claims[0].review_state == "unreviewed"
    lead_server = Server((200, []))
    make(lead_server).list_claims(TOKEN, TENANT, target_kind="lead", target_id=COMPANY, limit=5)
    lead_params = dict(lead_server.requests[0].url.params)
    assert lead_params["about_lead_id"] == f"eq.{COMPANY}" and "home_company_id" not in lead_params


def test_a_review_is_a_function_call_with_the_claim_and_the_decision_only() -> None:
    server = Server((200, {"review_id": str(RUN), "replayed": False, "self_review": True}))
    out = make(server).review_claim(
        TOKEN,
        review_id=RUN,
        claim_id=CLAIM,
        decision="accepted",
        confidence="low",
        reason_code=None,
    )
    assert out.self_review is True
    assert json.loads(server.requests[0].content) == {
        "p_review_id": str(RUN),
        "p_claim_id": str(CLAIM),
        "p_decision": "accepted",
        "p_confidence": "low",
        "p_reason_code": None,
    }


def test_cancel_is_a_function_call_by_run_id() -> None:
    server = Server((200, {"status": "cancelled", "replayed": False}))
    assert make(server).cancel_run(TOKEN, RUN).status == "cancelled"
    assert json.loads(server.requests[0].content) == {"p_run_id": str(RUN)}


# ---- effective status (lazy expiry)
def test_a_running_run_past_its_expiry_reads_as_expired_without_a_sweeper() -> None:
    past = {**RUN_ROW, "expires_at": "2026-10-04T11:55:00+00:00"}
    run = repo.parse_run(past, now=NOW)
    assert run.status == "expired"
    assert repo.parse_run(RUN_ROW, now=NOW).status == "running"
    done = {**past, "status": "succeeded", "finished_at": "2026-10-04T11:54:00+00:00"}
    assert repo.parse_run(done, now=NOW).status == "succeeded"
    cancelling = {**RUN_ROW, "cancel_requested_at": "2026-10-04T11:59:00+00:00"}
    assert repo.parse_run(cancelling, now=NOW).cancel_requested is True


# ---- classification, by SQLSTATE only
@pytest.mark.parametrize(
    ("status", "code", "hide", "expected"),
    [
        (403, "42501", False, Forbidden),
        (403, "42501", True, NotFoundError),
        (400, "SM204", False, repo.AgentsDisabledError),
        (400, "SM206", False, repo.RunLimitError),
        (400, "SM207", False, repo.CostCapError),
        (400, "SM202", False, repo.TokenExpiringError),
        (400, "SM201", False, repo.RunNotRunningError),
        (409, "23505", False, ConflictError),
        (409, "23503", False, NotFoundError),
        (400, "23514", False, InvalidValueError),
        (400, "22023", False, InvalidValueError),
        (401, "PGRST303", False, TokenRejected),
        (400, "22003", False, UpstreamError),
        (500, "XX000", False, UpstreamError),
        (400, "99999", False, UpstreamError),
        (400, "", False, UpstreamError),
    ],
)
def test_sqlstates_map_to_our_exceptions(
    status: int, code: str, hide: bool, expected: type[Exception]
) -> None:
    error = repo.classify_error(
        status, {"code": code, "message": CANARY, "details": CANARY}, hide_denial=hide
    )
    assert type(error) is expected


def test_an_unexpected_sqlstate_is_one_fixed_upstream_error_whatever_the_database_says(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    for body in (
        {"code": "22003", "message": f"value {CANARY} out of range", "details": CANARY},
        {"code": "XX000", "message": CANARY},
        {"message": CANARY},
        "not json " + CANARY,
        None,
    ):
        error = repo.classify_error(400, body, hide_denial=False)
        assert type(error) is UpstreamError and CANARY not in str(error)
    assert CANARY not in caplog.text


def test_transport_failures_are_upstream_errors_without_the_url_or_the_token(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"{request.url} {TOKEN}")

    client = httpx.Client(base_url="http://rest.test/rest/v1", transport=httpx.MockTransport(boom))
    r = repo.PostgrestAgentRunsRepository("http://rest.test/rest/v1", "anon", client=client)
    with pytest.raises(UpstreamError) as info:
        r.get_run(TOKEN, TENANT, RUN)
    assert (
        TOKEN not in str(info.value) and TOKEN not in caplog.text and "rest.test" not in caplog.text
    )


def test_a_row_of_the_wrong_shape_is_an_upstream_error_that_does_not_quote_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    bad = {**RUN_ROW, "status": CANARY}
    with pytest.raises(UpstreamError):
        make(Server((200, [bad]))).get_run(TOKEN, TENANT, RUN)
    assert CANARY not in caplog.text


# ---- the reviewer's list: each claim with its company's name and the evidence it cites (T007 M3)
EVIDENCE_ID = uuid.UUID(int=0xE1)
HOSTILE_QUOTE = '<script>alert(1)</script> "x" ‮ javascript:alert(1)'


def test_agent_claims_come_with_their_companys_name_and_the_evidence_they_cite() -> None:
    row = {**CLAIM_ROW, "home_company_id": str(COMPANY), "created_via": "agent"}
    server = Server(
        (200, [row]),
        (200, [{"claim_id": str(CLAIM), "evidence_id": str(EVIDENCE_ID), "stance": "supports"}]),
        (
            200,
            [
                {
                    "id": str(EVIDENCE_ID),
                    "kind": "web_page",
                    "provider": "agent.research",
                    "url": "https://saree-house.test/about?utm=1#top",
                    "snippet": HOSTILE_QUOTE,
                }
            ],
        ),
        (200, [{"id": str(COMPANY), "name": "Saree House"}]),
    )
    (claim,) = make(server).list_agent_claims(TOKEN, TENANT, state="unreviewed", limit=20)
    assert claim.company_name == "Saree House"
    (evidence,) = claim.evidence
    assert (evidence.host, evidence.path, evidence.stance) == (
        "saree-house.test",
        "/about",
        "supports",
    )
    assert evidence.quote == HOSTILE_QUOTE, "the quote is passed through verbatim, as data"
    claims_req, links_req, evidence_req, company_req = server.requests
    params = dict(claims_req.url.params)
    assert claims_req.url.path == "/rest/v1/claims_effective"
    assert params["created_via"] == "eq.agent" and params["review_state"] == "eq.unreviewed"
    assert params["archived_at"] == "is.null" and params["tenant_id"] == f"eq.{TENANT}"
    assert links_req.url.path == "/rest/v1/evidence_links"
    assert dict(links_req.url.params)["archived_at"] == "is.null"
    assert (
        evidence_req.url.path == "/rest/v1/evidence"
        and company_req.url.path == "/rest/v1/companies"
    )
    for req in server.requests:
        assert req.headers["authorization"] == f"Bearer {TOKEN}", "every read is the caller's own"
        assert dict(req.url.params)["tenant_id"] == f"eq.{TENANT}"


def test_state_all_does_not_filter_by_review_state_and_an_empty_list_asks_nothing_more() -> None:
    server = Server((200, []))
    assert make(server).list_agent_claims(TOKEN, TENANT, state="all", limit=5) == []
    assert "review_state" not in dict(server.requests[0].url.params)
    assert len(server.requests) == 1


def test_a_claim_without_evidence_or_company_still_lists() -> None:
    row = {**CLAIM_ROW, "home_company_id": None, "created_via": "agent"}
    server = Server((200, [row]), (200, []))
    (claim,) = make(server).list_agent_claims(TOKEN, TENANT, state="all", limit=5)
    assert claim.evidence == [] and claim.company_name is None


def test_a_url_that_does_not_parse_gives_no_host_and_the_quote_is_kept() -> None:
    row = {**CLAIM_ROW, "home_company_id": None, "created_via": "agent"}
    server = Server(
        (200, [row]),
        (200, [{"claim_id": str(CLAIM), "evidence_id": str(EVIDENCE_ID), "stance": "context"}]),
        (
            200,
            [
                {
                    "id": str(EVIDENCE_ID),
                    "kind": "web_page",
                    "provider": "agent.research",
                    "url": "http://[bad",
                    "snippet": "q",
                }
            ],
        ),
    )
    (claim,) = make(server).list_agent_claims(TOKEN, TENANT, state="all", limit=5)
    assert (claim.evidence[0].host, claim.evidence[0].path, claim.evidence[0].quote) == (
        None,
        None,
        "q",
    )


# ---- the Owner's view of today's spending (T007 M3b)
def test_the_cost_summary_is_one_function_call_with_the_callers_token_and_a_hidden_denial() -> None:
    body = {
        "day": "2026-10-04",
        "cap_micros": 2_000_000,
        "settled_micros": 400,
        "open_micros": 900,
        "open": [
            {
                "run_id": str(RUN),
                "step_key": "usage-2",
                "reserved_micros": 700,
                "run_status": "killed",
                "created_at": "2026-10-04T12:00:00+00:00",
            }
        ],
    }
    server = Server((200, body))
    out = make(server).cost_summary(TOKEN, TENANT)
    assert (out.settled_micros, out.open_micros, out.open[0].run_status) == (400, 900, "killed")
    req = server.requests[0]
    assert req.url.path == "/rest/v1/rpc/agent_cost_summary"
    assert json.loads(req.content) == {"p_tenant_id": str(TENANT)}
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    with pytest.raises(NotFoundError):  # a refusal reads as "not found": no oracle
        make(
            Server((403, {"code": "42501", "message": "agent action not permitted"}))
        ).cost_summary(TOKEN, TENANT)
    with pytest.raises(UpstreamError):
        make(Server((200, {"day": "x"}))).cost_summary(TOKEN, TENANT)
