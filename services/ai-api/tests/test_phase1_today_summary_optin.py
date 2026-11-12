"""GET /v1/tenants/{id}/today/summary, the opt-in sections (`include=`) and `setup_progress` (`checks=`): nothing here runs unless the caller names it.

Same stub-app approach as test_phase1_today_summary.py: a stub answers the real paths, the summary reaches them through the ASGI loopback."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.bootstrap import today_summary
from app.hardening.admission import PageGuardMiddleware

T = str(uuid.uuid4())
AUTH = {"Authorization": "Bearer token-one"}
CALLS: list[str] = []
ANSWERS: dict[str, Any] = {}
DELAYS: dict[str, float] = {}
ACTIVE = {"now": 0, "max": 0}

FACT_PATHS = (
    "/profile", "/institution/profile", "/institution/students", "/institution/fee-plans", "/campaigns", "/lead-sources", "/lead-imports", "/outreach/rules", "/tasks",
    "/materials/policy", "/materials/items", "/catalogue/items", "/quote-policy-versions", "/whatsapp/account", "/materials/quotes", "/modules",
)   # the wave-1 paths /quotes and /tasks come from wave1()
EVERYTHING_SET: dict[str, Any] = {
    "/profile": (200, {"name": "Shop", "town": "Guntur"}),
    "/institution/profile": (200, {"configured": True}),
    "/institution/students": (200, {"items": [{"id": 1}], "next_cursor": None}),
    "/institution/fee-plans": (200, {"items": [{"id": 1}]}),
    "/campaigns": (200, {"items": [{"status": "draft"}, {"status": "approved"}]}),
    "/lead-sources": (200, {"items": []}),
    "/lead-imports": (200, {"items": [{"id": 1}]}),
    "/outreach/rules": (200, [{"id": 1}]),
    "/tasks": (200, [{"id": 1}]),
    "/materials/policy": (200, {"current": {"v": 1}, "versions": []}),
    "/catalogue/items": (200, {"items": [{"id": 1}]}),
    "/materials/items": (200, {"items": []}),
    "/quote-policy-versions": (200, [{"id": 1}]),
    "/whatsapp/account": (200, {"configured": True, "status": "active"}),
    "/quotes": (200, [{"id": "q1", "outcome": "approved"}]),
    "/materials/quotes": (200, {"items": []}),
    "/modules": (200, {"modules": [{"module": "materials", "enabled": False, "reason": None}]}),
    "/v1/account/security": (200, {"session_level": "aal2", "second_factor_on": True}),
}


def build(role: str = "owner") -> FastAPI:
    app = FastAPI()
    app.state.internal_token = "private-token"
    tenant = SimpleNamespace(id=uuid.UUID(T), name="Shop")
    app.dependency_overrides[today_summary.any_member] = lambda: SimpleNamespace(tenant=tenant, role=role)
    stub = APIRouter(prefix="/v1/tenants/{tenant_id}")
    outside = APIRouter()

    @stub.post("/things")
    def write() -> dict[str, bool]:
        return {"ok": True}

    def answer(path: str) -> Any:
        async def handler(request: Request) -> Any:
            CALLS.append(path + (("?" + request.url.query) if request.url.query else ""))
            ACTIVE["now"] += 1
            ACTIVE["max"] = max(ACTIVE["max"], ACTIVE["now"])
            try:
                if DELAYS.get(path):
                    await asyncio.sleep(DELAYS[path])
                got = ANSWERS.get(path, (200, {"part": path}))
                return JSONResponse(got[1], status_code=got[0])
            finally:
                ACTIVE["now"] -= 1

        return handler

    known = {s.path.split("?")[0] for s in [*today_summary.wave1(dt.date(2026, 1, 1)), *today_summary.opt_in(dt.date(2026, 1, 1))]} | set(FACT_PATHS)
    for path in sorted(known):
        stub.add_api_route(path, answer(path), methods=["GET"])
    for tail in ("/outbox/approvals", "/call-requests", "/calls/{call_id}", "/quotes/{quote_id}", "/outreach/batches/{batch_id}/items"):
        stub.add_api_route(tail, answer(tail), methods=["GET"])
    outside.add_api_route("/v1/account/security", answer("/v1/account/security"), methods=["GET"])
    app.include_router(stub)
    app.include_router(outside)
    app.include_router(today_summary.router)
    app.add_middleware(PageGuardMiddleware, max_inflight=12, cache_s=3.0, internal_token="private-token")
    return app


@pytest.fixture(autouse=True)
def clean() -> Iterator[None]:
    CALLS.clear()
    ANSWERS.clear()
    DELAYS.clear()
    ACTIVE.update(now=0, max=0)
    today_summary.reset_sections()
    ANSWERS["/today"] = (200, {"cards": {}, "needs_you": [], "recent": []})
    yield
    today_summary.reset_sections()


def get(client: TestClient, query: str = "") -> dict[str, Any]:
    r = client.get(f"/v1/tenants/{T}/today/summary{query}", headers=AUTH)
    assert r.status_code == 200, r.text
    sections: dict[str, Any] = r.json()["sections"]
    return sections


def reads(prefix: str) -> list[str]:
    return [c for c in CALLS if c.startswith(prefix)]


def test_opt_in_sections_and_setup_progress_are_not_run_unless_named() -> None:
    with TestClient(build()) as client:
        sections = get(client, "?checks=business_profile")   # checks alone do not switch the section on
    assert not (today_summary.OPT_IN_NAMES & set(sections))
    for path in ("/campaigns", "/institution/admissions", "/trips", "/materials/quotes", "/ledger/summary", "/example-data", "/outcomes/totals", "/reports/run/education.today", "/profile", "/whatsapp/account"):
        assert not reads(path), path


def test_include_runs_only_the_named_opt_in_sections_and_ignores_unknown_names() -> None:
    today = dt.datetime.now(today_summary.IST).date().isoformat()
    with TestClient(build()) as client:
        sections = get(client, "?include=campaigns,example_data,trips_today,pack_report_today,nonsense,today")
    assert {"campaigns", "example_data", "trips_today", "pack_report_today"} <= set(sections)
    assert "ledger_summary" not in sections and "outcomes_totals" not in sections and "nonsense" not in sections
    assert all(sections[n]["state"] == "ok" for n in ("campaigns", "example_data", "trips_today", "pack_report_today"))
    assert f"/trips?date={today}" in CALLS and "/reports/run/education.today" in CALLS
    assert "/campaigns?limit=50" in CALLS and "/ledger/summary?limit=100&party=company" not in CALLS


def test_an_opt_in_section_is_kept_for_its_own_time_and_a_retry_by_only_names_it() -> None:
    with TestClient(build()) as client:
        get(client, "?include=example_data")
        first = len(reads("/example-data"))
        again = get(client, "?only=example_data")   # `only` alone is enough for an opt-in section
        assert set(again) == {"example_data"} and len(reads("/example-data")) == first, "kept: no second read"
    assert any(w.name == "example_data" and w.ttl == 30.0 for w in today_summary.opt_in(dt.date(2026, 1, 1))), "the example-data card is kept 30 s"


def test_setup_progress_answers_exactly_the_checks_asked_for_from_the_same_facts_as_the_web() -> None:
    ANSWERS.update(EVERYTHING_SET)
    ANSWERS["/campaigns"] = (200, {"items": [{"status": "draft"}]})   # only a draft: not done
    ANSWERS["/outreach/rules"] = (200, [])
    asked = "business_profile,institution_set,students_imported,fee_plan_set,first_campaign_approved,lead_source_added,call_rule_approved,ask_assistant_tried,delivery_rule_set,second_factor_set,catalogue_has_items,quote_rules_set,whatsapp_connected,first_quote_sent"
    with TestClient(build()) as client:
        data = get(client, f"?include=setup_progress&checks={asked}")["setup_progress"]
    assert data["state"] == "ok"
    done = data["data"]
    assert list(done) == list(today_summary.CHECKS), "in the closed list's order, nothing else"
    assert {k for k, v in done.items() if v is False} == {"first_campaign_approved", "call_rule_approved"}
    assert all(v is True for k, v in done.items() if k not in ("first_campaign_approved", "call_rule_approved"))
    assert not reads("/materials/items") and not reads("/materials/quotes"), "the materials part is read only when that module is on"


def test_setup_progress_with_the_materials_module_on_reads_the_materials_part_too() -> None:
    ANSWERS.update(EVERYTHING_SET)
    ANSWERS["/modules"] = (200, {"modules": [{"module": "materials", "enabled": True, "reason": None}]})
    ANSWERS["/catalogue/items"] = (200, {"items": []})
    ANSWERS["/materials/items"] = (200, {"items": [{"id": 1}]})
    ANSWERS["/quotes"] = (200, [])
    ANSWERS["/materials/quotes"] = (200, {"items": [{"status": "approved"}]})
    with TestClient(build()) as client:
        done = get(client, "?only=setup_progress&checks=catalogue_has_items,first_quote_sent")["setup_progress"]["data"]
    assert done == {"catalogue_has_items": True, "first_quote_sent": True}


def test_a_fact_that_cannot_be_read_is_null_not_a_guess_and_unknown_checks_are_dropped() -> None:
    ANSWERS.update(EVERYTHING_SET)
    ANSWERS["/whatsapp/account"] = (500, {"error": {"code": "boom"}})
    with TestClient(build()) as client:
        data = get(client, "?include=setup_progress&checks=whatsapp_connected,business_profile,not_a_check,calls_today")["setup_progress"]["data"]
    assert data == {"business_profile": True, "whatsapp_connected": None}


def test_setup_progress_is_for_owner_and_admin_only_and_reads_nothing_for_anyone_else() -> None:
    ANSWERS.update(EVERYTHING_SET)
    for role in ("sales", "viewer"):
        today_summary.reset_sections()
        CALLS.clear()
        with TestClient(build(role=role)) as client:
            sections = get(client, "?include=setup_progress&checks=business_profile,second_factor_set")
        assert sections["setup_progress"]["state"] == "not_for_you", role
        assert not reads("/profile") and not reads("/v1/account/security"), role
    today_summary.reset_sections()
    with TestClient(build(role="admin")) as client:
        assert get(client, "?include=setup_progress&checks=business_profile")["setup_progress"]["state"] == "ok"


def test_setup_progress_with_no_checks_is_absent_and_the_second_factor_is_read_outside_the_workspace_prefix() -> None:
    ANSWERS.update(EVERYTHING_SET)
    with TestClient(build()) as client:
        assert "setup_progress" not in get(client, "?include=setup_progress")
        today_summary.reset_sections()
        data = get(client, "?include=setup_progress&checks=second_factor_set")["setup_progress"]["data"]
    assert data == {"second_factor_set": True} and "/v1/account/security" in CALLS
    ANSWERS["/v1/account/security"] = (200, {"session_level": "aal1", "second_factor_on": False})
    today_summary.reset_sections()
    with TestClient(build()) as client:
        assert get(client, "?include=setup_progress&checks=second_factor_set")["setup_progress"]["data"] == {"second_factor_set": False}


def test_a_path_two_sections_need_is_read_once_in_one_request() -> None:
    ANSWERS.update(EVERYTHING_SET)
    with TestClient(build()) as client:
        get(client, "?include=setup_progress,campaigns&checks=first_campaign_approved,first_quote_sent")
    assert len(reads("/campaigns?limit=50")) == 1, "the campaigns section and the check share one read"
    assert len(reads("/quotes?limit=50")) == 1, "the quotes section and the check share one read"


def test_setup_progress_never_runs_more_than_four_reads_at_once_and_is_kept_a_minute_per_set_of_checks() -> None:
    ANSWERS.update(EVERYTHING_SET)
    for path in FACT_PATHS:
        DELAYS[path] = 0.04
    DELAYS["/v1/account/security"] = 0.04
    every = ",".join(today_summary.CHECKS)
    with TestClient(build()) as client:
        get(client, f"?only=setup_progress&checks={every}")
        assert 1 < ACTIVE["max"] <= today_summary.SETUP_PARALLEL
        first = len(CALLS)
        get(client, f"?only=setup_progress&checks={every}")
        assert len(CALLS) == first, "the same set of checks, a moment later: from memory"
        get(client, "?only=setup_progress&checks=business_profile")
        assert len(CALLS) > first, "another set of checks is its own entry (the reads inside are fresh)"


def test_a_slow_setup_progress_retries_with_the_same_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(today_summary, "SOFT_DEADLINE_S", 0.05)
    ANSWERS.update(EVERYTHING_SET)
    DELAYS["/profile"] = 0.3
    with TestClient(build()) as client:
        first = get(client, "?include=setup_progress&checks=business_profile,institution_set")["setup_progress"]
        assert first["state"] == "slow" and first["retry"] == "/today/summary?only=setup_progress&checks=business_profile,institution_set"
        done = get(client, first["retry"].split("summary")[1])["setup_progress"]
    assert done["state"] == "ok" and done["data"] == {"business_profile": True, "institution_set": True}


def test_skip_wins_over_include_and_a_write_by_the_caller_drops_the_30_second_example_data() -> None:
    with TestClient(build()) as client:
        sections = get(client, "?include=campaigns,example_data&skip=campaigns")
        assert "campaigns" not in sections and "example_data" in sections and not reads("/campaigns")
        get(client, "?include=example_data")
        assert len(reads("/example-data")) == 1, "kept"
        assert client.post(f"/v1/tenants/{T}/things", headers=AUTH, json={}).status_code == 200
        get(client, "?include=example_data")
        assert len(reads("/example-data")) == 2, "the caller's own write (Remove / Load / Reset example data) is followed by a fresh read"
