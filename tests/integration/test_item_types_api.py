"""The item-type ROUTES of our API on the real stack (manual-price quote, slice 1), with real tokens and the real database:

  * an Owner saves and reads; an Admin replaces; Sales reads but cannot write; a Viewer gets neither;
  * a second factor is required to save (an aal1 session is refused and nothing is created); reading needs none;
  * the price range is optional, replaced (not merged) on every save, and `min <= max` is enforced by the database too;
  * another workspace's Owner and anon get nothing, and nothing leaks across workspaces (the same code can exist in both);
  * a client has no direct write on the table (the function is the only writer).
All data is synthetic: item type names and prices are placeholders."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import aal1_token
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def world(client: TestClient, stack: Any, signup: Any) -> World:
    return World(client, stack, signup)


def base(t: Tenant) -> str:
    return f"/v1/tenants/{t.id}/item-types"


def headers(w: World, t: Tenant, user: str, *, weak: bool = False) -> dict[str, str]:
    u = t.users[user]
    return {"Authorization": f"Bearer {aal1_token(w.stack, u) if weak else u.token}"}


def err(r: httpx.Response) -> str:
    return str(r.json()["error"]["code"])


def save(
    w: World, t: Tenant, code: str, user: str = "owner", *, weak: bool = False, **body: Any
) -> httpx.Response:
    payload = {"name": f"Item type {code}", **body}
    r: httpx.Response = w.client.put(
        f"{base(t)}/{code}", json=payload, headers=headers(w, t, user, weak=weak)
    )
    return r


def listing(w: World, t: Tenant, user: str = "owner", *, weak: bool = False) -> httpx.Response:
    r: httpx.Response = w.client.get(base(t), headers=headers(w, t, user, weak=weak))
    return r


def test_an_owner_saves_an_admin_replaces_and_both_read_the_range_back(world: World) -> None:
    t = world.a
    code = "T" + uid()[:8]
    first = save(world, t, code, min_price_paise=150_000, max_price_paise=1_000_000, position=2)
    assert first.status_code == 200 and first.json()["created"] is True, first.text
    assert set(first.json()) == {"id", "code", "created"}
    again = save(world, t, code, "admin", name="Renamed", min_price_paise=200_000)
    assert again.status_code == 200 and again.json()["created"] is False
    assert again.json()["id"] == first.json()["id"], "the same record"
    for reader in ("owner", "admin", "sales"):
        r = listing(world, t, reader)
        assert r.status_code == 200, (reader, r.text)
        row = next(v for v in r.json() if v["code"] == code)
        assert row["name"] == "Renamed" and row["min_price_paise"] == 200_000
        assert row["max_price_paise"] is None, (
            "a save REPLACES the record: the omitted highest price is gone"
        )
        assert set(row) == {
            "id",
            "code",
            "name",
            "position",
            "active",
            "min_price_paise",
            "max_price_paise",
        }


def test_the_same_save_twice_changes_nothing(world: World) -> None:
    t = world.a
    code = "I" + uid()[:8]
    assert save(world, t, code, max_price_paise=500).status_code == 200
    before = [v for v in listing(world, t).json() if v["code"] == code]
    assert save(world, t, code, max_price_paise=500).status_code == 200
    assert [v for v in listing(world, t).json() if v["code"] == code] == before


@pytest.mark.parametrize("user", ["sales", "viewer"])
def test_sales_cannot_save_and_a_viewer_can_do_neither(world: World, user: str) -> None:
    t = world.a
    code = "S" + uid()[:8]
    r = save(world, t, code, user)
    assert r.status_code == 403 and err(r) == "forbidden"
    assert all(v["code"] != code for v in listing(world, t).json())
    g = listing(world, t, user)
    assert (g.status_code == 200) == (user == "sales")
    if user == "viewer":
        assert err(g) == "forbidden"


def test_another_workspace_and_anon_get_nothing_and_the_same_code_can_live_in_both(
    world: World,
) -> None:
    t, other = world.a, world.b
    code = "X" + uid()[:8]
    assert save(world, t, code, min_price_paise=100).status_code == 200
    foreign = {"Authorization": f"Bearer {other.users['owner'].token}"}
    assert (
        world.client.put(f"{base(t)}/{code}", json={"name": "Nope"}, headers=foreign).status_code
        == 404
    )
    assert world.client.get(base(t), headers=foreign).status_code == 404
    assert world.client.put(f"{base(t)}/{code}", json={"name": "Nope"}).status_code == 401
    assert world.client.get(base(t)).status_code == 401
    assert save(world, other, code, min_price_paise=900).status_code == 200
    mine = next(v for v in listing(world, t).json() if v["code"] == code)
    theirs = next(v for v in listing(world, other).json() if v["code"] == code)
    assert mine["min_price_paise"] == 100 and theirs["min_price_paise"] == 900
    assert mine["id"] != theirs["id"]


@pytest.mark.parametrize("user", ["owner", "admin"])
def test_saving_needs_a_second_factor_and_reading_does_not(world: World, user: str) -> None:
    t = world.a
    code = "W" + uid()[:8]
    weak = save(world, t, code, user, weak=True)
    assert weak.status_code == 403 and err(weak) == "mfa_required", weak.text
    assert all(v["code"] != code for v in listing(world, t).json()), "nothing was created"
    assert listing(world, t, user, weak=True).status_code == 200


def test_the_range_rules_are_the_databases_too(world: World) -> None:
    t = world.a
    code = "R" + uid()[:8]
    # the API refuses a bad shape first; the database refuses what the API does not look at
    assert save(world, t, code, min_price_paise=9, max_price_paise=5).status_code == 422
    r = save(world, t, code, name="Zero​width")
    assert r.status_code == 422 and err(r) in {"validation_error", "invalid_value"}, r.text
    assert all(v["code"] != code for v in listing(world, t).json())
    ok = save(world, t, code, min_price_paise=5, max_price_paise=5)
    assert ok.status_code == 200, "equal bounds are allowed"


def test_a_client_has_no_direct_write_on_the_table(world: World) -> None:
    t = world.a
    h = world.stack.headers(t.users["owner"].token)
    rest = f"{world.stack.rest}/item_types"
    r = httpx.post(
        rest, json={"tenant_id": str(t.id), "code": "D" + uid()[:8], "name": "Direct"}, headers=h
    )
    assert r.status_code in (401, 403), r.text
    r = httpx.patch(
        rest, params={"tenant_id": f"eq.{t.id}"}, json={"min_price_paise": 1}, headers=h
    )
    assert r.status_code in (401, 403), r.text
    r = httpx.delete(rest, params={"tenant_id": f"eq.{t.id}"}, headers=h)
    assert r.status_code in (401, 403), r.text
