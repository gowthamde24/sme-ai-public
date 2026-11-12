"""GET /v1/tenants/{id}/today/summary (docs/contracts/today-summary.md): the Today page body in one request, each section an existing route run as the caller.

A stub app answers the real paths; the summary runs them through the ASGI loopback exactly as it does in production, behind the real page limiter."""

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

from app.bootstrap import routes, today_summary
from app.hardening.admission import PageGuardMiddleware

T = str(uuid.uuid4())
CALL_A, CALL_B, QUOTE_LISTED, QUOTE_MISSING, QUOTE_RECENT, ENQ, BATCH_RUN, BATCH_DONE = (str(uuid.uuid4()) for _ in range(8))
AUTH = {"Authorization": "Bearer token-one"}

CALLS: list[str] = []
SEEN: list[dict[str, str]] = []
ANSWERS: dict[str, Any] = {}
DELAYS: dict[str, float] = {}
ACTIVE = {"now": 0, "max": 0}

TODAY = {
    "cards": {"waiting": 6},
    "needs_you": [
        {"kind": "outbox_approval", "id": str(uuid.uuid4()), "target": {"type": "outbox_message", "id": str(uuid.uuid4())}},
        {"kind": "call_approval", "id": str(uuid.uuid4()), "target": {"type": "call_request", "id": str(uuid.uuid4())}},
        {"kind": "person_requested", "id": str(uuid.uuid4()), "target": {"type": "phone_call", "id": CALL_A}},
        {"kind": "visit_requested", "id": str(uuid.uuid4()), "target": {"type": "phone_call", "id": CALL_B}},
        {"kind": "quote_approval", "id": QUOTE_LISTED, "target": {"type": "quote", "id": QUOTE_LISTED}},
        {"kind": "quote_approval", "id": QUOTE_MISSING, "target": {"type": "quote", "id": QUOTE_MISSING}},
    ],
    "recent": [{"kind": "order_step", "target": {"type": "quote", "id": QUOTE_RECENT}}],
}


def build(role: str = "owner", limit: int = 12) -> FastAPI:
    app = FastAPI()
    app.state.internal_token = "private-token"
    tenant = SimpleNamespace(id=uuid.UUID(T), name="Shop")
    app.dependency_overrides[today_summary.any_member] = lambda: SimpleNamespace(tenant=tenant, role=role)
    stub = APIRouter(prefix="/v1/tenants/{tenant_id}")

    def answer(path: str) -> Any:
        async def handler(request: Request) -> Any:
            CALLS.append(path + (("?" + request.url.query) if request.url.query else ""))
            SEEN.append({"auth": request.headers.get("authorization", ""), "internal": request.headers.get(routes.INTERNAL_HEADER, "")})
            ACTIVE["now"] += 1
            ACTIVE["max"] = max(ACTIVE["max"], ACTIVE["now"])
            try:
                if DELAYS.get(path):
                    await asyncio.sleep(DELAYS[path])
                got = ANSWERS.get(path, (200, {"part": path}))
                if got == "boom":
                    raise RuntimeError("boom")
                return JSONResponse(got[1], status_code=got[0])
            finally:
                ACTIVE["now"] -= 1

        return handler

    for spec in today_summary.wave1(dt.date(2026, 1, 1)):
        stub.add_api_route(spec.path.split("?")[0], answer(spec.path.split("?")[0]), methods=["GET"])
    for tail in ("/outbox/approvals", "/call-requests", "/calls/{call_id}", "/quotes/{quote_id}", "/outreach/batches/{batch_id}/items"):
        stub.add_api_route(tail, answer(tail), methods=["GET"])

    @stub.post("/things")
    def write() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(stub)
    app.include_router(today_summary.router)
    app.add_middleware(PageGuardMiddleware, max_inflight=limit, cache_s=3.0, internal_token="private-token")
    return app


@pytest.fixture(autouse=True)
def clean() -> Iterator[None]:
    for store in (CALLS, SEEN):
        store.clear()
    ANSWERS.clear()
    DELAYS.clear()
    ACTIVE.update(now=0, max=0)
    today_summary.reset_sections()
    ANSWERS["/today"] = (200, TODAY)
    ANSWERS["/quotes"] = (200, [{"id": QUOTE_LISTED, "enquiry_id": str(uuid.uuid4())}])
    ANSWERS["/outreach/batches"] = (200, [{"batch": {"id": BATCH_RUN, "status": "running"}}, {"batch": {"id": BATCH_DONE, "status": "done"}}])
    ANSWERS["/calls/{call_id}"] = (200, {"lead_id": str(uuid.uuid4()), "summary_short": "asked for the owner", "captured": {"visit_at": "2026-11-14T10:00:00+05:30"}, "transcript": [{"secret": "never sent"}]})
    ANSWERS["/quotes/{quote_id}"] = (200, {"enquiry_id": ENQ})
    ANSWERS["/outreach/batches/{batch_id}/items"] = (200, [{"id": "i1"}])
    yield
    today_summary.reset_sections()


