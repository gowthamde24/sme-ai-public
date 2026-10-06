"""Order conversion on the real stack, through PostgREST exactly as the API will call it (ADR 0021): a REAL approved quote (the real engine, the real approval), an order, and every
event built by app/orders/builder.py from the state read with the caller's token, run through the REAL lifecycle, and recorded by record_order_event.

  * the whole path to closed_paid, with the ledger's money equal to the lifecycle's paid_total / balance_due at every step;
  * the Python builder's request EQUALS the database's `app.order_build` for every role and event type (the contract the two sides keep);
  * who may do what, for real tokens: a Viewer, another tenant, Sales, an Admin, the Owner without a second factor;
  * forged requests and results, a forged owner_override, a stale client, replays and conflicts;
  * the lifecycle's own refusals (overpayment, a refund above what was paid, a payment on a closed order, dispatch without the advance, a cancellation after dispatch);
  * SM237 end to end: the quote of an order cannot be withdrawn or replaced;
  * nothing a Viewer or another tenant reads, and no function body or table reachable from outside.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import aal1_token
from crm_support import World
from evidence_support import code_of, pg, uid
from order_support import OrderWorld
from quote_support import QuoteWorld, rpc

from app.orders import lifecycle_port
from app.orders.builder import OrderEvent, build_request, utc_text


@pytest.fixture(scope="module")
def ow(eval_world: World) -> OrderWorld:
    qw = QuoteWorld(eval_world, eval_world.a, n_products=4)
    qw.price_version(
        [qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500), qw.item(2, 280000, 4, 1200)]
    )
    qw.policy_version()
    return OrderWorld(qw)


def details(r: httpx.Response) -> str:
    try:
        return str(r.json().get("details") or "")
    except ValueError:
        return ""


def ok(r: httpx.Response) -> dict[str, Any]:
    assert r.status_code == 200, r.text
    return dict(r.json())


# ============================================================================ the whole path, with the money equal at every step
def test_the_whole_path_to_closed_paid_with_the_ledger_equal_to_the_lifecycle_at_every_step(
    ow: OrderWorld,
) -> None:
    ow.policy()
    order, quote = ow.order()
    snap = ow.snapshot(order)
    total, advance = snap.order_total_paise, snap.advance_paise
    assert total > advance > 0
    assert (
        operator_sql.sql(
            f"select total_paise || '/' || advance_paise from public.quotes where id = '{quote}'"
        )
        == f"{total}/{advance}"
    ), "the order's figures are the real quote's"
    paid = 0
    steps: list[tuple[str, str, str, int | None]] = [
        ("sales", "send_quote", "quote_sent", None),
        ("sales", "customer_accept", "accepted", None),
        ("sales", "request_advance", "advance_requested", None),
        ("admin", "record_payment", "advance_paid", advance),
        ("sales", "start_preparation", "in_preparation", None),
        ("sales", "dispatch", "dispatched", None),
        ("sales", "deliver", "delivered", None),
        ("admin", "record_payment", "closed_paid", total - advance),
    ]
    for user, event, expected, amount in steps:
        run = ow.run_event(order, user, event, amount=amount, ledger=uid() if amount else None)
        body = ok(run.response)
        assert body["state"] == expected and run.result["new_state"] == expected, (
            event,
            run.response.text,
        )
        if amount:
            paid += amount
        assert run.result["paid_total"] == paid and run.result["balance_due"] == total - paid, event
        view = pg(
            ow.w.stack,
            ow.users["sales"],
            "GET",
            f"/order_ledger?order_id=eq.{order}&select=paid_paise,refunded_paise,net_paise,balance_paise,event_count",
        )
        row = view.json()[0]
        assert (row["paid_paise"], row["net_paise"], row["balance_paise"]) == (
            paid,
            paid,
            total - paid,
        ), event
        ow.invariants(order)
    assert ow.state(order) == "closed_paid" and row["event_count"] == 9
    stored = ow.ledger(order)
    assert [x["new_state"] for x in stored] == ["quote_approved", *[s[2] for s in steps]]
    # the stored hash is the lifecycle's own hash of the stored request (recomputed here, independent of the database)
    for seq in (3, 8):
        raw = operator_sql.sql(
            f"select row_to_json(e) from (select request_text, canonical_hash from public.order_events where order_id = '{order}' and seq = {seq}) e"
        )
        stored_row = json.loads(raw)
        assert stored_row["canonical_hash"] == lifecycle_port.expected_hash(
            json.loads(stored_row["request_text"])
        )
    # a closed order takes nothing
    late = ow.run_event(order, "admin", "record_payment", amount=1, ledger=uid())
    assert code_of(late.response) == "SM235", late.response.text


# ============================================================================ the Python builder equals the database's build
@pytest.mark.parametrize("role", ["owner", "admin", "sales"])
def test_the_builder_and_app_order_build_make_the_same_request_in_every_state(
    ow: OrderWorld, role: str
) -> None:
    ow.policy()
    order, _ = ow.order()
    snap0 = ow.snapshot(order)
    plan = [
        ("sales", "send_quote", None), ("sales", "customer_accept", None), ("admin", "record_payment", 1000), ("admin", "record_payment", 2000), ("owner", "record_refund", 1500), ("owner", "record_refund", 300),
        ("sales", "request_advance", None),
    ]  # fmt: skip
    checked = 0
    for user, event, amount in [(None, None, None), *plan]:
        if event is not None:
            ok(
                ow.run_event(
                    order, user or "owner", event, amount=amount, ledger=uid() if amount else None
                ).response
            )
        snap = ow.snapshot(order)
        for type_ in (
            "send_quote",
            "customer_accept",
            "dispatch",
            "cancel",
            "record_payment",
            "record_refund",
            "deliver",
        ):
            ledger = uid() if type_ in ("record_payment", "record_refund") else None
            amount_ = 777 if ledger else None
            moment = datetime.now(UTC)
            mine = build_request(snap, OrderEvent(type_, amount_, ledger), as_of=moment, role=role)
            amount_sql = str(amount_) if amount_ else "null"
            ledger_sql = "'" + ledger + "'" if ledger else "null"
            owner_sql = "true" if role == "owner" else "false"
            theirs = json.loads(
                operator_sql.sql(
                    f"select app.order_build('{order}', '{type_}', {amount_sql}::bigint, {ledger_sql}::uuid, '{utc_text(moment)}', {owner_sql})::text"
                )
            )
            assert mine == theirs, (role, event, type_, mine, theirs)
            checked += 1
    assert checked >= 42
    assert snap0.state == "quote_approved"


# ============================================================================ who may do what, for real tokens
def test_a_viewer_and_another_tenant_can_neither_create_nor_record_nor_read(ow: OrderWorld) -> None:
    ow.policy()
    order, quote = ow.order()
    other = ow.w.b.users["owner"]
    viewer = ow.users["viewer"]
    assert code_of(ow.create_order(quote, user="viewer")) == "42501"
    assert code_of(ow.create_order(quote, token=other.token)) == "42501"
    as_viewer = ow.run_event(
        order, "owner", "send_quote", token=viewer.token
    )  # the Owner's snapshot and request, the Viewer's token
    assert code_of(as_viewer.response) == "42501"
    as_stranger = ow.run_event(order, "owner", "send_quote", token=other.token)
    assert code_of(as_stranger.response) == "42501"
    assert ow.state(order) == "quote_approved"
    for path in ("/orders", "/order_events", "/order_ledger", "/order_policy_versions"):
        assert pg(ow.w.stack, viewer, "GET", path).json() == [], f"a Viewer reads {path}"
        assert pg(ow.w.stack, other, "GET", path).json() == [], f"another tenant reads {path}"
        assert pg(ow.w.stack, None, "GET", path).status_code in (401, 403), f"anon reads {path}"
    for table in ("orders", "order_events", "order_policy_versions"):
        patch = {
            "orders": {"state": "closed_paid"},
            "order_events": {"seq": 99},
            "order_policy_versions": {"advance_required": False},
        }[table]
        for method, body in (("POST", {"id": uid()}), ("PATCH", patch), ("DELETE", None)):
            r = pg(
                ow.w.stack,
                ow.users["owner"],
                method,
                f"/{table}" + ("" if method == "POST" else f"?id=eq.{order}"),
                json=body,
            )
            assert r.status_code in (401, 403), (table, method, r.text)  # no client write grant
    assert (
        pg(
            ow.w.stack,
            ow.users["sales"],
            "GET",
            f"/orders?id=eq.{order}&select=state,order_total_paise",
        ).json()[0]["state"]
        == "quote_approved"
    ), "Sales reads orders (amounts included)"


def test_sales_admin_and_the_owner_without_a_second_factor(ow: OrderWorld) -> None:
    ow.policy()
    order, quote = ow.order()
    assert code_of(ow.create_order(quote, user="sales")) == "42501"
    ok(ow.run_event(order, "sales", "send_quote").response)
    ok(ow.run_event(order, "sales", "customer_accept").response)
    assert (
        code_of(ow.run_event(order, "sales", "record_payment", amount=100, ledger=uid()).response)
        == "42501"
    ), "Sales records no money"
    assert code_of(ow.run_event(order, "sales", "cancel").response) == "42501", (
        "Sales cancels nothing"
    )
    assert (
        code_of(ow.run_event(order, "sales", "record_refund", amount=100, ledger=uid()).response)
        == "42501"
    ), "Sales refunds nothing"
    assert (
        code_of(ow.run_event(order, "admin", "record_refund", amount=100, ledger=uid()).response)
        == "SM234"
    ), "an Admin's refund needs the Owner"
    weak_admin = aal1_token(ow.w.stack, ow.users["admin"])
    weak_owner = aal1_token(ow.w.stack, ow.users["owner"])
    assert (
        code_of(
            ow.run_event(
                order, "admin", "record_payment", amount=100, ledger=uid(), token=weak_admin
            ).response
        )
        == "SM306"
    )
    assert code_of(ow.run_event(order, "owner", "cancel", token=weak_owner).response) == "SM306"
    assert (
        code_of(
            ow.run_event(
                order, "owner", "record_refund", amount=100, ledger=uid(), token=weak_owner
            ).response
        )
        == "SM306"
    )
    assert (
        code_of(ow.create_order(quote, token=weak_owner)) == "SM306"
    )  # the factor is checked before the retry is recognised
    # without a second factor the plain events still work
    plain = ow.run_event(
        order, "sales", "request_advance", token=aal1_token(ow.w.stack, ow.users["sales"])
    )
    assert plain.response.status_code == 200, plain.response.text
    assert ow.state(order) == "advance_requested"
    ow.invariants(order)


def test_a_policy_is_the_owners_with_a_second_factor(ow: OrderWorld) -> None:
    body = {
        "advance_required": True,
        "dispatch_requires_advance": True,
        "cancel_allowed_until_state": "in_preparation",
        "allow_zero_value_orders": False,
    }
    args = {
        "p_tenant_id": ow.t.id,
        "p_effective_from": operator_sql.sql("select app.quote_today()"),
        "p_policy": body,
    }
    for user in ("admin", "sales", "viewer"):
        assert (
            code_of(
                rpc(
                    ow.w,
                    ow.users[user].token,
                    "create_order_policy_version",
                    p_version_id=uid(),
                    **args,
                )
            )
            == "42501"
        ), user
    assert (
        code_of(
            rpc(
                ow.w,
                aal1_token(ow.w.stack, ow.users["owner"]),
                "create_order_policy_version",
                p_version_id=uid(),
                **args,
            )
        )
        == "SM306"
    )
    assert (
        code_of(
            rpc(
                ow.w,
                ow.w.b.users["owner"].token,
                "create_order_policy_version",
                p_version_id=uid(),
                **args,
            )
        )
        == "42501"
    )


# ============================================================================ forged requests and results; the derived override; a stale client
def test_a_forged_owner_override_is_refused_and_the_real_override_needs_the_owner_and_a_second_factor(
    ow: OrderWorld,
) -> None:
    ow.policy(
        advance_required=False, dispatch_requires_advance=True
    )  # preparation needs no advance, dispatch does
    order, _ = ow.order()
    for user, event in (
        ("sales", "send_quote"),
        ("sales", "customer_accept"),
        ("sales", "start_preparation"),
    ):
        ok(ow.run_event(order, user, event).response)
    assert ow.state(order) == "in_preparation"
    snap = ow.snapshot(order)
    # an Admin builds the request as if she were the Owner and runs the lifecycle on it: the lifecycle (which cannot know) accepts, the database does not
    forged = build_request(snap, OrderEvent("dispatch"), as_of=datetime.now(UTC), role="owner")
    assert forged["flags"] == {"owner_override": True}
    result = lifecycle_port.run_transition(forged)
    assert result["status"] == "ok" and result["flags"]["reasons"][0]["code"] == "ADVANCE_OVERRIDE"
    attempt = ow.call(order, "admin", "dispatch", forged, result)
    assert code_of(attempt.response) == "SM238", attempt.response.text
    # honest Admin and Sales: the lifecycle itself refuses
    for user in ("admin", "sales"):
        honest = ow.run_event(order, user, "dispatch")
        assert (
            code_of(honest.response) == "SM232" and details(honest.response) == "ADVANCE_NOT_PAID"
        ), (user, honest.response.text)
    # the Owner without a second factor, then with
    weak = ow.run_event(order, "owner", "dispatch", token=aal1_token(ow.w.stack, ow.users["owner"]))
    assert code_of(weak.response) == "SM306"
    assert ow.state(order) == "in_preparation"
    done = ow.run_event(order, "owner", "dispatch")
    assert ok(done.response)["state"] == "dispatched"
    row = json.loads(
        operator_sql.sql(
            f"select row_to_json(e) from (select owner_approved_by, result_text from public.order_events where order_id = '{order}' and type = 'dispatch') e"
        )
    )
    assert (
        row["owner_approved_by"] == str(ow.users["owner"].id)
        and "ADVANCE_OVERRIDE" in row["result_text"]
    )
    ow.invariants(order)


def test_forged_requests_and_results_are_refused_and_change_nothing(ow: OrderWorld) -> None:
    ow.policy()
    order, _ = ow.order()
    ok(ow.run_event(order, "sales", "send_quote").response)
    snap = ow.snapshot(order)
    base = build_request(snap, OrderEvent("customer_accept"), as_of=datetime.now(UTC), role="sales")
    good = lifecycle_port.run_transition(base)
    forged_requests: list[dict[str, Any]] = [
        {**base, "order_total": 1},
        {**base, "current_state": "accepted"},
        {**base, "payments": [{"payment_id": uid(), "amount": 10}]},
        {**base, "policy": {**base["policy"], "advance_required": False}},
        {**base, "valid_until": "2099-01-01T00:00:00Z"},
        {**base, "as_of": "2020-01-01T00:00:00Z"},
        {**base, "flags": {"owner_override": True}},
        {**base, "extra": 1},
    ]
    for forged in forged_requests:
        r = ow.call(
            order, "sales", "customer_accept", forged, lifecycle_port.run_transition(forged)
        )
        assert code_of(r.response) == "SM238", (forged, r.response.text)
    for patch in (
        {"new_state": "closed_paid"}, {"paid_total": 999}, {"balance_due": 0}, {"canonical_hash": "f" * 64}, {"engine_version": "0.9.0"}, {"status": "rejected"},
        {"flags": {"needs_owner_approval": True, "reasons": [{"code": "ADVANCE_OVERRIDE"}]}},
    ):  # fmt: skip
        r = ow.call(order, "sales", "customer_accept", base, {**good, **patch})
        assert code_of(r.response) == "SM238", (patch, r.response.text)
    # a request that is not even an object
    bad = rpc(ow.w, ow.users["sales"].token, "record_order_event", p_event_id=uid(), p_order_id=order, p_type="customer_accept", p_occurred_at=datetime.now(UTC).isoformat(), p_amount_paise=None,
            p_ledger_id=None, p_reason_code=None, p_engine_version="1.0.0", p_request_text="[1]", p_result_text="{}")  # fmt: skip
    assert code_of(bad) == "22023"
    assert ow.state(order) == "quote_sent" and len(ow.ledger(order)) == 2
    ow.invariants(order)
    # the honest one still works
    assert (
        ok(ow.call(order, "sales", "customer_accept", base, good).response)["state"] == "accepted"
    )


def test_replays_conflicts_and_a_stale_client(ow: OrderWorld) -> None:
    ow.policy()
    order, _ = ow.order()
    ok(ow.run_event(order, "sales", "send_quote").response)
    ok(ow.run_event(order, "sales", "customer_accept").response)
    pay = uid()
    first = ow.run_event(order, "admin", "record_payment", amount=5000, ledger=pay)
    assert ok(first.response)["replayed"] is False
    # the exact retry (same event id, same values) replays, though the ledger has moved on since
    retry = ow.call(
        order,
        "admin",
        "record_payment",
        first.request,
        first.result,
        amount=5000,
        ledger=pay,
        event_id=first.event_id,
        occurred_at=first.occurred_at,
    )
    assert (
        ok(retry.response)["replayed"] is True
        and ok(retry.response)["seq"] == ok(first.response)["seq"]
    )
    # the same event id with other values is the constant conflict
    other_amount = ow.call(
        order,
        "admin",
        "record_payment",
        first.request,
        first.result,
        amount=5001,
        ledger=pay,
        event_id=first.event_id,
        occurred_at=first.occurred_at,
    )
    assert code_of(other_amount.response) == "23505"
    other_type = ow.call(
        order,
        "admin",
        "send_quote",
        first.request,
        first.result,
        event_id=first.event_id,
        occurred_at=first.occurred_at,
    )
    assert code_of(other_type.response) == "23505"
    # the same PAYMENT id under a new event id: the stale client's request no longer matches the ledger (SM238); after refreshing, the lifecycle names the duplicate
    stale = ow.snapshot(order)
    ok(ow.run_event(order, "admin", "record_payment", amount=7000, ledger=uid()).response)
    stale_run = ow.run_event(
        order, "admin", "record_payment", amount=100, ledger=uid(), state=stale
    )
    assert code_of(stale_run.response) == "SM238", stale_run.response.text
    duplicate = ow.run_event(order, "admin", "record_payment", amount=100, ledger=pay)
    assert (
        code_of(duplicate.response) == "SM232"
        and details(duplicate.response) == "DUPLICATE_PAYMENT_ID"
    ), duplicate.response.text
    ow.invariants(order)


# ============================================================================ the lifecycle's own refusals, through the database
def test_the_lifecycles_refusals_arrive_as_sm232_with_the_closed_code(ow: OrderWorld) -> None:
    ow.policy()
    order, _ = ow.order()
    snap = ow.snapshot(order)
    advance, total = snap.advance_paise, snap.order_total_paise
    cases: list[tuple[str, str, str, int | None, str]] = [
        ("sales", "customer_accept", "ILLEGAL_TRANSITION", None, ""),
        ("sales", "expire", "QUOTE_NOT_EXPIRED", None, ""),
    ]
    for user, event, code, amount, _ in cases:
        r = ow.run_event(order, user, event, amount=amount)
        assert code_of(r.response) == "SM232" and details(r.response) == code, (
            event,
            r.response.text,
        )
    ok(ow.run_event(order, "sales", "send_quote").response)
    ok(ow.run_event(order, "sales", "customer_accept").response)
    assert (
        details(
            ow.run_event(order, "admin", "record_payment", amount=total + 1, ledger=uid()).response
        )
        == "OVERPAYMENT"
    )
    assert (
        details(ow.run_event(order, "owner", "record_refund", amount=1, ledger=uid()).response)
        == "REFUND_EXCEEDS_PAID"
    )
    assert details(ow.run_event(order, "sales", "start_preparation").response) == "ADVANCE_NOT_PAID"
    ok(ow.run_event(order, "admin", "record_payment", amount=advance, ledger=uid()).response)
    ok(ow.run_event(order, "sales", "start_preparation").response)
    ok(ow.run_event(order, "sales", "dispatch").response)
    assert details(ow.run_event(order, "admin", "cancel").response) == "ILLEGAL_TRANSITION", (
        "a cancellation after dispatch is illegal"
    )
    ok(ow.run_event(order, "sales", "deliver").response)
    ok(
        ow.run_event(
            order, "admin", "record_payment", amount=total - advance, ledger=uid()
        ).response
    )
    assert (
        code_of(ow.run_event(order, "admin", "record_payment", amount=1, ledger=uid()).response)
        == "SM235"
    )
    ow.invariants(order)


def test_a_decline_carries_its_closed_reason_and_a_cancellation_with_funds_is_flagged(
    ow: OrderWorld,
) -> None:
    ow.policy()
    order, _ = ow.order()
    ok(ow.run_event(order, "sales", "send_quote").response)
    assert code_of(ow.run_event(order, "sales", "customer_decline").response) == "22023"
    assert (
        code_of(ow.run_event(order, "sales", "customer_decline", reason="because").response)
        == "22023"
    )
    assert (
        ok(ow.run_event(order, "sales", "customer_decline", reason="bought_elsewhere").response)[
            "state"
        ]
        == "declined"
    )
    assert (
        pg(
            ow.w.stack,
            ow.users["sales"],
            "GET",
            f"/order_ledger?order_id=eq.{order}&select=lost_reason",
        ).json()[0]["lost_reason"]
        == "bought_elsewhere"
    )
    assert (
        operator_sql.sql(f"select closed_at is not null from public.orders where id = '{order}'")
        == "t"
    )
    order2, _ = ow.order()
    for user, event in (("sales", "send_quote"), ("sales", "customer_accept")):
        ok(ow.run_event(order2, user, event).response)
    ok(ow.run_event(order2, "admin", "record_payment", amount=1000, ledger=uid()).response)
    refused = ow.run_event(order2, "admin", "cancel")
    assert code_of(refused.response) == "SM234", refused.response.text  # money in the order: the Owner's (review fix 2)
    assert ow.state(order2) == "accepted"
    weak_owner = aal1_token(ow.w.stack, ow.users["owner"])
    assert code_of(ow.run_event(order2, "owner", "cancel", token=weak_owner).response) == "SM306"
    cancelled = ow.run_event(order2, "owner", "cancel")
    assert ok(cancelled.response)["state"] == "cancelled"
    assert [r["code"] for r in cancelled.result["flags"]["reasons"]] == ["CANCELLATION_WITH_FUNDS"]
    approver = operator_sql.sql(f"select owner_approved_by from public.order_events where order_id = '{order2}' and type = 'cancel'")
    assert approver == str(ow.users["owner"].id)
    order3, _ = ow.order()  # no money: an Admin may still cancel
    assert ok(ow.run_event(order3, "admin", "cancel").response)["state"] == "cancelled"
    ow.invariants(order2)


# ============================================================================ SM237 end to end
def test_the_quote_of_an_order_can_be_neither_withdrawn_nor_replaced(ow: OrderWorld) -> None:
    ow.policy()
    qw = ow.qw
    _, requirement = qw.requirement([("kanjivaram", 12)])
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    old = qw.create(requirement).json()["quote_id"]
    assert qw.approve(old).status_code == 200
    order = ok(ow.create_order(old))["order_id"]
    assert code_of(qw.withdraw(old)) == "SM237"
    new = qw.create(requirement).json()["quote_id"]
    assert code_of(qw.approve(new)) == "SM237"
    assert operator_sql.sql(f"select status from public.quotes where id = '{old}'") == "approved"
    assert operator_sql.sql(f"select status from public.quotes where id = '{new}'") == "draft"
    # once the order is cancelled it no longer blocks its quote (review fix 3): the quote can be withdrawn
    ok(ow.run_event(order, "admin", "cancel").response)
    assert qw.withdraw(old).status_code == 200
    # a quote with no order keeps the old behaviour
    _, req2 = qw.requirement([("banarasi", 12)])
    assert qw.pick(req2, 1, 1, 12).status_code == 200
    q2 = qw.create(req2).json()["quote_id"]
    assert qw.approve(q2).status_code == 200
    assert qw.withdraw(q2).status_code == 200
    r = ow.create_order(q2)
    assert code_of(r) == "SM230"
    # a draft or a rejected quote cannot be ordered
    q3 = qw.create(req2).json()["quote_id"]
    assert code_of(ow.create_order(q3)) == "SM230"
    again = ow.create_order(old, order_id=uid())
    assert code_of(again) == "SM231", again.text
    assert ok(ow.create_order(old, order_id=order))["replayed"] is True


def test_a_lost_deal_does_not_block_a_new_quote_and_the_new_order_runs_to_closed_paid(ow: OrderWorld) -> None:
    ow.policy()
    qw = ow.qw
    _, requirement = qw.requirement([("kanjivaram", 12)])
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    old = qw.create(requirement).json()["quote_id"]
    assert qw.approve(old).status_code == 200
    order = ok(ow.create_order(old))["order_id"]
    ok(ow.run_event(order, "sales", "send_quote").response)
    # in flight: the quote is protected
    new = qw.create(requirement).json()["quote_id"]
    assert code_of(qw.approve(new)) == "SM237"
    ok(ow.run_event(order, "sales", "customer_decline", reason="price").response)
    # lost: the same draft can now be approved, the old quote is superseded, its declined order stays as the record
    assert qw.approve(new).status_code == 200
    assert operator_sql.sql(f"select status from public.quotes where id = '{old}'") == "superseded"
    assert ow.state(order) == "declined"
    second = ok(ow.create_order(new))["order_id"]
    snap = ow.snapshot(second)
    paid = 0
    for user, event, amount in (
        ("sales", "send_quote", None), ("sales", "customer_accept", None), ("admin", "record_payment", snap.advance_paise), ("sales", "start_preparation", None),
        ("sales", "dispatch", None), ("sales", "deliver", None), ("admin", "record_payment", snap.order_total_paise - snap.advance_paise),
    ):  # fmt: skip
        run = ow.run_event(second, user, event, amount=amount, ledger=uid() if amount else None)
        ok(run.response)
        paid += amount or 0
        assert run.result["paid_total"] == paid
    assert ow.state(second) == "closed_paid"
    assert code_of(qw.withdraw(new)) == "SM237"  # closed_paid: the quote stays
    ow.invariants(order)
    ow.invariants(second)


def test_nothing_is_reachable_that_should_not_be(ow: OrderWorld) -> None:
    owner = ow.users["owner"]
    for fn in (
        "order_build",
        "order_decide",
        "order_matrix",
        "order_move_allowed",
        "order_error",
        "order_request_hash",
        "order_stops_followups",
        "order_valid_until_text",
    ):
        assert pg(ow.w.stack, owner, "POST", f"/rpc/{fn}", json={}).status_code in (404, 406), fn
    assert pg(ow.w.stack, owner, "GET", "/order_engine_versions").status_code in (401, 403, 404)
    assert (
        operator_sql.sql(
            "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%order%' and p.prosecdef"
        )
        == "3"
    )
