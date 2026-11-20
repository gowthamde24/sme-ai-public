"""Jobs, the thin list (planner 21 Nov 2026): GET /jobs and GET /jobs/today read what already runs from its own subsystem, with fakes (no database)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.jobs import listing
from app.jobs.wiring import JobsRuntime
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
A = TENANT_A.id
JOBS = f"/v1/tenants/{A}/jobs"
TODAY = f"/v1/tenants/{A}/jobs/today"


def on() -> JobsRuntime:
    return JobsRuntime(directory=PACKS)


class Rules:
    def __init__(self, *rows: Any) -> None:
        self.rows = list(rows)

    def rules(self, token: str, tenant_id: uuid.UUID) -> list[Any]:
        return self.rows


def rule(active: bool = True, reason: str | None = None) -> Any:
    return SimpleNamespace(active=active, paused_reason=reason)


class Numbers:
    def __init__(self, number: str | None, inbound_on: bool = False) -> None:
        self.number, self.inbound_on = number, inbound_on

    def line(self, token: str, tenant_id: uuid.UUID) -> Any:
        return SimpleNamespace(number=self.number, inbound_on=self.inbound_on)


class Finder:
    def __init__(self, reason: str = "ok", available: bool = True, access: str = "available") -> None:
        self.seen = SimpleNamespace(reason=reason, available=available, access=access)

    def availability(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self.seen


class Campaigns:
    def __init__(self, *rows: dict[str, Any]) -> None:
        self.rows = list(rows)

    def list_campaigns(self, token: str, tenant_id: uuid.UUID, status: Any, limit: int, after: Any) -> list[dict[str, Any]]:
        return self.rows


def get(client: Any, path: str, user: str | None = "a_owner") -> Any:
    return client.get(path, headers=auth(user) if user else {})


def by_kind(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {j["kind"]: j for j in body["items"]}


def test_with_jobs_off_both_routes_are_404() -> None:
    client, _ = make_client()
    assert get(client, JOBS).status_code == 404
    assert get(client, TODAY).status_code == 404


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 200), ("outsider", 404), (None, 401)])
def test_every_member_reads_the_list(user: str | None, status: int) -> None:
    client, _ = make_client(jobs=on())
    assert get(client, JOBS, user).status_code == status


def test_a_foreign_workspace_is_a_404() -> None:
    client, _ = make_client(jobs=on())
    assert get(client, f"/v1/tenants/{TENANT_B.id}/jobs", "a_owner").status_code == 404


def test_a_workspace_with_nothing_set_up_lists_the_jobs_as_off_and_never_fails() -> None:
    client, _ = make_client(jobs=on())
    r = get(client, JOBS)
    assert r.status_code == 200, r.text
    jobs = r.json()["items"]
    kinds = [j["kind"] for j in jobs]
    assert kinds[:5] == ["speed_to_lead", "answer_calls", "followups", "store_visits", "offers"]
    for j in jobs:
        assert set(j) == {"id", "kind", "custom_name", "enabled", "status", "result", "needs_you", "last_run_at", "fix", "plan_gate"}
        assert j["enabled"] is False and j["status"] in ("paused", "waiting")
        assert uuid.UUID(j["id"]) == listing.job_id(A, j["kind"])
    assert r.headers["etag"]


def test_the_job_ids_are_stable_and_differ_per_workspace_and_kind() -> None:
    assert listing.job_id(A, "offers") == listing.job_id(A, "offers")
    assert listing.job_id(A, "offers") != listing.job_id(B := TENANT_B.id, "offers")
    assert listing.job_id(A, "offers") != listing.job_id(A, "followups")
    assert B != A


def test_speed_to_lead_follows_its_rules() -> None:
    def kind(rules: Rules) -> dict[str, Any]:
        client, _ = make_client(jobs=on(), outreach=rules)
        return by_kind(get(client, JOBS).json())["speed_to_lead"]

    assert kind(Rules(rule(), rule()))["status"] == "running"
    assert kind(Rules(rule(), rule()))["enabled"] is True
    billing = kind(Rules(rule(), rule(False, "billing")))
    assert billing["status"] == "waiting" and billing["plan_gate"] == {"code": "billing_blocked"}
    assert kind(Rules(rule(False, "cap_calls")))["result"]["code"] == "cap_reached"
    assert kind(Rules(rule(False, "owner")))["status"] == "paused"
    assert kind(Rules())["result"]["code"] == "not_set_up"


def test_answer_calls_needs_a_number_then_the_switch() -> None:
    def kind(numbers: Numbers) -> dict[str, Any]:
        client, _ = make_client(jobs=on(), phone_numbers=numbers)
        return by_kind(get(client, JOBS).json())["answer_calls"]

    assert kind(Numbers(None))["plan_gate"] == {"code": "no_number"}
    assert kind(Numbers("+912212345678"))["status"] == "paused"
    assert kind(Numbers("+912212345678", True))["status"] == "running"


def test_offers_follow_the_offer_campaigns_only() -> None:
    def kind(*rows: dict[str, Any]) -> dict[str, Any]:
        client, _ = make_client(jobs=on(), campaigns=Campaigns(*rows))
        return by_kind(get(client, JOBS).json())["offers"]

    assert kind({"kind": "offer", "status": "running"})["status"] == "running"
    assert kind({"kind": "offer", "status": "done"})["status"] == "done"
    assert kind({"kind": "fee_due", "status": "running"})["result"]["code"] == "no_offer_yet"


def test_the_researcher_is_left_out_for_a_business_that_never_has_it() -> None:
    client, _ = make_client(jobs=on(), lead_finder=Finder("not_for_this_business", False, "hidden"))
    assert "researcher" not in by_kind(get(client, JOBS).json())
    client, _ = make_client(jobs=on(), lead_finder=Finder())
    assert by_kind(get(client, JOBS).json())["researcher"]["status"] == "running"
    client, _ = make_client(jobs=on(), lead_finder=Finder("ok", False, "limit_reached"))
    used = by_kind(get(client, JOBS).json())["researcher"]
    assert used["status"] == "waiting" and used["plan_gate"] == {"code": "minutes_used"}


def test_a_subsystem_that_fails_gives_an_off_job_not_a_500() -> None:
    class Broken:
        def rules(self, token: str, tenant_id: uuid.UUID) -> list[Any]:
            raise RuntimeError("down")

    client, _ = make_client(jobs=on(), outreach=Broken())
    r = get(client, JOBS)
    assert r.status_code == 200
    assert by_kind(r.json())["speed_to_lead"]["result"]["code"] == "not_readable"


def test_today_has_the_jobs_the_assistant_name_and_an_empty_needs_you() -> None:
    client, _ = make_client(jobs=on())
    r = get(client, TODAY)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"jobs", "needs_you", "assistant"}
    assert body["needs_you"] == [] and "name" in body["assistant"] and len(body["jobs"]) >= 5


def test_the_answer_has_an_etag_and_304_on_a_repeat() -> None:
    client, _ = make_client(jobs=on())
    first = get(client, JOBS)
    again = client.get(JOBS, headers={**auth("a_owner"), "If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
