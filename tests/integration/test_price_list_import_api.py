"""Rehearsal step 5 on the real stack: the price-list CSV import through OUR application (real JWT verification, real PostgREST, the real pinned parser, the real
`create_price_list_version`).

  * preview then commit: the version holds the file's items in integer paise, with its breaks, the units of the catalog and the file's own hash;
  * who may: Owner and Admin with a second factor; Sales, a Viewer, anon, the other workspace's Owner and a password-only session are refused;
  * an exact retry replays, other content under the same id is a conflict, another workspace's catalog is invisible (its sku is UNKNOWN_SKU here);
  * a hostile file (a formula, a hidden character, an unknown, archived or inactive product, a repeated sku, oversize) is refused with a row, a column and a closed code and never echoes a cell;
  * the database still decides: a version dated before the latest is refused.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

import operator_sql
import pytest
from conftest import aal1_token, bearer
from crm_support import World
from evidence_support import pg, uid
from fastapi.testclient import TestClient
from quote_support import QuoteWorld, today

CANARY = "CANARY-6d2f90"


@pytest.fixture(scope="module")
def pw(eval_world: World) -> QuoteWorld:
    q = QuoteWorld(eval_world, eval_world.a, n_products=0)
    q.add_product("PL-RED", "Synthetic red saree")
    q.add_product("PL-BLUE", "Synthetic blue saree")
    q.add_product("PL-SET", "Synthetic set of three")
    # the unit of the catalog is a product column the helper does not set: a set is a set
    operator_sql.sql(
        f"update public.products set unit = 'set' where tenant_id = '{q.t.id}' and sku = 'PL-SET'"
    )
    return q


def url(t: Any, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def h(user: Any) -> dict[str, str]:
    return bearer(user)


def weak(pw: QuoteWorld, user: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {aal1_token(pw.w.stack, user)}"}


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


GOOD = 'sku,name,unit_price,moq,tax_bps,min_qty_1,price_1,min_qty_2,price_2\nPL-RED,Synthetic red saree,4200,4,500,10,4000,50,3900\nPL-BLUE,"Blue, as the file says",4200,4,500,,,,\nPL-SET,Set,"2,800.50",1,1200,,,,\n'


def body(csv: str = GOOD, on: str | None = None, vid: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"csv": csv, "effective_from": on or today()}
    if vid is not None:
        out["id"] = vid
    return out


def stored(version: str) -> list[dict[str, Any]]:
    raw = operator_sql.sql(
        f"select coalesce(json_agg(row_to_json(x) order by x.sku), '[]') from (select i.sku, i.sale_unit::text, i.unit_price_paise, i.minimum_order_quantity, i.tax_bps, "
        f"(select coalesce(json_agg(json_build_object('q', b.min_qty, 'p', b.unit_price_paise) order by b.min_qty), '[]'::json) from public.price_list_breaks b where b.item_id = i.id) as breaks "
        f"from public.price_list_items i where i.version_id = '{version}') x"
    )
    return list(json.loads(raw))


def test_a_preview_writes_nothing_and_a_commit_makes_the_version_the_file_says(
    pw: QuoteWorld, client: TestClient
) -> None:
    before = operator_sql.sql(
        f"select count(*) from public.price_list_versions where tenant_id = '{pw.t.id}'"
    )
    r = client.post(url(pw.t, "/price-lists/import/preview"), json=body(), headers=h(pw.owner))
    assert r.status_code == 200, r.text
    p = r.json()
    assert (
        p["ok"] is True
        and p["issues"] == []
        and p["row_count"] == 3
        and len(p["canonical_hash"]) == 64
    )
    assert {i["sku"]: (i["catalog_name"], i["name_matches"]) for i in p["items"]} == {
        "PL-BLUE": ("Synthetic blue saree", False),
        "PL-RED": ("Synthetic red saree", True),
        "PL-SET": ("Synthetic set of three", False),
    }
    assert (
        operator_sql.sql(
            f"select count(*) from public.price_list_versions where tenant_id = '{pw.t.id}'"
        )
        == before
    ), "a preview wrote nothing"

    vid = uid()
    made = client.post(url(pw.t, "/price-lists/import"), json=body(vid=vid), headers=h(pw.admin))
    assert made.status_code == 201, made.text
    m = made.json()
    assert (
        m["version_id"] == vid
        and m["item_count"] == 3
        and m["replayed"] is False
        and m["effective_from"] == today()
    )
    assert stored(vid) == [
        {
            "sku": "PL-BLUE",
            "sale_unit": "piece",
            "unit_price_paise": 420000,
            "minimum_order_quantity": 4,
            "tax_bps": 500,
            "breaks": [],
        },
        {
            "sku": "PL-RED",
            "sale_unit": "piece",
            "unit_price_paise": 420000,
            "minimum_order_quantity": 4,
            "tax_bps": 500,
            "breaks": [{"q": 10, "p": 400000}, {"q": 50, "p": 390000}],
        },
        {
            "sku": "PL-SET",
            "sale_unit": "set",
            "unit_price_paise": 280050,
            "minimum_order_quantity": 1,
            "tax_bps": 1200,
            "breaks": [],
        },
    ]
    # an exact retry replays; other content under the same id is a conflict
    again = client.post(url(pw.t, "/price-lists/import"), json=body(vid=vid), headers=h(pw.admin))
    assert (
        again.status_code == 200
        and again.json()["replayed"] is True
        and again.json()["content_sha256"] == m["content_sha256"]
    )
    changed = client.post(
        url(pw.t, "/price-lists/import"),
        json=body(GOOD.replace("4200,4,500,,", "4300,4,500,,"), vid=vid),
        headers=h(pw.admin),
    )
    assert changed.status_code == 409 and code(changed) == "conflict"
    assert operator_sql.sql(
        f"select count(*) from public.price_list_versions where tenant_id = '{pw.t.id}'"
    ) == str(int(before) + 1)


def test_who_may_import(pw: QuoteWorld, client: TestClient) -> None:
    path = url(pw.t, "/price-lists/import")
    preview = url(pw.t, "/price-lists/import/preview")
    for target, payload in ((preview, body()), (path, body(vid=uid()))):
        assert client.post(target, json=payload).status_code == 401
        for user in (pw.sales, pw.viewer):
            r = client.post(target, json=payload, headers=h(user))
            assert r.status_code == 403 and code(r) == "forbidden"
        for user in (pw.owner, pw.admin):
            r = client.post(target, json=payload, headers=weak(pw, user))
            assert r.status_code == 403 and code(r) == "mfa_required"
        other = pw.w.b.users["owner"]
        assert (
            client.post(target, json=payload, headers=h(other)).status_code == 404
        )  # another workspace's Owner on this path
    # and the other workspace's Owner on THEIR path cannot see this workspace's catalog: its skus are unknown there
    r = client.post(
        url(pw.w.b, "/price-lists/import/preview"), json=body(), headers=h(pw.w.b.users["owner"])
    )
    assert r.status_code == 200 and {(i["row"], i["code"]) for i in r.json()["issues"]} == {
        (1, "UNKNOWN_SKU"),
        (2, "UNKNOWN_SKU"),
        (3, "UNKNOWN_SKU"),
    }


def test_a_hostile_file_is_refused_with_rows_columns_and_closed_codes_and_echoes_nothing(
    pw: QuoteWorld, client: TestClient
) -> None:
    hostile = (
        "sku,name,unit_price,moq,tax_bps\n"
        f"=cmd|{CANARY},Boss,100,1,500\n"  # a formula in the sku
        f"PL-RED,{CANARY} fine,100,1,500\n"
        "pl-red,Again,100,1,500\n"  # the same sku, another case
        f"PL-BLUE,{CANARY},-5,1,500\n"
    )
    r = client.post(
        url(pw.t, "/price-lists/import/preview"), json=body(hostile), headers=h(pw.owner)
    )
    assert r.status_code == 200
    got = r.json()
    assert got["ok"] is False and got["items"] == [] and got["canonical_hash"] is None
    assert {(i["row"], i["column"], i["code"]) for i in got["issues"]} == {
        (1, "sku", "INVALID_SKU"),
        (3, "sku", "DUPLICATE_SKU"),
        (4, "unit_price", "INVALID_MONEY"),
    }
    assert CANARY not in r.text
    committed = client.post(
        url(pw.t, "/price-lists/import"), json=body(hostile, vid=uid()), headers=h(pw.owner)
    )
    assert (
        committed.status_code == 422
        and committed.json()["error"]["code"] == "price_list_invalid"
        and CANARY not in committed.text
    )
    assert {(i["row"], i["code"]) for i in committed.json()["issues"]} == {
        (1, "INVALID_SKU"),
        (3, "DUPLICATE_SKU"),
        (4, "INVALID_MONEY"),
    }


def test_unknown_archived_and_inactive_products_and_hidden_characters_are_issues(
    pw: QuoteWorld, client: TestClient
) -> None:
    pw.add_product("PL-GONE", "Archived one")
    pw.add_product("PL-OFF", "Inactive one")
    operator_sql.sql(
        f"update public.products set archived_at = now() where tenant_id = '{pw.t.id}' and sku = 'PL-GONE'"
    )
    operator_sql.sql(
        f"update public.products set active = false where tenant_id = '{pw.t.id}' and sku = 'PL-OFF'"
    )
    csv = (
        "sku,name,unit_price,moq,tax_bps\n"
        "PL-RED,ok,100,1,500\n"
        "NOPE-1,No such,100,1,500\n"
        "PL-GONE,Archived,100,1,500\n"
        "PL-OFF,Inactive,100,1,500\n"
        "PL-BLUE,Zero​width,100,1,500\n"
        'PL-SET,"Two\nlines",100,1,500\n'
    )
    r = client.post(url(pw.t, "/price-lists/import/preview"), json=body(csv), headers=h(pw.owner))
    assert {(i["row"], i["column"], i["code"]) for i in r.json()["issues"]} == {
        (2, "sku", "UNKNOWN_SKU"), (3, "sku", "UNKNOWN_SKU"), (4, "sku", "UNKNOWN_SKU"), (5, "name", "HIDDEN_CHARACTERS"), (6, "name", "HIDDEN_CHARACTERS"),
    }  # fmt: skip
    # a commit of it is refused and creates nothing
    n = operator_sql.sql(
        f"select count(*) from public.price_list_versions where tenant_id = '{pw.t.id}'"
    )
    assert (
        client.post(
            url(pw.t, "/price-lists/import"), json=body(csv, vid=uid()), headers=h(pw.owner)
        ).status_code
        == 422
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.price_list_versions where tenant_id = '{pw.t.id}'"
        )
        == n
    )


@pytest.mark.parametrize("name", ["హైదరా‌బాద్ శ్రీ‍సిల్క్", "ಮೈಸೂರು‌ ರೇಷ್ಮೆ", "കൊച്ചിന്‍ കൈത്തറി", "कृष्ण‍ साड़ी"])
def test_indic_names_with_joiners_import(pw: QuoteWorld, client: TestClient, name: str) -> None:
    r = client.post(
        url(pw.t, "/price-lists/import/preview"),
        json=body(f'sku,name,unit_price,moq,tax_bps\nPL-RED,"{name}",100,1,500\n'),
        headers=h(pw.owner),
    )
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["items"][0]["name"] == name


def test_limits_and_the_database_still_decides(pw: QuoteWorld, client: TestClient) -> None:
    assert (
        client.post(
            url(pw.t, "/price-lists/import/preview"),
            json=body("x" * (2 * 1024 * 1024 + 1)),
            headers=h(pw.owner),
        ).status_code
        == 422
    )
    too_wide = "sku,name,unit_price,moq,tax_bps\n" + "PL-RED," + "n" * 201 + ",100,1,500\n"
    r = client.post(
        url(pw.t, "/price-lists/import/preview"), json=body(too_wide), headers=h(pw.owner)
    )
    assert r.json()["issues"] == [{"row": 0, "column": None, "code": "FILE_LIMIT"}]
    # a version dated BEFORE the latest is refused by the database (an old price list cannot be slipped under a newer one)
    older = (date.fromisoformat(today()) - timedelta(days=3)).isoformat()
    refused = client.post(
        url(pw.t, "/price-lists/import"), json=body(GOOD, on=older, vid=uid()), headers=h(pw.owner)
    )
    assert refused.status_code in (409, 422) and code(refused) in ("invalid_value", "conflict"), (
        refused.text
    )


def test_a_viewer_reads_no_catalog_through_the_import_and_the_raw_table_is_not_writable(
    pw: QuoteWorld, client: TestClient
) -> None:
    assert (
        client.post(
            url(pw.t, "/price-lists/import/preview"), json=body(), headers=h(pw.viewer)
        ).status_code
        == 403
    )
    direct = pg(
        pw.w.stack,
        pw.owner,
        "POST",
        "/price_list_versions",
        json={"id": uid(), "tenant_id": pw.t.id},
    )
    assert direct.status_code in (401, 403), (
        "the import is the only way in: the table has no client write grant"
    )