def get(client: TestClient, query: str = "") -> dict[str, Any]:
    r = client.get(f"/v1/tenants/{T}/today/summary{query}", headers=AUTH)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store", r.text
    body: dict[str, Any] = r.json()
    return body


def reads(prefix: str) -> list[str]:
    return [c for c in CALLS if c.startswith(prefix)]


def test_every_section_arrives_with_its_own_route_body_and_the_wave_two_sections_follow_the_needs_list() -> None:
    with TestClient(build()) as client:
        sections = get(client)["sections"]
    assert set(sections) == set(today_summary.ORDER), "exactly the agreed sections for an owner with a full needs list"
    assert all(s["state"] == "ok" for s in sections.values()), {k: v for k, v in sections.items() if v["state"] != "ok"}
    assert sections["today"]["data"]["cards"] == {"waiting": 6}, "the route's own body, unchanged"
    assert sections["quotes"]["data"][0]["id"] == QUOTE_LISTED
    assert sections["call_briefs"]["data"] == {
        CALL_A: {"lead_id": sections["call_briefs"]["data"][CALL_A]["lead_id"], "summary_short": "asked for the owner", "visit_at": "2026-11-14T10:00:00+05:30"},
        CALL_B: {"lead_id": sections["call_briefs"]["data"][CALL_B]["lead_id"], "summary_short": "asked for the owner", "visit_at": "2026-11-14T10:00:00+05:30"},
    }, "keyed by call id; only the three fields, never the transcript"
    assert "secret" not in str(sections["call_briefs"])
    assert sections["quote_enquiries"]["data"] == {QUOTE_MISSING: ENQ, QUOTE_RECENT: ENQ}, "every quote target of needs_you AND recent that is not in the first 50"
    assert list(sections["lead_desk_batch_items"]["data"]) == [BATCH_RUN], "running batches only"
    assert "/outbox/approvals?limit=100" in CALLS and "/call-requests?status=requested&limit=100" in CALLS
    assert any(c.startswith("/visits?from=") and "status=booked" in c for c in CALLS)


def test_a_wave_two_section_with_nothing_to_say_is_absent() -> None:
    ANSWERS["/today"] = (200, {"cards": {}, "needs_you": [], "recent": []})
    with TestClient(build()) as client:
        sections = get(client)["sections"]
    assert not (set(today_summary.WAVE2) - {"lead_desk_batch_items"}) & set(sections), "nothing in the needs list: nothing to read"
    assert "lead_desk_batch_items" in sections, "it follows the running batches, not the needs list"
    assert not reads("/outbox/approvals") and not reads("/call-requests") and not reads("/calls/")


def test_a_role_is_not_asked_for_what_it_may_not_read_and_the_module_or_role_refusals_are_not_errors() -> None:
    with TestClient(build(role="viewer")) as client:
        sections = get(client)["sections"]
    for name in ("ai_usage_week", "outbox_settings", "lead_desk_rules", "lead_desk_tasks", "lead_desk_leads", "visits_proposed", "lead_desk_handoffs", "call_briefs", "lead_desk_batch_items"):
        assert sections[name] == {"state": "not_for_you", "data": None, "error": None, "retry": None}, name
    assert not reads("/ai-usage") and not reads("/tasks") and not reads("/leads") and not reads("/visits?from="), "never read for a role that may not"
    assert sections["today"]["state"] == "ok"
    ANSWERS["/visits/today"] = (404, {"error": {"code": "not_found"}})
    ANSWERS["/prospects/stats"] = (403, {"error": {"code": "forbidden"}})
    with TestClient(build()) as client:
        owner = get(client)["sections"]
    assert owner["visits_today"]["state"] == "not_for_you" and owner["lead_finder_stats"]["state"] == "not_for_you"


