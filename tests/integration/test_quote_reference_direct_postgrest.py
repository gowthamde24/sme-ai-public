"""T009 part 1 on the real stack: the quote REFERENCE DATA (price list, quote policy, mapper config versions) attacked straight through PostgREST.

  * who may publish: Owner / Admin with a second factor (aal2); Sales, Viewer, a stranger, an unknown tenant and anon may not; the role is proven
    BEFORE the second factor, so an aal1 Sales or stranger learns nothing from SM306;
  * no client writes any of the six tables directly (INSERT / UPDATE / DELETE, as an Owner at aal2 too); nothing outside `public` is exposed;
  * a Viewer reads NONE of it (owner decision 1); Sales reads it; another tenant reads none of it; anon reads none of it;
  * an exact retry replays, other content under a used id (or another tenant's id) is the SAME constant conflict;
  * two racing publishers get distinct, consecutive version numbers; the same call twice at once creates one version;
  * the synthetic operator seed is idempotent and callable by no client.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import aal1_token
from crm_support import World
from evidence_support import code_of, pg, uid

TABLES = [
    "price_lists",
    "price_list_versions",
    "price_list_items",
    "price_list_breaks",
    "quote_policy_versions",
    "mapper_config_versions",
]


def today() -> str:
    """Today's date in India (the database's quote_today), computed the same way."""
    return (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date().isoformat()


def call(w: World, token: str | None, name: str, **body: Any) -> httpx.Response:
    return httpx.post(
        f"{w.stack.rest}/rpc/{name}", headers=w.stack.headers(token), json=body, timeout=30
    )


def item(w: World, tenant: Any, price: int = 100000, **over: Any) -> dict[str, Any]:
    return {
        "product_id": tenant.rows["products"]["id"],
        "unit_price_paise": price,
        "minimum_order_quantity": 4,
        "tax_bps": 500,
        **over,
    }


def publish(
    w: World,
    user: Any,
    tenant: Any,
    *,
    version: str | None = None,
    items: list[dict[str, Any]] | None = None,
    token: str | None = None,
) -> httpx.Response:
    return call(
        w,
        token or user.token,
        "create_price_list_version",
        p_version_id=version or uid(),
        p_tenant_id=tenant.id,
        p_effective_from=today(),
        p_items=items or [item(w, tenant)],
    )


POLICY = {
    "discount_ceiling_bps": 0,
    "shipping_flat_fee_paise": 0,
    "shipping_tax_bps": 0,
    "validity_days": 15,
    "new_advance_bps": 5000,
    "repeat_advance_bps": 2500,
    "new_net_days": 30,
    "repeat_net_days": 30,
    "seller_state": "TS",
}


@pytest.fixture(scope="module")
def w(eval_world: World) -> World:
    return eval_world


def test_an_owner_at_aal2_publishes_and_the_version_is_visible(w: World) -> None:
    r = publish(w, w.a.users["owner"], w.a)
    assert r.status_code == 200, r.text
    assert (
        r.json()["version_no"] == 1
        and r.json()["replayed"] is False
        and len(r.json()["content_sha256"]) == 64
    )
    seen = pg(
        w.stack,
        w.a.users["owner"],
        "GET",
        "/price_list_versions?select=id,version_no,effective_from,item_count",
    ).json()
    assert [v["version_no"] for v in seen] == [1] and seen[0]["item_count"] == 1
    items = pg(
        w.stack,
        w.a.users["sales"],
        "GET",
        "/price_list_items?select=sku,unit_price_paise,minimum_order_quantity,tax_bps,sale_unit",
    ).json()
    assert (
        len(items) == 1
        and items[0]["unit_price_paise"] == 100000
        and items[0]["sale_unit"] == "piece"
    )


def test_an_admin_publishes_a_policy_and_a_mapper_config(w: World) -> None:
    admin = w.a.users["admin"]
    p = call(
        w,
        admin.token,
        "create_quote_policy_version",
        p_version_id=uid(),
        p_tenant_id=w.a.id,
        p_effective_from=today(),
        p_policy=POLICY,
    )
    assert p.status_code == 200 and p.json()["version_no"] == 1, p.text
    m = call(w, admin.token, "create_mapper_config_version", p_version_id=uid(), p_tenant_id=w.a.id, p_effective_from=today(), p_default_sale_unit="piece",
             p_config={"saree_type_to_categories": {"kanjivaram": ["kanjivaram"]}})  # fmt: skip
    assert m.status_code == 200 and m.json()["version_no"] == 1, m.text
    row = pg(
        w.stack,
        admin,
        "GET",
        "/quote_policy_versions?select=tax_mode,rounding_mode,required_inputs,seller_state",
    ).json()
    assert row == [
        {
            "tax_mode": "exclusive",
            "rounding_mode": "half_up",
            "required_inputs": ["delivery_state"],
            "seller_state": "TS",
        }
    ]


def test_the_second_factor_is_required_and_the_role_is_proven_first(w: World) -> None:
    owner, sales, stranger = w.a.users["owner"], w.a.users["sales"], w.b.users["owner"]
    weak_owner, weak_sales, weak_stranger = (
        aal1_token(w.stack, owner),
        aal1_token(w.stack, sales),
        aal1_token(w.stack, stranger),
    )
    for fn, args in (
        ("create_price_list_version", {"p_items": [item(w, w.a)]}),
        ("create_quote_policy_version", {"p_policy": POLICY}),
        ("create_mapper_config_version", {"p_default_sale_unit": "piece", "p_config": {}}),
    ):
        base = {"p_version_id": uid(), "p_tenant_id": w.a.id, "p_effective_from": today(), **args}
        assert code_of(call(w, weak_owner, fn, **base)) == "SM306", fn
        assert code_of(call(w, weak_sales, fn, **base)) == "42501", (
            fn
        )  # not SM306: Sales learns nothing about the factor
        assert code_of(call(w, weak_stranger, fn, **base)) == "42501", fn
        assert code_of(call(w, None, fn, **base)) in ("42501", "PGRST301", ""), fn
        assert call(w, None, fn, **base).status_code in (401, 403), fn


def test_sales_a_viewer_a_stranger_and_an_unknown_tenant_are_all_refused_identically(
    w: World,
) -> None:
    refused = []
    for user, tenant_id in (
        (w.a.users["sales"], w.a.id),
        (w.a.users["viewer"], w.a.id),
        (w.b.users["owner"], w.a.id),
        (w.a.users["owner"], uid()),
    ):
        r = call(
            w,
            user.token,
            "create_price_list_version",
            p_version_id=uid(),
            p_tenant_id=tenant_id,
            p_effective_from=today(),
            p_items=[item(w, w.a)],
        )
        refused.append((r.status_code, r.json()))
    assert all(r == refused[0] for r in refused), refused
    assert refused[0][1]["code"] == "42501"


def test_no_client_writes_any_of_the_tables_directly_not_even_an_owner_at_aal2(w: World) -> None:
    owner = w.a.users["owner"]
    some_id = pg(w.stack, owner, "GET", "/price_list_versions?select=id&limit=1").json()[0]["id"]
    for table in TABLES:
        assert pg(w.stack, owner, "POST", f"/{table}", json={"tenant_id": w.a.id}).status_code in (
            401,
            403,
        ), table
        patched = pg(
            w.stack,
            owner,
            "PATCH",
            f"/{table}?tenant_id=eq.{w.a.id}",
            json={"created_at": "2020-01-01T00:00:00Z"},
        )
        assert patched.status_code in (401, 403) or patched.json() in ([], None), (
            table,
            patched.text,
        )
        deleted = pg(w.stack, owner, "DELETE", f"/{table}?tenant_id=eq.{w.a.id}")
        assert deleted.status_code in (401, 403) or deleted.json() in ([], None), (
            table,
            deleted.text,
        )
    assert pg(w.stack, owner, "GET", f"/price_list_versions?id=eq.{some_id}&select=id").json() == [
        {"id": some_id}
    ]  # nothing was removed or changed


def test_the_engine_version_allow_list_and_the_internal_functions_are_not_reachable(
    w: World,
) -> None:
    owner = w.a.users["owner"]
    assert pg(w.stack, owner, "GET", "/quote_engine_versions").status_code in (401, 403)
    assert pg(w.stack, None, "GET", "/quote_engine_versions").status_code in (401, 403)
    for fn in (
        "quote_create_price_version",
        "operator_seed_quote_reference_data",
        "quote_today",
        "quote_active_price_version",
    ):
        r = call(w, owner.token, fn, p_tenant_slug="x", p_tenant=w.a.id, p_on=today())
        assert r.status_code in (404, 401, 403), (
            fn,
            r.text,
        )  # the app schema is not exposed, and these were never granted


def test_a_viewer_reads_none_of_it_sales_reads_it_and_another_tenant_reads_none_of_it(
    w: World,
) -> None:
    for table in TABLES:
        assert pg(w.stack, w.a.users["viewer"], "GET", f"/{table}?select=id").json() == [], table
        assert pg(w.stack, w.b.users["owner"], "GET", f"/{table}?select=id").json() == [], table
        assert pg(w.stack, w.b.users["viewer"], "GET", f"/{table}?select=id").json() == [], table
        r = pg(w.stack, None, "GET", f"/{table}?select=id")
        assert r.status_code in (401, 403), table
    for table in (
        "price_lists",
        "price_list_versions",
        "price_list_items",
        "quote_policy_versions",
        "mapper_config_versions",
    ):
        assert pg(w.stack, w.a.users["sales"], "GET", f"/{table}?select=id").json() != [], table
        assert pg(w.stack, w.a.users["admin"], "GET", f"/{table}?select=id").json() != [], table


def test_a_retry_replays_and_other_content_or_another_tenants_id_is_the_same_constant_conflict(
    w: World,
) -> None:
    owner, other = w.a.users["owner"], w.b.users["owner"]
    version = uid()
    first = publish(w, owner, w.a, version=version, items=[item(w, w.a, 111000)])
    assert first.status_code == 200 and first.json()["replayed"] is False, first.text
    again = publish(w, owner, w.a, version=version, items=[item(w, w.a, 111000)])
    assert (
        again.status_code == 200
        and again.json()["replayed"] is True
        and again.json()["version_id"] == first.json()["version_id"]
    )
    changed = publish(w, owner, w.a, version=version, items=[item(w, w.a, 111001)])
    foreign = publish(w, other, w.b, version=version, items=[item(w, w.b, 111000)])
    assert (
        changed.status_code == foreign.status_code == 409
        or code_of(changed) == code_of(foreign) == "23505"
    ), (changed.text, foreign.text)
    assert changed.json() == foreign.json(), (
        "another tenant's Owner gets the same answer as a same-tenant conflict (no oracle on version ids)"
    )


def test_invalid_input_is_refused_with_fixed_messages_that_never_echo_the_input(w: World) -> None:
    owner = w.a.users["owner"]
    canary = "CANARY-PRICE-5531"
    for items in (
        [item(w, w.a, 0)],
        [{**item(w, w.a), "product_id": uid()}],
        [{**item(w, w.a), "cost": 5}],
        [{**item(w, w.a), "name": canary}],
        [{**item(w, w.a), "unit_price_paise": canary}],
    ):
        r = publish(w, owner, w.a, items=items)
        assert r.status_code in (400, 403, 409) and code_of(r) in ("23514", "23503", "22023"), (
            r.text
        )
        assert canary not in r.text


def test_two_racing_publishers_get_consecutive_distinct_version_numbers(w: World) -> None:
    owner, admin = w.a.users["owner"], w.a.users["admin"]
    before = max(
        v["version_no"]
        for v in pg(w.stack, owner, "GET", "/price_list_versions?select=version_no").json()
    )
    barrier = threading.Barrier(2)

    def go(user: Any, price: int) -> httpx.Response:
        barrier.wait(timeout=10)
        return publish(w, user, w.a, items=[item(w, w.a, price)])

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [
            f.result(timeout=60)
            for f in [pool.submit(go, owner, 120000), pool.submit(go, admin, 121000)]
        ]
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert sorted(r.json()["version_no"] for r in responses) == [before + 1, before + 2]


def test_the_same_call_made_twice_at_once_creates_one_version(w: World) -> None:
    owner = w.a.users["owner"]
    version, items = uid(), [item(w, w.a, 130000)]
    barrier = threading.Barrier(2)

    def go() -> httpx.Response:
        barrier.wait(timeout=10)
        return publish(w, owner, w.a, version=version, items=items)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [f.result(timeout=60) for f in [pool.submit(go), pool.submit(go)]]
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert sorted(r.json()["replayed"] for r in responses) == [False, True]
    assert (
        len(pg(w.stack, owner, "GET", f"/price_list_versions?id=eq.{version}&select=id").json())
        == 1
    )


def test_the_synthetic_operator_seed_is_idempotent_and_the_viewer_still_reads_none_of_it(
    eval_world: World,
) -> None:
    """On a workspace with no reference data yet: a FRESH world (a second fixture instance would share `w`, which already has versions)."""
    slug = operator_sql.sql(f"select slug from public.tenants where id = '{eval_world.b.id}'")
    first = operator_sql.sql(f"select app.operator_seed_quote_reference_data('{slug}')")
    assert (
        '"price_list_version"' in first
        and '"quote_policy_version"' in first
        and '"mapper_config_version"' in first
    )
    again = operator_sql.sql(f"select app.operator_seed_quote_reference_data('{slug}')")
    assert '"created": []' in again
    owner, viewer = eval_world.b.users["owner"], eval_world.b.users["viewer"]
    assert len(pg(eval_world.stack, owner, "GET", "/price_list_items?select=sku,name").json()) == 6
    assert all(
        r["name"].startswith("SYNTHETIC ")
        for r in pg(eval_world.stack, owner, "GET", "/price_list_items?select=name").json()
    )
    for table in TABLES:
        assert pg(eval_world.stack, viewer, "GET", f"/{table}?select=id").json() == [], table
