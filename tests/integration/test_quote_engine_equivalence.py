"""T009 part 2 on the real stack: the database's own arithmetic EQUALS the real engine's, on random inputs.

create_quote_draft refuses any result that is not what the database recomputes from its own sources (docs/plans/t009-quote-integration.md, "what the database
proves"). That is only safe if the two implementations agree. Here the REAL engine (packages/quote-engine, through the adapter) runs on the request the database
builds, and the database must ACCEPT the engine's own canonical request and result, store the same figures, and approve the quote later (the approval re-builds from
the picks). Cases are seeded (reproducible) and cover every rounding mode, quantity breaks, free-shipping thresholds, taxed freight, both customer kinds, credit
limits, the minimum order quantity, and half-paise ties. A failure names the case. All data is synthetic."""

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

CASES = int(os.environ.get("QUOTE_EQUIVALENCE_CASES", "30"))


@pytest.fixture(scope="module")
def qw(eval_world: World) -> QuoteWorld:
    return QuoteWorld(eval_world, eval_world.a, n_products=8)


def _random_breaks(rng: random.Random, base: int, moq: int) -> list[dict[str, int]]:
    quantities = sorted(rng.sample(range(moq, moq + 80), rng.randint(0, 3)))
    price, breaks = base, []
    for q in quantities:
        price = max(1, price - rng.randint(0, max(0, base // 5)))
        breaks.append({"min_qty": q, "unit_price_paise": price})
    return breaks


def _assert_accepted(qw: QuoteWorld, requirement: str, kind: str, label: str) -> dict[str, Any]:
    request = qw.build(requirement, kind)
    _, _, result = qw.engine(request["request"])
    created = qw.create(requirement, kind)
    assert created.status_code == 200, (
        f"{label}: the database refused the REAL engine's output: {created.text}"
    )
    row = qw.quote_row(created.json()["quote_id"])
    totals = result["totals"]
    assert (row["merchandise_net_paise"], row["item_tax_paise"], row["shipping_net_paise"], row["shipping_tax_paise"], row["total_paise"]) == (
        totals["net"], totals["item_tax"], totals["shipping"], totals["shipping_tax"], totals["total"]), label  # fmt: skip
    assert (row["advance_paise"], row["balance_paise"]) == (
        result["payment_terms"]["advance_amount"],
        result["payment_terms"]["balance"],
    ), label
    codes = sorted({r["code"] for r in result["flags"]["reasons"]})
    assert row["engine_flags"] == "{" + ",".join(codes) + "}", label
    assert ("REPEAT_CUSTOMER_CLAIMED" in row["review_flags"]) == (kind == "repeat"), (
        label
    )  # derived by the database from the person's claim
    assert row["needs_owner_approval"] == bool(
        codes
        or "TERMS" in row["review_flags"]
        or "MIXED" in row["review_flags"]
        or kind == "repeat"
    ), label
    return {"quote": created.json()["quote_id"], "row": row, "result": result}


def test_the_database_accepts_the_real_engines_output_on_random_inputs(qw: QuoteWorld) -> None:
    rng = random.Random(20261016)
    approved = 0
    for case in range(CASES):
        n_lines = rng.randint(1, 4)
        chosen = rng.sample(range(8), n_lines)
        items, qtys = [], []
        for i in chosen:
            base, moq = (
                rng.choice(
                    [
                        rng.randint(1, 5000),
                        rng.randint(1000, 5_000_000),
                        rng.choice([5, 15, 25, 1005, 99999]),
                    ]
                ),
                rng.randint(1, 12),
            )
            items.append(
                qw.item(
                    i,
                    base,
                    moq,
                    rng.choice([0, 250, 500, 1200, 1250, 1800, 2800, 10000]),
                    _random_breaks(rng, base, moq),
                )
            )
            qtys.append(rng.choice([rng.randint(1, 200), rng.randint(1, 12), moq, max(1, moq - 1)]))
        qw.price_version(items)
        policy: dict[str, Any] = {
            "shipping_flat_fee_paise": rng.choice([0, rng.randint(1, 300000)]), "shipping_tax_bps": rng.choice([0, 500, 1800]), "validity_days": rng.randint(1, 60),
            "new_advance_bps": rng.randint(0, 10000), "repeat_advance_bps": rng.randint(0, 10000), "net_days": rng.randint(0, 90),
            "rounding_mode": rng.choice(["half_up", "half_even", "down"]), "repeat_credit_limit_paise": rng.choice([0, rng.randint(1, 20_000_000)]), "seller_state": rng.choice(["TS", "KA"]),
        }  # fmt: skip
        if rng.random() < 0.5:
            policy["shipping_free_above_paise"] = rng.randint(0, 3_000_000)
        qw.policy_version(**policy)
        terms = ("net_days", 45, "days") if rng.random() < 0.3 else None
        _, requirement = qw.requirement(
            [(rng.choice(["kanjivaram", "banarasi", "paithani", "chanderi"]), q) for q in qtys],
            payment_terms=terms,
        )
        for line, (i, q) in enumerate(zip(chosen, qtys, strict=True), start=1):
            assert qw.pick(requirement, line, i, q).status_code == 200
        kind = rng.choice(["new", "repeat"])
        got = _assert_accepted(
            qw,
            requirement,
            kind,
            f"case {case} (seed 20261016): {n_lines} lines, {policy['rounding_mode']}, {kind}",
        )
        review = got["row"]["review_flags"]
        mixed = len({it["tax_bps"] for it in items}) > 1 and got["row"]["shipping_net_paise"] > 0
        assert ("MIXED_GST_RATES_SHIPPING" in review) == mixed and (
            "TERMS_REQUESTED_BY_CUSTOMER" in review
        ) == (terms is not None), f"case {case}: the database's own review flags"
        if case % 4 == 0:
            r = qw.approve(
                got["quote"]
            )  # the Owner approves any quote: the approval re-builds from the picks and must reproduce the stored request and figures
            assert r.status_code == 200, f"case {case}: approval refused: {r.text}"
            approved += 1
    assert approved >= 1


@pytest.mark.parametrize(
    ("mode", "price", "expected_tax"),
    [
        ("half_up", 5, 1),
        ("half_even", 5, 0),
        ("down", 5, 0),
        ("half_up", 15, 2),
        ("half_even", 15, 2),
        ("down", 15, 1),
    ],
)
def test_half_paise_ties_round_as_the_engine_rounds(
    qw: QuoteWorld, mode: str, price: int, expected_tax: int
) -> None:
    """5 paise at 10 % is exactly half a paisa of tax (0.5), 15 paise is 1.5: half-up rounds up, half-even to the even paisa, down floors."""
    qw.price_version([qw.item(0, price, 1, 1000)])
    qw.policy_version(rounding_mode=mode)
    _, requirement = qw.requirement([("kanjivaram", 1)])
    assert qw.pick(requirement, 1, 0, 1).status_code == 200
    got = _assert_accepted(qw, requirement, "new", f"{mode} {price}")
    assert got["row"]["item_tax_paise"] == expected_tax == got["result"]["totals"]["item_tax"]


@pytest.mark.parametrize(("delta", "free"), [(0, False), (-1, True), (1, False)])
def test_free_shipping_is_strictly_above_the_threshold(
    qw: QuoteWorld, delta: int, free: bool
) -> None:
    qw.price_version([qw.item(0, 100000, 1, 500)])
    _, requirement = qw.requirement([("kanjivaram", 3)])
    assert qw.pick(requirement, 1, 0, 3).status_code == 200
    net = 300000
    qw.policy_version(
        shipping_flat_fee_paise=25000, shipping_free_above_paise=net + delta, shipping_tax_bps=1800
    )
    got = _assert_accepted(qw, requirement, "new", f"threshold {net + delta}")
    assert (got["row"]["shipping_net_paise"] == 0) == free
    assert (
        got["result"]["totals"]["shipping_tax"]
        == got["row"]["shipping_tax_paise"]
        == (0 if free else 4500)
    )


def test_a_repeat_customer_over_the_credit_limit_and_a_below_minimum_line_carry_exactly_the_engines_flags(
    qw: QuoteWorld,
) -> None:
    qw.price_version([qw.item(0, 200000, 10, 500), qw.item(1, 150000, 2, 1200)])
    qw.policy_version(repeat_credit_limit_paise=100000, repeat_advance_bps=1000)
    _, requirement = qw.requirement([("kanjivaram", 5), ("banarasi", 4)])
    assert (
        qw.pick(requirement, 1, 0, 5).status_code == 200
        and qw.pick(requirement, 2, 1, 4).status_code == 200
    )
    got = _assert_accepted(qw, requirement, "repeat", "flags")
    assert (
        got["row"]["engine_flags"] == "{BELOW_MINIMUM_ORDER_QUANTITY,CREDIT_LIMIT_EXCEEDED}"
        and got["row"]["needs_owner_approval"] is True
    )
    assert (
        "MIXED_GST_RATES_SHIPPING" not in got["row"]["review_flags"]
    )  # two rates, but no freight is charged


def test_a_price_list_the_engine_would_reject_cannot_be_published(qw: QuoteWorld) -> None:
    """The database refuses at publication what the engine would refuse at quote time (a break below the minimum order quantity)."""
    bad = qw.item(0, 100000, 10, 500, [{"min_qty": 5, "unit_price_paise": 90000}])
    r = rpc(
        qw.w,
        qw.owner.token,
        "create_price_list_version",
        p_version_id=uid(),
        p_tenant_id=qw.t.id,
        p_effective_from=today(),
        p_items=[bad],
    )
    assert r.status_code == 400 and r.json()["code"] == "23514", r.text


@pytest.mark.parametrize(("delta", "flagged"), [(0, False), (-1, True), (1, False)])
def test_a_balance_equal_to_the_credit_limit_is_not_over_it(
    qw: QuoteWorld, delta: int, flagged: bool
) -> None:
    qw.price_version([qw.item(0, 100000, 1, 500)])
    qw.policy_version(repeat_advance_bps=0)
    _, requirement = qw.requirement([("kanjivaram", 2)])
    assert qw.pick(requirement, 1, 0, 2).status_code == 200
    balance = 2 * 100000 + 2 * 100000 * 500 // 10000  # no advance: the balance is the whole total
    qw.policy_version(repeat_advance_bps=0, repeat_credit_limit_paise=balance + delta)
    got = _assert_accepted(qw, requirement, "repeat", f"credit limit {balance + delta}")
    assert ("CREDIT_LIMIT_EXCEEDED" in got["row"]["engine_flags"]) is flagged


def test_skus_that_sort_differently_by_locale_and_by_code_point_go_through_the_real_engine(
    qw: QuoteWorld,
) -> None:
    """The engine and the API sort by CODE POINT (Python's default); the database must too (COLLATE "C"). 'A-1', 'A1', 'a-2' and 'B 1' are ordered differently by an
    English locale (punctuation ignored, case folded). The price list is shuffled on purpose; the request the database builds must be in code point order, the real engine
    must accept it, create_quote_draft must accept the engine's canonical text, and the approval's rebuild (from the stored text and the picks) must reproduce it."""
    skus = ["a-2", "B 1", "A1", "A-1"]
    indexes = [qw.add_product(f"{sku}") for sku in skus]
    qw.price_version([qw.item(i, 100000 + 1000 * n, 1, 500) for n, i in enumerate(indexes)])
    qw.policy_version()
    _, requirement = qw.requirement(
        [("kanjivaram", 3), ("banarasi", 4), ("paithani", 5), ("chanderi", 6)]
    )
    for line, (i, q) in enumerate(zip(indexes, (3, 4, 5, 6), strict=True), start=1):
        assert qw.pick(requirement, line, i, q).status_code == 200
    request = qw.build(requirement)["request"]
    assert (
        [p["sku"] for p in request["price_list"]] == sorted(skus) == ["A-1", "A1", "B 1", "a-2"]
    )  # Python's sort is code point order
    assert [
        x["sku"] for x in request["order_lines"]
    ] == skus  # the order lines keep the requirement's line order
    got = _assert_accepted(qw, requirement, "new", "collation")
    assert qw.approve(got["quote"]).status_code == 200
    stored = json.loads(
        operator_sql.sql(f"select request_text from public.quotes where id = '{got['quote']}'")
    )
    assert [p["sku"] for p in stored["price_list"]] == [
        "A-1",
        "A1",
        "B 1",
        "a-2",
    ]  # the stored request is in code point order too