def test_one_failed_section_says_its_code_and_status_and_never_fails_the_others() -> None:
    ANSWERS["/agents/status"] = (502, {"error": {"code": "upstream_error"}})
    ANSWERS["/visits/slots"] = "boom"
    with TestClient(build()) as client:
        sections = get(client)["sections"]
    assert sections["agents_status"]["error"] == {"code": "upstream_error", "status": 502}
    assert sections["visit_slots"]["error"] == {"code": "error", "status": 500}
    assert sections["today"]["state"] == "ok" and sections["quotes"]["state"] == "ok"


def test_a_slow_section_says_slow_keeps_running_and_the_retry_joins_the_same_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(today_summary, "SOFT_DEADLINE_S", 0.1)
    DELAYS["/prospects"] = 0.4
    with TestClient(build()) as client:
        first = get(client)["sections"]
        assert first["lead_finder_prospects"] == {"state": "slow", "data": None, "error": None, "retry": "/today/summary?only=lead_finder_prospects"}
        assert first["today"]["state"] == "ok", "the first paint is not held back by the slowest part"
        retry = get(client, "?only=lead_finder_prospects")["sections"]
    assert retry["lead_finder_prospects"]["state"] == "ok" and set(retry) == {"lead_finder_prospects"}
    assert len(reads("/prospects?")) == 1, "the retry joined the read that was already running: one read in all"


def test_the_hard_deadline_makes_a_part_busy_not_the_page(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(today_summary, "SOFT_DEADLINE_S", 5.0)
    monkeypatch.setattr(today_summary, "PART_TIMEOUT_S", 0.15)
    DELAYS["/agents/status"] = 0.5
    with TestClient(build()) as client:
        sections = get(client)["sections"]
    assert sections["agents_status"]["error"] == {"code": "busy", "status": 503} and sections["today"]["state"] == "ok"


def test_skip_leaves_sections_out_and_a_skipped_input_takes_its_wave_two_sections_with_it() -> None:
    with TestClient(build()) as client:
        sections = get(client, "?skip=lead_desk_tasks,lead_desk_leads,nonsense,BAD NAME")["sections"]
        assert "lead_desk_tasks" not in sections and "lead_desk_leads" not in sections and "today" in sections
        assert not reads("/tasks") and not reads("/leads"), "a skipped section is not even run"
    today_summary.reset_sections()
    CALLS.clear()
    with TestClient(build()) as client:
        sections = get(client, "?skip=today")["sections"]
    assert "today" not in sections and not {"outbox_approvals", "call_requests", "call_briefs", "quote_enquiries"} & set(sections)
    assert "lead_desk_batch_items" in sections, "its own input (the batches) is still there"


def test_only_runs_just_those_and_runs_what_they_need_without_showing_it() -> None:
    with TestClient(build()) as client:
        sections = get(client, "?only=call_briefs")["sections"]
    assert set(sections) == {"call_briefs"} and "/today" in CALLS


def test_the_answer_is_kept_three_seconds_and_a_write_by_the_same_caller_drops_it() -> None:
    with TestClient(build()) as client:
        get(client)
        first = len(CALLS)
        get(client)
        assert len(CALLS) == first, "ten tabs are one read"
        assert client.post(f"/v1/tenants/{T}/things", headers=AUTH, json={}).status_code == 200
        get(client)
        assert len(CALLS) > first, "a decision on the page is followed by a fresh read"
        other = len(CALLS)
        client.get(f"/v1/tenants/{T}/today/summary", headers={"Authorization": "Bearer someone-else"})
        assert len(CALLS) > other, "another person never shares the memory"


def test_the_sub_requests_carry_the_callers_own_token_and_are_not_page_requests_of_their_own() -> None:
    with TestClient(build(limit=1)) as client:   # ONE page slot: the summary holds it, its 20 parts must not need one
        sections = get(client)["sections"]
    assert all(s["state"] == "ok" for s in sections.values())
    assert {s["auth"] for s in SEEN} == {"Bearer token-one"} and {s["internal"] for s in SEEN} == {"private-token"}


def test_a_today_load_never_runs_more_internal_reads_than_the_one_shared_gate_allows() -> None:
    for path in ("/today", "/agents/status", "/visits/today", "/visits/slots", "/visits", "/ai-usage/week", "/outbox/settings", "/quotes", "/outreach/batches", "/outreach/handoffs", "/outreach/rules", "/tasks", "/leads", "/prospects", "/prospects/stats"):
        DELAYS[path] = 0.05
    with TestClient(build()) as client:
        get(client)
    assert routes.MAX_PARTS_AT_ONCE == 16
    assert 1 < ACTIVE["max"] <= routes.MAX_PARTS_AT_ONCE, "parallel, but never past the cap that keeps the threads free for a live call"
