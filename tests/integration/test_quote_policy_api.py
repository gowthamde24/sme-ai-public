"""The quote policy ROUTES of our API on the real stack (the pattern of test_order_api.py), with real tokens and the real database:

  * an Owner publishes and reads; an Admin does too; the version in force is marked and a future-dated one is not;
  * a Sales user and a Viewer are refused on both routes; another workspace's Owner and anon get nothing;
  * a second factor is required to publish (an aal1 session is refused and nothing is created);
  * a replay of the same id (even spelled with the defaults written out) is a 200 replay, and the same id with other content is a 409;
  * the database, not the API, decides: no default of ours (it fills tax_mode, rounding_mode, the credit limit, the required inputs), and its date and
    input rules refuse with a fixed sentence and create nothing.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

from typing import Any

import httpx
import operator_sql
import pytest
from conftest import aal1_token
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient

FIELDS: dict[str, Any] = {
    "discount_ceiling_bps": 0,
    "shipping_flat_fee_paise": 0,
    "shipping_tax_bps": 0,
    "validity_days": 15,
    "new_advance_bps": 5000,
    "repeat_advance_bps": 2500,
    "net_days": 30,
    "seller_state": "TS",
}  # SYNTHETIC numbers, like the seeded policy: not a statement of any rate or freight


@pytest.fixture(scope="module")
def world(client: TestClient, stack: Any, signup: Any) -> World:
    return World(client, stack, signup)


@pytest.fixture(scope="module")
def flow(client: TestClient, stack: Any, signup: Any) -> World:
    """A workspace only the publish-and-read test writes to: the list there is exact."""
    return World(client, stack, signup)


def url(t: Tenant) -> str:
    return f"/v1/tenants/{t.id}/quote-policy-versions"


def headers(w: World, t: Tenant, user: str, *, weak: bool = False) -> dict[str, str]:
    u = t.users[user]
    return {"Authorization": f"Bearer {aal1_token(w.stack, u) if weak else u.token}"}


def err(r: httpx.Response) -> str:
    return str(r.json()["error"]["code"])


def today() -> str:
    return operator_sql.sql("select app.quote_today()").strip()


def later(days: int) -> str:
    return operator_sql.sql(f"select app.quote_today() + {int(days)}").strip()


def publish(
    w: World,
    t: Tenant,
    user: str = "owner",
    *,
    version: str | None = None,
    effective: str | None = None,
    weak: bool = False,
    **over: Any,
) -> httpx.Response:
    body = {"id": version or uid(), "effective_from": effective or today(), **FIELDS, **over}
    response: httpx.Response = w.client.post(
        url(t), json=body, headers=headers(w, t, user, weak=weak)
    )
    return response


def listing(w: World, t: Tenant, user: str = "owner", *, weak: bool = False) -> httpx.Response:
    response: httpx.Response = w.client.get(url(t), headers=headers(w, t, user, weak=weak))
    return response


def count(w: World, t: Tenant) -> int:
    r = listing(w, t)
    assert r.status_code == 200, r.text
    return len(r.json())


def test_an_owner_and_an_admin_publish_and_read_and_the_one_in_force_is_marked(flow: World) -> None:
    t = flow.a
    assert listing(flow, t).json() == [], "a new workspace has no policy"
    first = publish(flow, t, "owner")
    assert first.status_code == 201, first.text
    assert first.json()["version_no"] == 1 and first.json()["replayed"] is False
    assert set(first.json()) == {"version_id", "version_no", "effective_from", "replayed"}
    second = publish(flow, t, "admin", shipping_flat_fee_paise=7500)
    assert second.status_code == 201 and second.json()["version_no"] == 2, second.text
    future = publish(flow, t, "owner", effective=later(10), net_days=45)
    assert future.status_code == 201 and future.json()["version_no"] == 3, future.text

    for reader in ("owner", "admin"):
        r = listing(flow, t, reader)
        assert r.status_code == 200, (reader, r.text)
        rows = r.json()
        assert [v["version_no"] for v in rows] == [3, 2, 1], "newest first"
        assert [v["in_force"] for v in rows] == [False, True, False], (
            "the latest effective_from not after today; a future one is not in force yet"
        )
        assert rows[1]["id"] == second.json()["version_id"]
        assert rows[1]["shipping_flat_fee_paise"] == 7500 and rows[0]["net_days"] == 45
        assert rows[0]["effective_from"] == later(10) and rows[2]["effective_from"] == today()
        assert all(v["seller_state"] == "TS" and v["created_at"] for v in rows)

    # the database refuses a date before the latest version's (that one is dated in the future) and creates nothing
    late = publish(flow, t, effective=today())
    assert late.status_code == 422 and err(late) == "invalid_value", late.text
    assert count(flow, t) == 3


def test_the_database_fills_every_default_the_api_does_not(world: World) -> None:
    t = world.a
    r = publish(world, t)
    assert r.status_code == 201, r.text
    row = next(v for v in listing(world, t).json() if v["id"] == r.json()["version_id"])
    assert row["tax_mode"] == "exclusive" and row["rounding_mode"] == "half_up"
    assert row["repeat_credit_limit_paise"] == 0 and row["shipping_free_above_paise"] is None
    assert row["required_inputs"] == ["delivery_state"]


def test_everything_typed_comes_back_as_typed(world: World) -> None:
    t = world.a
    typed: dict[str, Any] = {
        "discount_ceiling_bps": 300,
        "shipping_flat_fee_paise": 12_000,
        "shipping_free_above_paise": 5_000_000,
        "shipping_tax_bps": 500,
        "validity_days": 7,
        "new_advance_bps": 6000,
        "repeat_advance_bps": 1000,
        "net_days": 0,
        "tax_mode": "exclusive",
        "rounding_mode": "half_even",
        "repeat_credit_limit_paise": 900_000,
        "seller_state": "KA",
        "required_inputs": ["deadline", "delivery_state"],
    }
    r = publish(world, t, **typed)
    assert r.status_code == 201, r.text
    row = next(v for v in listing(world, t).json() if v["id"] == r.json()["version_id"])
    assert {k: row[k] for k in typed if k != "required_inputs"} == {
        k: v for k, v in typed.items() if k != "required_inputs"
    }
    assert sorted(row["required_inputs"]) == ["deadline", "delivery_state"]


@pytest.mark.parametrize("user", ["sales", "viewer"])
def test_sales_and_a_viewer_are_refused_on_both_routes_and_nothing_is_created(
    world: World, user: str
) -> None:
    t = world.a
    before = count(world, t)
    r = publish(world, t, user)
    assert r.status_code == 403 and err(r) == "forbidden"
    g = listing(world, t, user)
    assert g.status_code == 403 and err(g) == "forbidden"
    assert count(world, t) == before


def test_another_workspace_and_anon_get_nothing(world: World) -> None:
    t, other = world.a, world.b
    before = count(world, t)
    body = {"id": uid(), "effective_from": today(), **FIELDS}
    foreign = {"Authorization": f"Bearer {other.users['owner'].token}"}
    assert world.client.post(url(t), json=body, headers=foreign).status_code == 404
    assert world.client.get(url(t), headers=foreign).status_code == 404
    assert world.client.post(url(t), json=body).status_code == 401
    assert world.client.get(url(t)).status_code == 401
    assert count(world, t) == before
    assert all(v["id"] != body["id"] for v in listing(world, other, "owner").json())


@pytest.mark.parametrize("user", ["owner", "admin"])
def test_publishing_needs_a_second_factor_and_reading_does_not(world: World, user: str) -> None:
    t = world.a
    before = count(world, t)
    weak = publish(world, t, user, weak=True)
    assert weak.status_code == 403 and err(weak) == "mfa_required", weak.text
    assert count(world, t) == before, "nothing was created"
    assert listing(world, t, user, weak=True).status_code == 200


def test_a_replay_is_a_200_and_the_same_id_with_other_content_is_a_409(world: World) -> None:
    t = world.a
    version = uid()
    first = publish(world, t, version=version)
    assert first.status_code == 201 and first.json()["replayed"] is False
    before = count(world, t)
    again = publish(world, t, "admin", version=version)
    assert again.status_code == 200 and again.json()["replayed"] is True
    assert again.json()["version_no"] == first.json()["version_no"]
    spelled = publish(
        world,
        t,
        version=version,
        tax_mode="exclusive",
        rounding_mode="half_up",
        repeat_credit_limit_paise=0,
        required_inputs=["delivery_state"],
    )
    assert spelled.status_code == 200 and spelled.json()["replayed"] is True, (
        "the same policy with its defaults written out is the same content"
    )
    assert count(world, t) == before
    clash = publish(world, t, version=version, net_days=44)
    assert clash.status_code == 409 and err(clash) == "conflict", clash.text
    assert count(world, t) == before


@pytest.mark.parametrize(
    "over",
    [
        {"effective": "2020-01-01"},
        {"required_inputs": []},
        {"required_inputs": ["deadline"]},
        {"required_inputs": ["delivery_state", "delivery_state"]},
    ],
    ids=["past-date", "no-inputs", "no-delivery-state", "repeated-input"],
)
def test_the_database_rules_the_api_does_not_know_refuse_with_a_fixed_sentence_and_create_nothing(
    world: World, over: dict[str, Any]
) -> None:
    t = world.a
    before = count(world, t)
    r = publish(world, t, **over)
    assert r.status_code == 422 and err(r) == "invalid_value", r.text
    assert set(r.json()["error"]) == {"code", "message"}
    assert count(world, t) == before


def test_a_malformed_body_is_refused_before_the_database(world: World) -> None:
    t = world.a
    before = count(world, t)
    for bad in (
        {"seller_state": "ts"},
        {"net_days": 181},
        {"tax_mode": "inclusive"},
        {"gst_bps": 500},
        {"shipping_flat_fee_paise": 1.5},
    ):
        r = publish(world, t, **bad)
        assert r.status_code == 422 and err(r) == "validation_error", (bad, r.text)
    assert count(world, t) == before


def test_the_newest_version_dated_today_is_the_one_in_force(world: World) -> None:
    t = world.a
    r = publish(world, t, shipping_flat_fee_paise=9_900)
    assert r.status_code == 201, r.text
    forced = [v for v in listing(world, t).json() if v["in_force"]]
    assert len(forced) == 1 and forced[0]["id"] == r.json()["version_id"]
    assert forced[0]["shipping_flat_fee_paise"] == 9_900
