"""Job AD / D1 on the real stack: the plan is in GET /tenants/{id}, and the workspace limit holds through the API, through a double click and a
second tab, and for a person who owns nothing yet. Real GoTrue, real PostgREST, real Postgres, the caller's own token."""

# ruff: noqa: E501

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from conftest import bearer, unique_slug
from fastapi.testclient import TestClient


def make(client: TestClient, user: Any, name: str) -> Any:
    return client.post("/v1/tenants", json={"name": name, "slug": unique_slug("it-wl")}, headers=bearer(user))


def test_a_new_workspace_is_on_the_free_trial_and_every_member_sees_it(client: TestClient, signup: Any) -> None:
    owner = signup("wl-owner")
    made = make(client, owner, "Plan Co")
    assert made.status_code == 200, made.text
    got = client.get(f"/v1/tenants/{made.json()['id']}", headers=bearer(owner))
    assert got.status_code == 200
    body = got.json()
    assert (body["plan"], body["workspace_limit"], body["role"]) == ("free_trial", 1, "owner")
    assert body["trial_started_at"].startswith("20")


def test_a_second_workspace_is_refused_with_a_clear_409_and_nothing_is_left_behind(client: TestClient, signup: Any) -> None:
    owner = signup("wl-second")
    assert make(client, owner, "First Co").status_code == 200
    second = make(client, owner, "Second Co")
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "workspace_limit_reached"
    assert "one workspace" in second.json()["error"]["message"]
    memberships = client.get("/v1/me", headers=bearer(owner)).json()["memberships"]
    assert len(memberships) == 1


def test_the_same_slug_again_is_still_the_idempotent_retry(client: TestClient, signup: Any) -> None:
    owner = signup("wl-retry")
    slug = unique_slug("it-retry")
    first = client.post("/v1/tenants", json={"name": "Retry Co", "slug": slug}, headers=bearer(owner))
    again = client.post("/v1/tenants", json={"name": "Retry Co", "slug": slug}, headers=bearer(owner))
    assert first.status_code == again.status_code == 200 and first.json() == again.json()


def test_two_tabs_at_once_make_exactly_one_workspace(client: TestClient, signup: Any) -> None:
    owner = signup("wl-race")
    barrier = threading.Barrier(2)

    def go(name: str) -> int:
        barrier.wait(timeout=10)
        return int(make(client, owner, name).status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = sorted(f.result(timeout=60) for f in [pool.submit(go, "Tab One"), pool.submit(go, "Tab Two")])
    assert codes == [200, 409], codes
    assert len(client.get("/v1/me", headers=bearer(owner)).json()["memberships"]) == 1


def test_a_stranger_cannot_read_the_plan_of_someone_elses_workspace(client: TestClient, signup: Any) -> None:
    owner, stranger = signup("wl-own"), signup("wl-stranger")
    tenant = make(client, owner, "Private Co").json()["id"]
    assert client.get(f"/v1/tenants/{tenant}", headers=bearer(stranger)).status_code == 404
