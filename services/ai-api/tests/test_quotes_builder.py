"""T009 step 3: the pure request builder (app/quotes/builder.py). It must produce the request the DATABASE builds (app.quote_build); the real-stack tests
(tests/integration/test_quote_api.py, test_quote_engine_equivalence.py) prove the two equal, these pin the rules by value and attack the edges: sorting by code
point, line order, what a person has not confirmed, units, duplicates, repeat customers and the India date."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pytest

from app.quotes import engine_port
from app.quotes.builder import (
    Line,
    MissingInput,
    Pick,
    Policy,
    PriceItem,
    RequirementFacts,
    build_request,
    policy_json,
    requirement_facts,
    today_ist,
)

AS_OF = date(2026, 10, 6)
POLICY = Policy(
    0, 5000, None, 1800, 15, 5000, 2500, 30, 45, "half_up", 250000, "TG"
)  # 30 days for a new customer, 45 for a repeat one


def item(
    pid: str,
    sku: str,
    price: int = 400000,
    unit: str = "piece",
    breaks: tuple[tuple[int, int], ...] = (),
    tax: int = 500,
) -> PriceItem:
    return PriceItem(pid, sku, f"Synthetic {sku}", unit, price, 4, tax, breaks)


ITEMS = {
    "p1": item("p1", "SYN-K", breaks=((10, 380000), (5, 390000))),
    "p2": item("p2", "SYN-B", 310000, tax=1200),
    "p3": item("p3", "a-lower", 100000),
    "p4": item("p4", "B-UPPER", 100000),
    "p5": item("p5", "é-accent", 100000),
}


def facts(*lines: tuple[int, int]) -> RequirementFacts:
    return RequirementFacts(lines=[Line(n, "kanjivaram", qty, "piece") for n, qty in lines])


def test_the_request_has_exactly_the_documented_shape() -> None:
    request = build_request(
        AS_OF,
        "new",
        facts((1, 20), (2, 5)),
        [Pick(1, "p1", 20, "piece"), Pick(2, "p2", 5, "piece")],
        ITEMS,
        POLICY,
    )
    assert request == {
        "as_of": "2026-10-06",
        "price_list": [
            {
                "sku": "SYN-B",
                "name": "Synthetic SYN-B",
                "unit_price": 310000,
                "minimum_order_quantity": 4,
                "price_breaks": [],
                "tax_bps": 1200,
            },
            {
                "sku": "SYN-K",
                "name": "Synthetic SYN-K",
                "unit_price": 400000,
                "minimum_order_quantity": 4,
                "price_breaks": [
                    {"min_qty": 5, "unit_price": 390000},
                    {"min_qty": 10, "unit_price": 380000},
                ],
                "tax_bps": 500,
            },
        ],
        "customer": {"kind": "new"},
        "order_lines": [
            {"sku": "SYN-K", "qty": 20},
            {"sku": "SYN-B", "qty": 5},
        ],  # the requirement's LINE order, the price list is by sku
        "policy": {
            "discount_ceiling_bps": 0,
            "shipping": {"flat_fee": 5000, "tax_bps": 1800},
            "validity_days": 15,
            "payment_terms": {"new_advance_bps": 5000, "repeat_advance_bps": 2500, "net_days": 30},
            "tax_mode": "exclusive",
            "rounding_mode": "half_up",
        },
    }
    assert not engine_port.is_rejected(
        engine_port.run_quote(request)
    )  # the pinned engine accepts it
    assert "cost" not in str(request) and "margin" not in str(
        request
    )  # a cost never reaches the engine


def test_the_price_list_is_sorted_by_code_point_not_by_locale() -> None:
    picks = [Pick(n, f"p{n + 2}", 5, "piece") for n in (1, 2, 3)]
    request = build_request(AS_OF, "new", facts((1, 5), (2, 5), (3, 5)), picks, ITEMS, POLICY)
    assert [p["sku"] for p in request["price_list"]] == [
        "B-UPPER",
        "a-lower",
        "é-accent",
    ]  # uppercase, lowercase, then non-ASCII: the engine's and the database's order
    assert [o["sku"] for o in request["order_lines"]] == ["a-lower", "B-UPPER", "é-accent"]


def test_a_repeat_customer_carries_the_policys_credit_limit_and_a_free_shipping_threshold_only_when_set() -> (
    None
):
    picks = [Pick(1, "p1", 20, "piece")]
    repeat = build_request(AS_OF, "repeat", facts((1, 20)), picks, ITEMS, POLICY)
    assert repeat["customer"] == {"kind": "repeat", "credit_limit": 250000}
    with_free = Policy(**{**POLICY.__dict__, "shipping_free_above_paise": 3000000})
    assert build_request(AS_OF, "new", facts((1, 20)), picks, ITEMS, with_free)["policy"][
        "shipping"
    ] == {"flat_fee": 5000, "tax_bps": 1800, "free_above": 3000000}
    assert policy_json(POLICY, "new")["shipping"] == {"flat_fee": 5000, "tax_bps": 1800}


def test_the_balance_falls_due_after_the_days_of_the_customers_kind() -> None:
    picks = [Pick(1, "p1", 20, "piece")]
    new = build_request(AS_OF, "new", facts((1, 20)), picks, ITEMS, POLICY)
    repeat = build_request(AS_OF, "repeat", facts((1, 20)), picks, ITEMS, POLICY)
    assert new["policy"]["payment_terms"] == {
        "new_advance_bps": 5000,
        "repeat_advance_bps": 2500,
        "net_days": 30,
    }
    assert repeat["policy"]["payment_terms"]["net_days"] == 45
    # only that number differs between the two requests' policies
    assert {**new["policy"], "payment_terms": None} == {**repeat["policy"], "payment_terms": None}
    for request in (new, repeat):
        assert not engine_port.is_rejected(engine_port.run_quote(request))
    assert engine_port.run_quote(new)["payment_terms"]["due_date"] == "2026-11-05"
    assert engine_port.run_quote(repeat)["payment_terms"]["due_date"] == "2026-11-20"


@pytest.mark.parametrize("kind", ["", "vip", "REPEAT", "New"])
def test_an_unknown_customer_kind_is_refused(kind: str) -> None:
    with pytest.raises(ValueError):
        build_request(AS_OF, kind, facts((1, 20)), [Pick(1, "p1", 20, "piece")], ITEMS, POLICY)


def test_nothing_is_guessed_when_an_input_is_missing() -> None:
    one = [Pick(1, "p1", 20, "piece")]
    with pytest.raises(MissingInput) as no_pick:  # line 2 has no pick
        build_request(AS_OF, "new", facts((1, 20), (2, 5)), one, ITEMS, POLICY)
    assert no_pick.value.lines == [2]
    with pytest.raises(
        MissingInput
    ) as off_list:  # a pick of a product that is not on the price list
        build_request(AS_OF, "new", facts((1, 20)), [Pick(1, "gone", 20, "piece")], ITEMS, POLICY)
    assert off_list.value.lines == [1]
    with pytest.raises(MissingInput) as unit:  # the list sells it by the set, the pick says piece
        build_request(
            AS_OF,
            "new",
            facts((1, 20)),
            [Pick(1, "p6", 20, "piece")],
            {**ITEMS, "p6": item("p6", "SYN-S", unit="set")},
            POLICY,
        )
    assert unit.value.lines == [1]
    with pytest.raises(
        MissingInput
    ) as twice:  # the same product on two lines: v1 cannot quote it (one quantity per sku)
        build_request(
            AS_OF,
            "new",
            facts((1, 20), (2, 5)),
            [Pick(1, "p1", 20, "piece"), Pick(2, "p1", 5, "piece")],
            ITEMS,
            POLICY,
        )
    assert twice.value.lines == [2]
    with pytest.raises(MissingInput) as nothing:  # no line at all
        build_request(AS_OF, "new", RequirementFacts(), [], ITEMS, POLICY)
    assert nothing.value.lines == [0]


def test_a_half_settled_line_is_refused_like_the_database_does() -> None:
    f = RequirementFacts(
        lines=[Line(1, "kanjivaram", 20, "piece"), Line(2, "banarasi", None)]
    )  # a saree type without a quantity
    with pytest.raises(MissingInput) as e:
        build_request(AS_OF, "new", f, [Pick(1, "p1", 20, "piece")], ITEMS, POLICY)
    assert e.value.lines == [2]
    f2 = RequirementFacts(lines=[Line(1, "kanjivaram", 20, "piece"), Line(2, None, 5)])
    with pytest.raises(MissingInput):
        build_request(AS_OF, "new", f2, [Pick(1, "p1", 20, "piece")], ITEMS, POLICY)
    # a line with only a colour is not a line the database reads at all
    f3 = RequirementFacts(
        lines=[Line(1, "kanjivaram", 20, "piece"), Line(2, None, None, None, None, "red")]
    )
    assert [
        o["sku"]
        for o in build_request(AS_OF, "new", f3, [Pick(1, "p1", 20, "piece")], ITEMS, POLICY)[
            "order_lines"
        ]
    ] == ["SYN-K"]


def row(line: int | None, key: str, state: str = "confirmed", **value: Any) -> dict[str, Any]:
    return {
        "line_no": line,
        "field_key": key,
        "state": state,
        "value_code": None,
        "value_int": None,
        "value_date": None,
        "value_text": None,
        "basis": None,
        **value,
    }


def test_only_what_a_person_confirmed_or_corrected_counts() -> None:
    rows = [
        row(1, "saree_type", value_code="kanjivaram"),
        row(1, "quantity", "corrected", value_int=20, basis="piece"),
        row(
            2, "saree_type", "proposed", value_code="banarasi"
        ),  # proposed by an agent, never reviewed
        row(2, "quantity", "rejected", value_int=99, basis="piece"),
        row(None, "delivery_city", value_text="Hyderabad"),
        row(None, "payment_terms", "proposed", value_code="net_days", value_int=60),
    ]
    got = requirement_facts(rows)
    assert [(x.line_no, x.saree_type, x.quantity, x.basis) for x in got.lines] == [
        (1, "kanjivaram", 20, "piece")
    ]
    assert got.delivery_city == "Hyderabad" and got.payment_terms is None


def test_lines_come_out_in_line_order_whatever_the_row_order() -> None:
    rows = [
        row(3, "quantity", value_int=3, basis="set"),
        row(1, "saree_type", value_code="patola"),
        row(3, "saree_type", value_code="paithani"),
        row(1, "quantity", value_int=1, basis="piece"),
    ]
    assert [
        (x.line_no, x.saree_type, x.quantity, x.basis) for x in requirement_facts(rows).lines
    ] == [(1, "patola", 1, "piece"), (3, "paithani", 3, "set")]


def test_the_builder_does_not_modify_its_inputs() -> None:
    f, p = facts((1, 20)), [Pick(1, "p1", 20, "piece")]
    before = (list(f.lines), list(p), dict(ITEMS))
    build_request(AS_OF, "new", f, p, ITEMS, POLICY)
    assert (f.lines, p, ITEMS) == before


@pytest.mark.parametrize(
    ("instant", "expected"),
    [
        (datetime(2026, 10, 5, 18, 29, 59, tzinfo=UTC), date(2026, 10, 5)),
        (datetime(2026, 10, 5, 18, 30, 0, tzinfo=UTC), date(2026, 10, 6)),  # midnight in India
        (datetime(2026, 12, 31, 23, 0, tzinfo=UTC), date(2027, 1, 1)),
        (datetime(2026, 10, 6, 0, 0, tzinfo=UTC), date(2026, 10, 6)),
    ],
)
def test_the_quote_date_is_the_date_in_india(instant: datetime, expected: date) -> None:
    assert today_ist(instant) == expected
