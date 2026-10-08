"""Manual-price quote, slice 2, on the real stack: the database's own arithmetic for a MANUAL quote EQUALS the real engine's.

The REAL engine (packages/quote-engine, through the adapter) runs on a request built here, independently of the database (a second implementation of the plan's rules:
one synthetic sku per line, the typed price, GST at the policy rate on every line, no courier, half-up rounding whatever the policy says). The database must build the
same request, ACCEPT the engine's own canonical request and result through public.create_manual_quote_draft, store the engine's figures and the rate used on each line, and
approve the quote later (the approval re-builds from the stored lines). Cases are seeded (reproducible) and cover every GST rate bound, small prices (half-paise ties),
both customer kinds, credit limits and prices outside an item type's range. A failure names the case. All data is synthetic."""

# ruff: noqa: E501, S311, S608

from __future__ import annotations

import json
import os
import random
from typing import Any

import operator_sql
import pytest
from crm_support import World
from evidence_support import uid
from quote_support import QuoteWorld, rpc, today

from app.quotes import engine_port

CASES = int(os.environ.get("QUOTE_EQUIVALENCE_CASES", "30"))
TYPES: dict[
    str, tuple[str, int | None, int | None]
] = {  # code -> (name, lowest, highest), SYNTHETIC
    "EQ1": ("Equivalence type one", None, None),
    "EQ2": ("Equivalence type two", 100_000, 500_000),
    "EQ3": ("Equivalence type three", None, 2_000),
    "EQ4": ("Equivalence type four", 50, None),
}


@pytest.fixture(scope="module")
def qw(eval_world: World) -> QuoteWorld:
    world = QuoteWorld(eval_world, eval_world.a, n_products=2)
    for code, (name, low, high) in TYPES.items():
        r = rpc(
            world.w,
            world.owner.token,
            "save_item_type",
            p_tenant_id=world.t.id,
            p_code=code,
            p_name=name,
            p_position=1,
            p_active=True,
            p_min_price_paise=low,
            p_max_price_paise=high,
        )
        assert r.status_code == 200, r.text
    return world


def _outside(code: str, price: int) -> bool:
    """The soft warning, written from the rule: below the lowest or above the highest of the item type's range (a missing bound is no bound)."""
    _, low, high = TYPES[code]
    return (low is not None and price < low) or (high is not None and price > high)


def _enquiry(qw: QuoteWorld) -> str:
    from evidence_support import pg

    eid = uid()
    r = pg(qw.w.stack, qw.owner, "POST", "/enquiries", json={"id": eid, "tenant_id": qw.t.id, "lead_id": qw.t.rows["leads"]["id"], "channel": "email",
           "received_at": "2026-10-05T10:00:00+00:00", "body": f"Synthetic enquiry {eid}"}, representation=False)  # fmt: skip
    assert r.status_code == 201, r.text
    return eid


def _expected_request(
    kind: str, lines: list[dict[str, Any]], pol: dict[str, Any]
) -> dict[str, Any]:
    """The request the plan's rules give, written from the rules and not from the database function."""
    rate = pol["gst_rate_bps"]
    items = [
        {
            "sku": f"LINE-{n}",
            "name": TYPES[ln["item_type_code"]][0],
            "unit_price": ln["unit_price_paise"],
            "minimum_order_quantity": 1,
            "price_breaks": [],
            "tax_bps": rate,
        }
        for n, ln in enumerate(lines, 1)
    ]
    customer = (
        {"kind": "new"}
        if kind == "new"
        else {"kind": "repeat", "credit_limit": pol["repeat_credit_limit_paise"]}
    )
    return {
        "as_of": today(),
        "price_list": sorted(items, key=lambda i: i["sku"]),
        "customer": customer,
        "order_lines": [{"sku": f"LINE-{n}", "qty": ln["qty"]} for n, ln in enumerate(lines, 1)],
        "policy": {
            "discount_ceiling_bps": 0,
            "shipping": {"flat_fee": 0, "tax_bps": rate},
            "validity_days": pol["validity_days"],
            "payment_terms": {
                "new_advance_bps": pol["new_advance_bps"],
                "repeat_advance_bps": pol["repeat_advance_bps"],
                "net_days": pol["new_net_days"] if kind == "new" else pol["repeat_net_days"],
            },
            "tax_mode": "exclusive",
            "rounding_mode": "half_up",
        },
    }


