"""Manual-price quotes through OUR application on the real stack (manual-price quote, slice 3): real JWT verification, real PostgREST, the real database functions, the REAL
pinned engine and the real text renderer.

  * create (Owner, Admin), read, list, approve (Owner / Admin with a second factor; an Admin is refused a flagged quote), reject, withdraw, the customer text;
  * a retry replays, the same id with other lines conflicts, a price outside the item type's range is saved and flagged (never refused);
  * who may not: Sales, a Viewer, another workspace, anon; an agent context (the database refuses it);
  * the engine and the database agree on 30 seeded random cases, through the API;
  * a list-price quote still reads and renders exactly as before (the golden in services/ai-api/tests pins the raw bytes; here the real stack does it once more).
All data is synthetic."""

# ruff: noqa: E501, S311, S608

from __future__ import annotations

import json
import random
from typing import Any

import operator_sql
import pytest
from conftest import aal1_token, bearer
from crm_support import World
from evidence_support import pg, uid
from fastapi.testclient import TestClient
from quote_support import QuoteWorld, rpc

from app.quotes import engine_port

TYPES: dict[
    str, tuple[str, int | None, int | None]
] = {  # code -> (name, lowest, highest), SYNTHETIC
    "MQ1": ("Manual type one", None, None),
    "MQ2": ("Manual type two", 100_000, 500_000),
    "MQ3": ("Manual type three", None, None),
}


@pytest.fixture(scope="module")
def mq(eval_world: World) -> QuoteWorld:
    q = QuoteWorld(eval_world, eval_world.a, n_products=0)
    q.policy_version(
        seller_state="TG",
        gst_rate_bps=500,
        new_net_days=10,
        repeat_net_days=45,
        repeat_credit_limit_paise=1_000_000_000,
    )
    for code_, (name, low, high) in TYPES.items():
        r = rpc(
            q.w,
            q.owner.token,
            "save_item_type",
            p_tenant_id=q.t.id,
            p_code=code_,
            p_name=name,
            p_position=1,
            p_active=True,
            p_min_price_paise=low,
            p_max_price_paise=high,
        )
        assert r.status_code == 200, r.text
    return q


def url(mq: QuoteWorld, path: str) -> str:
    return f"/v1/tenants/{mq.t.id}{path}"


def h(user: Any) -> dict[str, str]:
    return bearer(user)


