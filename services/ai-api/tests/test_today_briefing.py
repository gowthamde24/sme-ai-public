"""GET /today/briefing (planner, 19 Nov 2026): the numbers of the briefing line, nothing else, from one read kept 5 s per person and dropped when they write."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

from app.hardening import admission
from app.today import routes as today_routes
from tests.fakes import TENANT_A, auth, make_client
from tests.test_nav_counts import BODY
from tests.today_fakes import FakeTodayRepository

URL = f"/v1/tenants/{TENANT_A.id}/today/briefing"
KEYS = {"needs_you", "new_leads", "visits_today", "unread_chats", "followups_due", "quotes_waiting", "live_calls", "as_of"}


def world() -> tuple[Any, FakeTodayRepository]:
    today_routes._briefing_cache.clear()  # noqa: SLF001
    repo = FakeTodayRepository()
    repo.nav[TENANT_A.id] = dict(BODY)
    client, _ = make_client(today=repo)
    return client, repo


def test_the_briefing_has_only_the_counts_and_is_tiny() -> None:
    client, _ = world()
    got = client.get(URL, headers=auth("a_sales"))
    assert got.status_code == 200 and set(got.json()) == KEYS
    assert got.json()["new_leads"] == BODY["new_leads"] and got.json()["visits_today"] == BODY["visits_today"]
    assert len(json.dumps(got.json())) < 1024, "under 1 KB"
    assert client.get(URL).status_code == 401


def test_one_read_per_person_for_five_seconds_and_a_write_drops_it() -> None:
    client, repo = world()
    owner = auth("a_owner")   # one signed-in session: the same token every time (a new token is a new session)
    for _ in range(3):
        assert client.get(URL, headers=owner).status_code == 200
    assert [c[0] for c in repo.calls].count("nav_counts") == 1, "kept 5 s"
    client.get(URL, headers=auth("a_admin"))
    assert [c[0] for c in repo.calls].count("nav_counts") == 2, "another person: their own read"
    for caller in {k[0] for k in today_routes._briefing_cache}:  # noqa: SLF001
        for hook in admission.WRITE_HOOKS:
            hook(caller)   # what the admission layer does when a person writes
    assert not today_routes._briefing_cache, "a write drops every number kept for that person"  # noqa: SLF001
    client.get(URL, headers=owner)
    assert [c[0] for c in repo.calls].count("nav_counts") == 3


def test_nulls_pass_through_and_a_stranger_sees_nothing() -> None:
    client, repo = world()
    repo.nav[TENANT_A.id] = {k: None for k in BODY if k != "as_of"} | {"as_of": BODY["as_of"]}
    got = client.get(URL, headers=auth("a_viewer")).json()
    assert all(got[k] is None for k in KEYS if k != "as_of")
    assert client.get(URL, headers=auth("b_owner")).status_code == 404
