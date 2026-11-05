"""The sidebar's counts (docs/contracts/nav-counts.md; owner, 5 Nov 2026): GET /nav-counts, any member, one database read kept 30 s per person and workspace; every number may be null."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.today import routes as today_routes
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.today_fakes import FakeTodayRepository

URL = f"/v1/tenants/{TENANT_A.id}/nav-counts"
BODY: dict[str, Any] = {
    "needs_you": 4, "prospects_needing_owner": 16, "new_leads": 3, "live_calls": 0, "unread_chats": 2, "followups_due": 5, "visits_today": 1, "quotes_waiting": 2, "ai_team_working": 1,
    "call_minutes": {"used": 12, "total": 100}, "ai_usage": {"used_paise": 4100, "allowance_paise": 90000, "period": "month"}, "plan": "growth", "as_of": "2026-11-05T12:00:00+00:00",
}


def world(body: dict[str, Any] | None = None) -> tuple[Any, FakeTodayRepository]:
    today_routes._nav_cache.clear()  # noqa: SLF001
    repo = FakeTodayRepository()
    repo.nav[TENANT_A.id] = body if body is not None else dict(BODY)
    client, _ = make_client(today=repo)
    return client, repo


def test_any_member_reads_the_counts_in_the_contracts_shape() -> None:
    client, repo = world()
    got = client.get(URL, headers=auth("a_viewer"))
    assert got.status_code == 200, got.text
    assert set(got.json()) == set(BODY) and got.json()["call_minutes"] == {"used": 12, "total": 100} and got.json()["ai_usage"]["period"] == "month"
    assert repo.calls[-1][0] == "nav_counts"


def test_nulls_pass_through_as_no_badge() -> None:
    nulls = {k: None for k in BODY if k != "as_of"} | {"as_of": BODY["as_of"]}
    client, _ = world(nulls)
    got = client.get(URL, headers=auth("a_sales")).json()
    assert all(got[k] is None for k in BODY if k != "as_of")


def test_one_read_per_person_every_30_seconds() -> None:
    client, repo = world()
    for _ in range(3):
        assert client.get(URL, headers=auth("a_owner")).status_code == 200
    assert [c[0] for c in repo.calls].count("nav_counts") == 1, "kept 30 s"
    client.get(URL, headers=auth("a_admin"))
    assert [c[0] for c in repo.calls].count("nav_counts") == 2, "another person: their own read (new_leads is per person)"
    key = next(iter(today_routes._nav_cache))  # noqa: SLF001
    at, value = today_routes._nav_cache[key]  # noqa: SLF001
    today_routes._nav_cache[key] = (at - 31, value)  # noqa: SLF001
    client.get(URL, headers=auth("a_owner"))
    assert [c[0] for c in repo.calls].count("nav_counts") == 3, "after 30 s: read again"


def test_another_workspace_is_404_and_a_bad_answer_is_502() -> None:
    client, _ = world()
    assert client.get(f"/v1/tenants/{TENANT_B.id}/nav-counts", headers=auth("a_owner")).status_code == 404
    client, repo = world()
    repo.nav[TENANT_A.id] = None
    assert client.get(URL, headers=auth("a_owner")).status_code == 502