def h1(mq: QuoteWorld, user: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {aal1_token(mq.w.stack, user)}"}


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


def enquiry(mq: QuoteWorld) -> str:
    eid = uid()
    r = pg(mq.w.stack, mq.sales, "POST", "/enquiries", json={"id": eid, "tenant_id": mq.t.id, "lead_id": mq.t.rows["leads"]["id"], "channel": "email",
           "received_at": "2026-10-05T10:00:00+00:00", "body": f"Synthetic enquiry {eid}"}, representation=False)  # fmt: skip
    assert r.status_code == 201, r.text
    return eid


def line(code_: str, qty: int, price: int) -> dict[str, Any]:
    return {"item_type_code": code_, "qty": qty, "unit_price_paise": price}


def make(
    mq: QuoteWorld,
    client: TestClient,
    eid: str,
    lines: list[dict[str, Any]],
    *,
    kind: str = "new",
    state: str | None = None,
    quote: str | None = None,
    user: Any = None,
) -> Any:
    body: dict[str, Any] = {"id": quote or uid(), "customer_kind": kind, "lines": lines}
    if state is not None:
        body["delivery_state"] = state
    return client.post(
        url(mq, f"/enquiries/{eid}/manual-quotes"), json=body, headers=h(user or mq.owner)
    )


# ----------------------------------------------------------------------------- create, read, list
def test_an_owner_makes_a_draft_with_the_databases_figures_and_it_reads_back(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid = enquiry(mq)
    r = make(mq, client, eid, [line("MQ1", 3, 250_000), line("MQ3", 1, 99_999)])
    assert r.status_code == 201, r.text
    q = r.json()
    # worked by hand: 750000 + 99999 = 849999; GST 5 % per line half up = 37500 + 5000; total 892499; advance 50 % (446249.5 -> 446250)
    assert q["pricing_kind"] == "manual" and q["status"] == "draft" and q["outcome"] == "draft"
    assert (
        q["merchandise_net_paise"],
        q["item_tax_paise"],
        q["shipping_net_paise"],
        q["shipping_tax_paise"],
        q["total_paise"],
        q["advance_paise"],
        q["balance_paise"],
    ) == (849_999, 42_500, 0, 0, 892_499, 446_250, 446_249)
    assert (
        q["price_list_version_id"] is None
        and q["delivery_state"] is None
        and q["gst_supply"] is None
    )
    assert (
        q["review_flags"] == [] and q["engine_flags"] == [] and q["needs_owner_approval"] is False
    )
    assert [(x["sku"], x["name"], x["item_type_code"], x["price_source"], x["product_id"], x["tax_bps"], x["tax_paise"]) for x in q["lines"]] == [
        ("LINE-1", "Manual type one", "MQ1", "typed_by_person", None, 500, 37_500),
        ("LINE-2", "Manual type three", "MQ3", "typed_by_person", None, 500, 5_000),
    ]  # fmt: skip
    got = client.get(url(mq, f"/quotes/{q['id']}"), headers=h(mq.sales))
    assert got.status_code == 200 and got.json() == q
    listed = client.get(url(mq, f"/enquiries/{eid}/quotes"), headers=h(mq.admin)).json()
    assert [(x["id"], x["pricing_kind"]) for x in listed] == [(q["id"], "manual")]
    assert q["id"] in [x["id"] for x in client.get(url(mq, "/quotes"), headers=h(mq.owner)).json()]


def test_an_admin_makes_a_draft_a_state_gives_the_label_and_a_repeat_customer_needs_the_owner(
    mq: QuoteWorld, client: TestClient
) -> None:
    a = make(mq, client, enquiry(mq), [line("MQ1", 1, 100_000)], state="KA", user=mq.admin)
    assert a.status_code == 201, a.text
    assert (
        a.json()["delivery_state"] == "KA"
        and a.json()["gst_supply"] == "inter_state"
        and a.json()["created_by"] == str(mq.admin.id)
    )
    b = make(mq, client, enquiry(mq), [line("MQ1", 1, 100_000)], kind="repeat", state="TG")
    assert b.status_code == 201, b.text
    q = b.json()
    assert (
        q["gst_supply"] == "intra_state"
        and q["review_flags"] == ["REPEAT_CUSTOMER_CLAIMED"]
        and q["needs_owner_approval"] is True
    )
    assert (q["total_paise"], q["advance_paise"], q["balance_paise"]) == (105_000, 26_250, 78_750)
    assert (
        client.post(url(mq, f"/quotes/{q['id']}/approve"), headers=h(mq.admin)).status_code == 403
    )  # owner_approval_required
    assert (
        client.post(url(mq, f"/quotes/{q['id']}/approve"), headers=h(mq.owner)).status_code == 200
    )


def test_a_retry_replays_and_the_same_id_with_other_lines_conflicts(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid, quote = enquiry(mq), uid()
    first = make(mq, client, eid, [line("MQ1", 2, 1_000)], quote=quote)
    again = make(mq, client, eid, [line("MQ1", 2, 1_000)], quote=quote)
    assert first.status_code == 201 and again.status_code == 200 and first.json() == again.json()
    other = make(mq, client, eid, [line("MQ1", 2, 1_001)], quote=quote)
    assert other.status_code == 409 and code(other) in {"conflict", "quote_mismatch"}, other.text
    swapped = make(mq, client, eid, [line("MQ3", 2, 1_000)], quote=quote)
    assert swapped.status_code == 409, (
        "the same id with another item type (same price, other name) is a conflict too"
    )
    assert (
        operator_sql.sql(f"select count(*) from public.quotes where enquiry_id = '{eid}'").strip()
        == "1"
    )


def test_a_new_draft_on_the_same_enquiry_replaces_the_old_one(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid = enquiry(mq)
    a = make(mq, client, eid, [line("MQ1", 1, 1_000)]).json()["id"]
    b = make(mq, client, eid, [line("MQ1", 1, 2_000)]).json()["id"]
    assert (
        client.get(url(mq, f"/quotes/{a}"), headers=h(mq.owner)).json()["outcome"] == "superseded"
    )
    assert client.get(url(mq, f"/quotes/{b}"), headers=h(mq.owner)).json()["outcome"] == "draft"


# ----------------------------------------------------------------------------- the soft warning
def test_a_price_outside_the_item_types_range_is_saved_and_flagged_not_refused(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid = enquiry(mq)
    r = make(mq, client, eid, [line("MQ2", 1, 600_000)])
    assert r.status_code == 201, r.text
    q = r.json()
    assert (
        q["review_flags"] == ["TYPED_PRICE_OUTSIDE_RANGE"]
        and q["needs_owner_approval"] is True
        and q["lines"][0]["unit_price_applied_paise"] == 600_000
    )
    assert (
        client.post(url(mq, f"/quotes/{q['id']}/approve"), headers=h(mq.admin)).status_code == 403
    )
    assert (
        code(client.post(url(mq, f"/quotes/{q['id']}/approve"), headers=h(mq.admin)))
        == "owner_approval_required"
    )
    ok = client.post(url(mq, f"/quotes/{q['id']}/approve"), headers=h(mq.owner))
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    inside = make(mq, client, enquiry(mq), [line("MQ2", 1, 100_000), line("MQ2", 1, 500_000)])
    assert inside.status_code == 201 and inside.json()["review_flags"] == []
    below = make(mq, client, enquiry(mq), [line("MQ2", 1, 99_999)])
    assert below.status_code == 201 and below.json()["review_flags"] == [
        "TYPED_PRICE_OUTSIDE_RANGE"
    ]


# ----------------------------------------------------------------------------- approval and the customer text
def test_approval_needs_a_second_factor_and_renders_the_manual_text(
    mq: QuoteWorld, client: TestClient
) -> None:
    q = make(mq, client, enquiry(mq), [line("MQ1", 3, 250_000), line("MQ3", 1, 99_999)]).json()
    approve = url(mq, f"/quotes/{q['id']}/approve")
    assert (
        client.post(approve, headers=h(mq.sales)).status_code == 403
        and client.post(approve, headers=h(mq.viewer)).status_code == 403
    )
    for person in (mq.owner, mq.admin):
        weak = client.post(approve, headers=h1(mq, person))
        assert weak.status_code == 403 and code(weak) == "mfa_required"
    early = client.get(url(mq, f"/quotes/{q['id']}/text"), headers=h(mq.sales))
    assert early.status_code == 409 and code(early) == "quote_not_approved"
    ok = client.post(approve, headers=h(mq.admin))
    assert (
        ok.status_code == 200
        and ok.json()["status"] == "approved"
        and ok.json()["text_error"] is None
    ), ok.text
    text = ok.json()["text"]["text"]
    lines = text.split("\n")
    assert "Manual type one" in text and "Manual type three" in text and "₹8,924.99" in text
    assert "LINE-" not in text and "MQ1" not in text, (
        "the synthetic key and the item type code are never printed"
    )
    assert "Shipping" not in text, "no courier block"
    assert (
        text.count("GST as applicable at invoicing") == 1
        and lines[-1] == "- GST as applicable at invoicing"
    )
    assert "GST (5%)" in text and "- This is a quote, not an invoice." in lines
    assert (
        client.get(url(mq, f"/quotes/{q['id']}/text"), headers=h(mq.sales)).json()
        == ok.json()["text"]
    )
    again = client.post(approve, headers=h(mq.admin))
    assert again.status_code == 200 and again.json()["replayed"] is True
    row = client.get(url(mq, f"/quotes/{q['id']}"), headers=h(mq.sales)).json()
    assert row["status"] == "approved" and row["approved_by"] == str(mq.admin.id)


def test_reject_and_withdraw_work_for_a_manual_quote(mq: QuoteWorld, client: TestClient) -> None:
    a = make(mq, client, enquiry(mq), [line("MQ1", 1, 5_000)]).json()["id"]
    r = client.post(
        url(mq, f"/quotes/{a}/reject"), json={"code": "wrong_prices"}, headers=h(mq.owner)
    )
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    b = make(mq, client, enquiry(mq), [line("MQ1", 1, 5_000)]).json()["id"]
    assert client.post(url(mq, f"/quotes/{b}/approve"), headers=h(mq.owner)).status_code == 200
    w = client.post(
        url(mq, f"/quotes/{b}/withdraw"), json={"code": "price_changed"}, headers=h(mq.owner)
    )
    assert (
        w.status_code == 200
        and client.get(url(mq, f"/quotes/{b}"), headers=h(mq.owner)).json()["outcome"]
        == "withdrawn"
    )


def test_a_new_policy_version_makes_a_manual_draft_stale_and_it_is_retyped(
    mq: QuoteWorld, client: TestClient
) -> None:
    old = make(mq, client, enquiry(mq), [line("MQ1", 1, 7_000)]).json()["id"]
    mq.policy_version(
        seller_state="TG",
        gst_rate_bps=1200,
        new_net_days=10,
        repeat_net_days=45,
        repeat_credit_limit_paise=1_000_000_000,
    )
    r = client.post(url(mq, f"/quotes/{old}/approve"), headers=h(mq.owner))
    assert r.status_code == 409 and code(r) == "quote_stale", r.text
    new = make(mq, client, enquiry(mq), [line("MQ1", 1, 7_000)])
    assert (
        new.status_code == 201
        and new.json()["item_tax_paise"] == 840
        and new.json()["lines"][0]["tax_bps"] == 1200
    )
    assert (
        client.get(url(mq, f"/quotes/{old}"), headers=h(mq.owner)).json()["lines"][0]["tax_bps"]
        == 500
    ), "an older quote keeps the rate it was made with"
    mq.policy_version(
        seller_state="TG",
        gst_rate_bps=500,
        new_net_days=10,
        repeat_net_days=45,
        repeat_credit_limit_paise=1_000_000_000,
    )


# ----------------------------------------------------------------------------- who may not
def test_sales_a_viewer_another_workspace_and_anon_get_nothing(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid = enquiry(mq)
    body = {"id": uid(), "customer_kind": "new", "lines": [line("MQ1", 1, 1_000)]}
    path = url(mq, f"/enquiries/{eid}/manual-quotes")
    for person in (mq.sales, mq.viewer):
        r = client.post(path, json=body, headers=h(person))
        assert r.status_code == 403 and code(r) == "forbidden", person.label
    foreign = client.post(path, json=body, headers=h(mq.w.b.users["owner"]))
    assert foreign.status_code == 404
    assert client.post(path, json=body).status_code == 401
    assert (
        operator_sql.sql(f"select count(*) from public.quotes where enquiry_id = '{eid}'").strip()
        == "0"
    )
    q = make(mq, client, enquiry(mq), [line("MQ1", 1, 1_000)]).json()
    assert (
        client.get(
            f"/v1/tenants/{mq.w.b.id}/quotes/{q['id']}", headers=h(mq.w.b.users["owner"])
        ).status_code
        == 404
    )
    assert client.get(url(mq, f"/quotes/{q['id']}"), headers=h(mq.viewer)).status_code == 403


def test_an_unknown_item_type_a_state_that_is_not_a_state_and_a_bad_body_make_no_quote(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid = enquiry(mq)
    assert make(mq, client, eid, [line("NOPE", 1, 1_000)]).status_code == 422
    assert make(mq, client, eid, [line("MQ1", 1, 1_000)], state="ZZ").status_code == 422
    assert make(mq, client, eid, [line("MQ1", 0, 1_000)]).status_code == 422
    assert (
        make(mq, client, eid, [{**line("MQ1", 1, 1_000), "price_source": "list"}]).status_code
        == 422
    )
    assert make(mq, client, eid, [line("MQ1", 1, 1_000)] * 6).status_code == 422
    assert (
        operator_sql.sql(f"select count(*) from public.quotes where enquiry_id = '{eid}'").strip()
        == "0"
    )
    inactive = rpc(
        mq.w,
        mq.owner.token,
        "save_item_type",
        p_tenant_id=mq.t.id,
        p_code="MQ9",
        p_name="Manual type nine",
        p_position=1,
        p_active=False,
        p_min_price_paise=None,
        p_max_price_paise=None,
    )
    assert inactive.status_code == 200
    r = make(mq, client, eid, [line("MQ9", 1, 1_000)])
    assert r.status_code == 422 and code(r) == "invalid_value", (
        "an item type that is no longer sold is refused by the database"
    )


def test_an_enquiry_with_a_line_by_line_requirement_is_refused_until_it_is_discarded(
    mq: QuoteWorld, client: TestClient
) -> None:
    eid, requirement = mq.requirement([("kanjivaram", 5)])
    r = make(mq, client, eid, [line("MQ1", 1, 1_000)])
    assert r.status_code == 409 and code(r) == "enquiry_has_requirement", r.text
    assert (
        operator_sql.sql(f"select count(*) from public.quotes where enquiry_id = '{eid}'").strip()
        == "0"
    )
    assert client.post(
        url(mq, f"/requirements/{requirement}/discard"), headers=h(mq.sales)
    ).status_code in (200, 404)


def test_an_agent_context_cannot_type_a_price(mq: QuoteWorld) -> None:
    """The database refuses it (SM260). An API caller cannot set an agent context, so this runs the function as the Owner's session the way PostgREST would, with the agent setting on."""
    eid = enquiry(mq)
    call = (
        f"select public.create_manual_quote_draft('{uid()}', '{eid}', 'new', null, '{engine_port.engine_version()}', '{{\"as_of\": \"2026-01-01\"}}', '{{}}', "
        f'\'[{{"item_type_code": "MQ1", "qty": 1, "unit_price_paise": 1000}}]\'::jsonb);'
    )
    claims = json.dumps({"sub": str(mq.owner.id), "role": "authenticated", "aal": "aal2"})
    for setting in (
        "select set_config('app.agent_run_id', gen_random_uuid()::text, true);",
        "select set_config('app.created_via', 'agent', true);",
    ):
        statement = f"begin; set local role authenticated; select set_config('request.jwt.claims', '{claims}', true); {setting} {call} rollback;"
        exit_code, _, err = operator_sql.sql_result(statement)
        assert exit_code != 0 and "a price can only be typed by a person" in err, err
    control = f"begin; set local role authenticated; select set_config('request.jwt.claims', '{claims}', true); {call} rollback;"
    _, _, err2 = operator_sql.sql_result(control)
    assert "a price can only be typed by a person" not in err2, (
        "outside an agent context the same call gets past that check"
    )
    assert (
        operator_sql.sql(f"select count(*) from public.quotes where enquiry_id = '{eid}'").strip()
        == "0"
    )


# ----------------------------------------------------------------------------- the engine and the database agree, through the API
def test_the_database_accepts_the_real_engines_output_through_the_api_on_random_inputs(
    mq: QuoteWorld, client: TestClient
) -> None:
    rng = random.Random(20261031)
    approved = 0
    for case in range(30):
        rate = rng.choice([0, 1, 250, 500, 1200, 1800, 2800, rng.randint(0, 2800)])
        mq.policy_version(
            seller_state=rng.choice(["TG", "KA"]), gst_rate_bps=rate, new_net_days=rng.randint(0, 90), repeat_net_days=rng.randint(0, 90), validity_days=rng.randint(1, 60),
            new_advance_bps=rng.randint(0, 10000), repeat_advance_bps=rng.randint(0, 10000), shipping_flat_fee_paise=rng.choice([0, rng.randint(1, 300000)]),
            shipping_tax_bps=rng.choice([0, 500, 1800]), rounding_mode=rng.choice(["half_up", "half_even", "down"]), repeat_credit_limit_paise=rng.choice([0, rng.randint(1, 20_000_000)]),
        )  # fmt: skip
        lines = [
            line(rng.choice(list(TYPES)), rng.choice([rng.randint(1, 200), rng.randint(1, 12), 1, 10000]), rng.choice([rng.randint(1, 40), rng.randint(1, 5000), rng.randint(1000, 600_000), 100_000_000]))
            for _ in range(rng.randint(1, 5))
        ]  # fmt: skip
        kind = rng.choice(["new", "repeat"])
        label = f"case {case} (seed 20261031): gst {rate}, {kind}, {len(lines)} lines"
        r = make(mq, client, enquiry(mq), lines, kind=kind, state=rng.choice([None, "TG", "KA"]))
        assert r.status_code == 201, (
            f"{label}: the database refused the REAL engine's output: {r.text}"
        )
        q = r.json()
        assert all(
            x["tax_bps"] == rate and x["price_source"] == "typed_by_person" for x in q["lines"]
        ), label
        assert (
            q["total_paise"] == q["merchandise_net_paise"] + q["item_tax_paise"]
            and q["shipping_net_paise"] == 0
        ), label
        assert q["advance_paise"] + q["balance_paise"] == q["total_paise"], label
        if case % 3 == 0:
            ok = client.post(url(mq, f"/quotes/{q['id']}/approve"), headers=h(mq.owner))
            assert ok.status_code == 200 and ok.json()["text_error"] is None, f"{label}: {ok.text}"
            assert ok.json()["text"]["text"].count("GST as applicable at invoicing") == 1, label
            approved += 1
    assert approved >= 1


# ----------------------------------------------------------------------------- list-price quotes are what they were
def test_a_list_price_quote_still_reads_without_the_manual_fields(
    mq: QuoteWorld, client: TestClient
) -> None:
    lq = QuoteWorld(
        mq.w, mq.t, n_products=0
    )  # the same workspace: a list price list and a pick beside the manual quotes
    lq.add_product("MQ-LIST", "Synthetic list product", category="kanjivaram")
    lq.price_version([lq.item(0, 400_000, 4, 500)])
    lq.mapper_config(
        {
            "saree_type_to_categories": {"kanjivaram": ["kanjivaram"]},
            "fabric_to_values": {},
            "colour_to_values": {},
        }
    )
    eid, requirement = lq.requirement([("kanjivaram", 12)])
    assert (
        client.post(
            f"/v1/tenants/{lq.t.id}/enquiries/{eid}/picks",
            json={"line": 1, "product_id": lq.products[0], "qty": 12, "sale_unit": "piece"},
            headers=h(lq.sales),
        ).status_code
        == 200
    )
    made = client.post(
        f"/v1/tenants/{lq.t.id}/enquiries/{eid}/quotes",
        json={"id": uid(), "customer_kind": "new", "delivery_state": "TG"},
        headers=h(lq.sales),
    )
    assert made.status_code == 201, made.text
    q = made.json()
    assert "pricing_kind" not in q, "a list-price quote's JSON has no manual-only field"
    assert all("price_source" not in x and "item_type_code" not in x for x in q["lines"])
    assert (
        q["delivery_state"] == "TG"
        and q["gst_supply"] in ("intra_state", "inter_state")
        and q["price_list_version_id"]
        and q["lines"][0]["product_id"]
    )
    summary = client.get(f"/v1/tenants/{lq.t.id}/quotes", headers=h(lq.sales)).json()
    mine = [x for x in summary if x["id"] == q["id"]]
    assert len(mine) == 1 and "pricing_kind" not in mine[0]
    ok = client.post(f"/v1/tenants/{lq.t.id}/quotes/{q['id']}/approve", headers=h(lq.admin))
    assert ok.status_code == 200, ok.text
    assert "GST as applicable at invoicing" not in ok.json()["text"]["text"]