def _database_request(qw: QuoteWorld, kind: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    policy = operator_sql.sql(
        f"select app.quote_active_policy_version('{qw.t.id}', app.quote_today())"
    ).strip()  # a manual quote needs no price list
    resolved = [
        {
            "item_type_code": ln["item_type_code"],
            "name": TYPES[ln["item_type_code"]][0],
            "qty": ln["qty"],
            "unit_price_paise": ln["unit_price_paise"],
        }
        for ln in lines
    ]
    raw = operator_sql.sql(
        f"select (app.quote_build_manual('{qw.t.id}', app.quote_today(), '{kind}', '{policy}', '{json.dumps(resolved)}'::jsonb) -> 'request')::text"
    )
    return dict(json.loads(raw))


def _create(
    qw: QuoteWorld,
    enquiry: str,
    kind: str,
    lines: list[dict[str, Any]],
    pol: dict[str, Any],
    state: str | None = None,
) -> Any:
    request = _expected_request(kind, lines, pol)
    result = engine_port.run_quote(request)
    assert not engine_port.is_rejected(result), result
    return result, rpc(qw.w, qw.owner.token, "create_manual_quote_draft", p_quote_id=uid(), p_enquiry_id=enquiry, p_customer_kind=kind, p_delivery_state=state,
                       p_engine_version=engine_port.engine_version(), p_request_text=engine_port.canonical_json(request), p_result_text=engine_port.canonical_json(result), p_lines=lines)  # fmt: skip


def test_the_database_accepts_the_real_engines_output_for_manual_quotes_on_random_inputs(
    qw: QuoteWorld,
) -> None:
    rng = random.Random(20261030)
    approved = 0
    for case in range(CASES):
        pol = {
            "shipping_flat_fee_paise": rng.choice([0, rng.randint(1, 300000)]), "shipping_tax_bps": rng.choice([0, 500, 1800]), "validity_days": rng.randint(1, 60),
            "new_advance_bps": rng.randint(0, 10000), "repeat_advance_bps": rng.randint(0, 10000), "new_net_days": rng.randint(0, 90), "repeat_net_days": rng.randint(0, 90),
            "gst_rate_bps": rng.choice([0, 1, 250, 500, 1200, 1800, 2800, rng.randint(0, 2800)]), "rounding_mode": rng.choice(["half_up", "half_even", "down"]),
            "repeat_credit_limit_paise": rng.choice([0, rng.randint(1, 20_000_000)]), "seller_state": rng.choice(["TS", "KA"]),
        }  # fmt: skip
        qw.policy_version(
            **pol
        )  # the policy's freight, its rounding mode and its shipping tax are list-price settings: a manual quote must ignore all three
        n_lines = rng.randint(1, 5)
        lines: list[dict[str, Any]] = [
            {"item_type_code": rng.choice(list(TYPES)), "qty": rng.choice([rng.randint(1, 200), rng.randint(1, 12), 1, 10000]),
             "unit_price_paise": rng.choice([rng.randint(1, 40), rng.randint(1, 5000), rng.randint(1000, 600_000), 100_000_000])}
            for _ in range(n_lines)
        ]  # fmt: skip
        kind = rng.choice(["new", "repeat"])
        label = f"case {case} (seed 20261030): {n_lines} lines, gst {pol['gst_rate_bps']}, {kind}, policy rounding {pol['rounding_mode']}"
        built = _database_request(qw, kind, lines)
        assert built == _expected_request(kind, lines, pol), (
            f"{label}: the database builds another request than the plan's rules give"
        )
        result, created = _create(
            qw, _enquiry(qw), kind, lines, pol, state=rng.choice([None, "TS", "KA"])
        )
        assert created.status_code == 200, (
            f"{label}: the database refused the REAL engine's output: {created.text}"
        )
        row = qw.quote_row(created.json()["quote_id"])
        totals = result["totals"]
        assert (row["merchandise_net_paise"], row["item_tax_paise"], row["shipping_net_paise"], row["shipping_tax_paise"], row["total_paise"]) == (
            totals["net"], totals["item_tax"], 0, 0, totals["total"]), label  # fmt: skip
        assert (row["advance_paise"], row["balance_paise"]) == (
            result["payment_terms"]["advance_amount"],
            result["payment_terms"]["balance"],
        ), label
        stored = json.loads(
            operator_sql.sql(
                f"select coalesce(json_agg(json_build_object('tax', tax_paise, 'bps', tax_bps, 'code', item_type_code, 'src', price_source, 'price', unit_price_applied_paise) order by line_no), '[]') from public.quote_lines where quote_id = '{created.json()['quote_id']}'"
            )
        )
        assert [(s["tax"], s["bps"], s["code"], s["src"], s["price"]) for s in stored] == [
            (ln_out["tax"], pol["gst_rate_bps"], ln["item_type_code"], "typed_by_person", ln["unit_price_paise"]) for ln, ln_out in zip(lines, result["lines"], strict=True)], label  # fmt: skip
        outside = any(
            _outside(str(ln["item_type_code"]), int(ln["unit_price_paise"])) for ln in lines
        )
        assert ("TYPED_PRICE_OUTSIDE_RANGE" in row["review_flags"]) == outside, (
            f"{label}: the soft warning"
        )
        assert ("REPEAT_CUSTOMER_CLAIMED" in row["review_flags"]) == (kind == "repeat"), label
        codes = sorted({r["code"] for r in result["flags"]["reasons"]})
        assert row["engine_flags"] == "{" + ",".join(codes) + "}", label
        if case % 3 == 0:
            r = qw.approve(created.json()["quote_id"])
            assert r.status_code == 200, f"{label}: approval refused: {r.text}"
            approved += 1
    assert approved >= 1


@pytest.mark.parametrize(
    ("price", "qty", "rate", "expected_tax"),
    [
        (10, 1, 500, 1),
        (30, 1, 500, 2),
        (50, 1, 500, 3),
        (9, 1, 500, 0),
        (1, 1, 500, 0),
        (100_000_000, 10_000, 2800, 280_000_000_000),
        (1, 1, 0, 0),
        (7, 1, 1, 0),
        (5000, 1, 1, 1),
    ],
)
def test_half_paise_ties_round_up_for_a_manual_quote_whatever_the_policy_rounding_is(
    qw: QuoteWorld, price: int, qty: int, rate: int, expected_tax: int
) -> None:
    pol = {"shipping_flat_fee_paise": 0, "shipping_tax_bps": 0, "validity_days": 15, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "new_net_days": 10, "repeat_net_days": 45,
           "gst_rate_bps": rate, "rounding_mode": "half_even", "repeat_credit_limit_paise": 0, "seller_state": "TS"}  # fmt: skip
    qw.policy_version(**pol)
    lines = [{"item_type_code": "EQ1", "qty": qty, "unit_price_paise": price}]
    result, created = _create(qw, _enquiry(qw), "new", lines, pol)
    assert created.status_code == 200, created.text
    row = qw.quote_row(created.json()["quote_id"])
    assert row["item_tax_paise"] == expected_tax == result["totals"]["item_tax"]


def test_without_a_rate_in_force_on_the_quote_date_nothing_is_stored(qw: QuoteWorld) -> None:
    pol = {"shipping_flat_fee_paise": 0, "shipping_tax_bps": 0, "validity_days": 15, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "new_net_days": 10, "repeat_net_days": 45,
           "gst_rate_bps": 500, "gst_effective_from": operator_sql.sql("select (app.quote_today() + 5)::text").strip(), "repeat_credit_limit_paise": 0, "seller_state": "TS"}  # fmt: skip
    qw.policy_version(**pol)
    enquiry = _enquiry(qw)
    created = rpc(qw.w, qw.owner.token, "create_manual_quote_draft", p_quote_id=uid(), p_enquiry_id=enquiry, p_customer_kind="new", p_delivery_state=None,
                  p_engine_version=engine_port.engine_version(), p_request_text=json.dumps({"as_of": today()}), p_result_text="{}", p_lines=[{"item_type_code": "EQ1", "qty": 1, "unit_price_paise": 1000}])  # fmt: skip
    assert created.status_code in (400, 409, 422), created.text
    assert created.json().get("code") == "SM217", created.text
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where enquiry_id = '{enquiry}'"
        ).strip()
        == "0"
    )


