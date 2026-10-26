"""Job DR part B2 on the real local stack: the Lead Desk demo data (scripts/demo_data.py `real_estate` and `coaching`) written through OUR API as an owner with a second factor, twice.

What this proves that the unit tests cannot: the whole path (approved facts, four lead imports with their costs, a standing rule, a batch planned and approved once, outcomes reported, hand-offs, the report) works against the real
database, and a second run changes nothing. The tasks need a model to plan them (the staging seed runs those): `tasks=False` here."""

# ruff: noqa: E501

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from conftest import bearer

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import demo_data  # noqa: E402

TODAY = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()   # the report counts what arrived up to the database's today


def caller(client: Any, tenant: Any, user: Any) -> Any:
    def call(method: str, path: str, body: Any = None, raw: Any = None) -> tuple[int, Any]:
        r = client.request(method, f"/v1/tenants/{tenant.id}{path}", json=body, headers=bearer(user))
        return r.status_code, (r.json() if r.content else None)

    return call


def test_the_real_estate_demo_is_written_once_and_a_second_run_changes_nothing(client: Any, eval_world: Any) -> None:
    a = eval_world.a
    call = caller(client, a, a.users["owner"])
    first = demo_data.real_estate(call, TODAY, tasks=False)
    assert first["facts"] == "5 approved" and "8 from meta_lead_ads" in first["leads"] and "10 from excel_upload" in first["leads"]

    batch = demo_data.did("realestate-batch")
    got = call("GET", f"/outreach/batches/{batch}")[1]
    assert got["batch"]["status"] == "running" and got["batch"]["approved_at"], "approved once by the Owner"
    assert got["progress"]["total"] == 10 and got["progress"]["calls_made"] == 8, got["progress"]

    handoffs = call("GET", "/outreach/handoffs?open=false")[1]
    assert len(handoffs) == 2, "two interested outcomes make two hand-offs"
    report = call("GET", "/outreach/reports")[1]
    sources = {row["source"]: row for row in report["by_source"]}
    assert {"excel_upload", "meta_lead_ads", "indiamart", "website_form"} <= set(sources)
    assert sources["meta_lead_ads"]["lead_cost_paise"] == 8 * 18000 and sources["excel_upload"]["calls"] == 8
    assert call("GET", "/outreach/rules")[1][0]["source"] == "meta_lead_ads"
    assert len(call("GET", "/knowledge/facts?status=approved&limit=100")[1]["facts"]) == 5

    again = demo_data.real_estate(call, TODAY, tasks=False)
    assert again["facts"] == first["facts"] and again["leads"] == first["leads"]
    assert call("GET", f"/outreach/batches/{batch}")[1]["progress"]["calls_made"] == 8, "no outcome is reported twice"
    assert len(call("GET", "/outreach/handoffs?open=false")[1]) == 2


def test_the_coaching_demo_is_written_in_its_own_workspace(client: Any, eval_world: Any) -> None:
    b = eval_world.b
    call = caller(client, b, b.users["owner"])
    out = demo_data.coaching(call, TODAY, tasks=False)
    assert out["facts"] == "5 approved" and "10 from excel_upload" in out["leads"]
    report = call("GET", "/outreach/reports")[1]
    assert report["total"]["leads"] >= 27 and report["total"]["bookings"] >= 1