def test_an_approved_manual_quote_becomes_an_order_with_the_quotes_own_totals(
    qw: QuoteWorld,
) -> None:
    """Order conversion reads the quote's totals, not its lines (a manual quote has no product): the order must carry exactly the quote's total and advance."""
    from order_support import OrderWorld

    pol = {"shipping_flat_fee_paise": 0, "shipping_tax_bps": 0, "validity_days": 15, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "new_net_days": 10, "repeat_net_days": 45,
           "gst_rate_bps": 500, "repeat_credit_limit_paise": 0, "seller_state": "TS"}  # fmt: skip
    qw.policy_version(**pol)
    lines = [
        {"item_type_code": "EQ1", "qty": 3, "unit_price_paise": 250_000},
        {"item_type_code": "EQ4", "qty": 1, "unit_price_paise": 99_999},
    ]
    _, created = _create(qw, _enquiry(qw), "new", lines, pol)
    assert created.status_code == 200, created.text
    quote = created.json()["quote_id"]
    assert qw.approve(quote).status_code == 200
    ow = OrderWorld(qw)
    assert ow.policy()["version_no"] >= 1
    order = ow.create_order(quote)
    assert order.status_code == 200, order.text
    state = ow.snapshot(str(order.json()["order_id"]))
    row = qw.quote_row(quote)
    assert (
        (state.order_total_paise, state.advance_paise)
        == (row["total_paise"], row["advance_paise"])
        == (892_499, 446_250)
    )


# ---------------------------------------------------------------------------------------------- races (the lock order is the list path's: the enquiry row, the requirement row, the quote numbers)
def _create_payload(
    qw: QuoteWorld, enquiry: str, quote: str, lines: list[dict[str, Any]], pol: dict[str, Any]
) -> dict[str, Any]:
    request = _expected_request("new", lines, pol)
    result = engine_port.run_quote(request)
    assert not engine_port.is_rejected(result), result
    return dict(p_quote_id=quote, p_enquiry_id=enquiry, p_customer_kind="new", p_delivery_state=None, p_engine_version=engine_port.engine_version(),
                p_request_text=engine_port.canonical_json(request), p_result_text=engine_port.canonical_json(result), p_lines=lines)  # fmt: skip


def _race_policy(qw: QuoteWorld) -> dict[str, Any]:
    pol = {"shipping_flat_fee_paise": 0, "shipping_tax_bps": 0, "validity_days": 15, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "new_net_days": 10, "repeat_net_days": 45,
           "gst_rate_bps": 500, "repeat_credit_limit_paise": 0, "seller_state": "TS"}  # fmt: skip
    qw.policy_version(**pol)
    return pol


def test_the_same_create_sent_eight_times_at_once_makes_one_quote(qw: QuoteWorld) -> None:
    from concurrent.futures import ThreadPoolExecutor

    pol = _race_policy(qw)
    enquiry, quote = _enquiry(qw), uid()
    payload = _create_payload(
        qw, enquiry, quote, [{"item_type_code": "EQ1", "qty": 2, "unit_price_paise": 12_345}], pol
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(
            pool.map(
                lambda _: rpc(qw.w, qw.owner.token, "create_manual_quote_draft", **payload),
                range(8),
            )
        )
    assert [a.status_code for a in answers] == [200] * 8, [a.text for a in answers]
    assert sorted(bool(a.json()["replayed"]) for a in answers) == [False] + [True] * 7
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where enquiry_id = '{enquiry}'"
        ).strip()
        == "1"
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.requirements where enquiry_id = '{enquiry}'"
        ).strip()
        == "1"
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.quote_lines where quote_id = '{quote}'"
        ).strip()
        == "1"
    )


def test_different_drafts_at_once_on_one_enquiry_leave_one_draft_and_one_requirement(
    qw: QuoteWorld,
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    pol = _race_policy(qw)
    enquiry = _enquiry(qw)
    payloads = [
        _create_payload(
            qw,
            enquiry,
            uid(),
            [{"item_type_code": "EQ1", "qty": 1, "unit_price_paise": 1000 + n}],
            pol,
        )
        for n in range(5)
    ]
    with ThreadPoolExecutor(max_workers=5) as pool:
        answers = list(
            pool.map(
                lambda p: rpc(qw.w, qw.owner.token, "create_manual_quote_draft", **p), payloads
            )
        )
    assert [a.status_code for a in answers] == [200] * 5, [a.text for a in answers]
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where enquiry_id = '{enquiry}' and status = 'draft'"
        ).strip()
        == "1"
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where enquiry_id = '{enquiry}' and status = 'superseded'"
        ).strip()
        == "4"
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.requirements where enquiry_id = '{enquiry}'"
        ).strip()
        == "1"
    )
    numbers = (
        operator_sql.sql(
            f"select string_agg(quote_no::text, ',') from public.quotes where enquiry_id = '{enquiry}'"
        )
        .strip()
        .split(",")
    )
    assert len(set(numbers)) == 5


def test_creates_on_different_enquiries_at_once_get_distinct_numbers_and_two_approvals_approve_once(
    qw: QuoteWorld,
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    pol = _race_policy(qw)
    enquiries = [_enquiry(qw) for _ in range(6)]
    payloads = [
        _create_payload(
            qw, e, uid(), [{"item_type_code": "EQ1", "qty": 1, "unit_price_paise": 2000}], pol
        )
        for e in enquiries
    ]
    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = list(
            pool.map(
                lambda p: rpc(qw.w, qw.owner.token, "create_manual_quote_draft", **p), payloads
            )
        )
    assert [a.status_code for a in answers] == [200] * 6, [a.text for a in answers]
    assert len({a.json()["quote_no"] for a in answers}) == 6
    quote = answers[0].json()["quote_id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        approvals = list(pool.map(lambda _: qw.approve(quote), range(2)))
    assert [a.status_code for a in approvals] == [200, 200], [a.text for a in approvals]
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where id = '{quote}' and status = 'approved'"
        ).strip()
        == "1"
    )
