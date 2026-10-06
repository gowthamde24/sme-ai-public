"""Order conversion commit 5 on the real stack: the order ROUTES of our API (the pattern of test_quote_api.py), with real tokens, the real lifecycle and the real database.

  * the whole path to closed_paid through the routes, the ledger equal to the lifecycle at every step;
  * every role: a Viewer, another workspace, anon, Sales, an Admin, the Owner without a second factor;
  * an Admin's refund and funded cancellation (SM234 -> owner_required), an Admin's unfunded cancellation works, an Owner's funded cancellation records the Owner;
  * a forged owner_override in the body is a 422; the override the database derives still works for the Owner (and not for an Admin);
  * a stale client (SM238 -> order_changed), a replay, a conflict;
  * the decline-then-new-quote path (a lost deal does not block a new quote) and a closed_paid order still does;
  * the refusals of creation (not approved, exists, no policy), the policy route, the keyset list.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import aal1_token
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient
from order_support import OrderWorld
from quote_support import QuoteWorld

from app.orders.repository import PostgrestOrdersRepository


@pytest.fixture(scope="module")
def ow(eval_world: World) -> OrderWorld:
    qw = QuoteWorld(eval_world, eval_world.a, n_products=4)
    qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
    qw.policy_version()
    world = OrderWorld(qw)
    world.policy()
    return world


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def headers(ow: OrderWorld, user: str, *, weak: bool = False) -> dict[str, str]:
    token = aal1_token(ow.w.stack, ow.users[user]) if weak else ow.users[user].token
    return {"Authorization": f"Bearer {token}"}


def err(r: httpx.Response) -> str:
    return str(r.json()["error"]["code"])


def create(
    client: TestClient,
    ow: OrderWorld,
    quote: str,
    user: str = "owner",
    order_id: str | None = None,
    **kw: Any,
) -> httpx.Response:
    r: httpx.Response = client.post(
        url(ow.t, "/orders"),
        json={"id": order_id or uid(), "quote_id": quote},
        headers=headers(ow, user, **kw),
    )
    return r


def event(
    client: TestClient,
    ow: OrderWorld,
    order: str,
    user: str,
    type_: str,
    *,
    amount: int | None = None,
    reason: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    **kw: Any,
) -> httpx.Response:
    body: dict[str, Any] = {"id": event_id or uid(), "type": type_}
    if amount is not None:
        body["amount_paise"], body["ledger_id"] = amount, uid()
    if reason:
        body["reason_code"] = reason
    if occurred_at:
        body["occurred_at"] = occurred_at
    r: httpx.Response = client.post(
        url(ow.t, f"/orders/{order}/events"), json=body, headers=headers(ow, user, **kw)
    )
    return r


def get(client: TestClient, ow: OrderWorld, order: str, user: str = "sales") -> dict[str, Any]:
    r = client.get(url(ow.t, f"/orders/{order}"), headers=headers(ow, user))
    assert r.status_code == 200, r.text
    return dict(r.json())


def fresh_order(client: TestClient, ow: OrderWorld) -> tuple[str, str, dict[str, Any]]:
    quote = ow.approved_quote()
    r = create(client, ow, quote)
    assert r.status_code == 201, r.text
    body = dict(r.json())
    return str(body["id"]), quote, body


# ============================================================================ the whole path through the routes
def test_the_whole_path_to_closed_paid_through_the_routes_with_the_ledger_equal_to_the_lifecycle(
    client: TestClient, ow: OrderWorld
) -> None:
    order, quote, created = fresh_order(client, ow)
    total, advance = created["order_total_paise"], created["advance_paise"]
    assert (
        created["state"] == "quote_approved"
        and created["outcome"] == "open"
        and created["balance_paise"] == total
    )
    assert (
        operator_sql.sql(
            f"select total_paise || '/' || advance_paise from public.quotes where id = '{quote}'"
        )
        == f"{total}/{advance}"
    )
    steps = [("sales", "send_quote", None), ("sales", "customer_accept", None), ("sales", "request_advance", None), ("admin", "record_payment", advance), ("sales", "start_preparation", None),
             ("sales", "dispatch", None), ("sales", "deliver", None), ("admin", "record_payment", total - advance)]  # fmt: skip
    paid = 0
    for user, type_, amount in steps:
        r = event(client, ow, order, user, type_, amount=amount)
        assert r.status_code == 200, (type_, r.text)
        body = r.json()
        paid += amount or 0
        assert (
            body["paid_total"] == paid
            and body["balance_due"] == total - paid
            and body["replayed"] is False
        )
        detail = get(client, ow, order)
        assert (detail["paid_paise"], detail["balance_paise"], detail["state"]) == (
            paid,
            total - paid,
            body["state"],
        )
        ow.invariants(order)
    assert (
        body["state"] == "closed_paid"
        and body["outcome"] == "won"
        and body["allowed_next_events"] == []
    )
    assert (
        get(client, ow, order)["events"][-1]["type"] == "record_payment"
        and len(get(client, ow, order)["events"]) == 9
    )
    late = event(client, ow, order, "admin", "record_payment", amount=1)
    assert late.status_code == 409 and err(late) == "order_closed"


# ============================================================================ roles and the second factor
def test_a_viewer_another_workspace_and_anon_get_nothing(
    client: TestClient, ow: OrderWorld
) -> None:
    order, quote, _ = fresh_order(client, ow)
    other = ow.w.b.users["owner"]
    calls = [
        ("GET", "/orders", None),
        ("GET", f"/orders/{order}", None),
        ("POST", "/orders", {"id": uid(), "quote_id": quote}),
        ("POST", f"/orders/{order}/events", {"id": uid(), "type": "send_quote"}),
    ]
    for method, path, body in calls:
        assert client.request(method, url(ow.t, path), json=body).status_code == 401
        viewer = client.request(method, url(ow.t, path), json=body, headers=headers(ow, "viewer"))
        assert viewer.status_code == 403 and err(viewer) == "forbidden", path
        foreign = client.request(
            method, url(ow.t, path), json=body, headers={"Authorization": f"Bearer {other.token}"}
        )
        assert foreign.status_code == 404, path
    assert ow.state(order) == "quote_approved"


def test_sales_admin_and_the_owner_without_a_second_factor(
    client: TestClient, ow: OrderWorld
) -> None:
    order, quote, _ = fresh_order(client, ow)
    assert create(client, ow, quote, "sales").status_code == 403
    assert (
        err(create(client, ow, quote, "owner", weak=True)) == "mfa_required"
        and err(create(client, ow, quote, "admin", weak=True)) == "mfa_required"
    )
    assert event(client, ow, order, "sales", "send_quote").status_code == 200
    assert event(client, ow, order, "sales", "customer_accept").status_code == 200
    r = event(client, ow, order, "sales", "record_payment", amount=100)
    assert r.status_code == 403 and err(r) == "forbidden", (
        "Sales records no money (the database refuses; one generic denial)"
    )
    assert (
        err(event(client, ow, order, "admin", "record_payment", amount=100, weak=True))
        == "mfa_required"
    )
    assert err(event(client, ow, order, "owner", "cancel", weak=True)) == "mfa_required"
    assert event(client, ow, order, "sales", "request_advance", weak=True).status_code == 200, (
        "a plain event needs no second factor"
    )
    assert get(client, ow, order, "admin")["state"] == "advance_requested"


def test_an_admins_refund_and_funded_cancellation_are_the_owners_but_an_unfunded_cancellation_is_not(
    client: TestClient, ow: OrderWorld
) -> None:
    order, _, _ = fresh_order(client, ow)
    for user, type_ in (("sales", "send_quote"), ("sales", "customer_accept")):
        assert event(client, ow, order, user, type_).status_code == 200
    assert event(client, ow, order, "admin", "record_payment", amount=1000).status_code == 200
    refund = event(client, ow, order, "admin", "record_refund", amount=100)
    assert refund.status_code == 403 and err(refund) == "owner_required"
    funded = event(client, ow, order, "admin", "cancel")
    assert (
        funded.status_code == 403
        and err(funded) == "owner_required"
        and funded.json()["error"]["message"] == "This action needs the owner."
    )
    assert ow.state(order) == "accepted"
    done = event(client, ow, order, "owner", "cancel")
    assert (
        done.status_code == 200
        and done.json()["state"] == "cancelled"
        and done.json()["flags"] == ["CANCELLATION_WITH_FUNDS"]
    )
    assert operator_sql.sql(
        f"select owner_approved_by from public.order_events where order_id = '{order}' and type = 'cancel'"
    ) == str(ow.users["owner"].id)
    empty, _, _ = fresh_order(client, ow)
    assert event(client, ow, empty, "admin", "cancel").json()["state"] == "cancelled", (
        "an Admin may cancel an order with no money in it"
    )


def test_a_forged_owner_override_in_the_body_is_refused_and_the_derived_override_works_for_the_owner_only(
    client: TestClient, ow: OrderWorld
) -> None:
    ow.policy(advance_required=False, dispatch_requires_advance=True)
    order, _, _ = fresh_order(client, ow)
    for user, type_ in (
        ("sales", "send_quote"),
        ("sales", "customer_accept"),
        ("sales", "start_preparation"),
    ):
        assert event(client, ow, order, user, type_).status_code == 200
    for field, value in (
        ("owner_override", True),
        ("approved_by", str(ow.users["owner"].id)),
        ("state", "closed_paid"),
        ("order_total_paise", 1),
        ("owner_approved_by", str(ow.users["owner"].id)),
    ):
        r = client.post(
            url(ow.t, f"/orders/{order}/events"),
            json={"id": uid(), "type": "dispatch", field: value},
            headers=headers(ow, "admin"),
        )
        assert r.status_code == 422, field
    refused = event(client, ow, order, "admin", "dispatch")
    assert refused.status_code == 409 and refused.json()["error"] == {
        "code": "order_event_refused",
        "message": "The advance has not been paid.",
        "reason": "ADVANCE_NOT_PAID",
    }
    assert err(event(client, ow, order, "owner", "dispatch", weak=True)) == "mfa_required"
    done = event(client, ow, order, "owner", "dispatch")
    assert done.status_code == 200 and done.json()["flags"] == ["ADVANCE_OVERRIDE"]
    ow.policy()  # back to the default for the other tests


# ============================================================================ a stale client, a replay, a conflict
def test_a_stale_client_is_told_to_reload_a_replay_replays_and_a_changed_replay_conflicts(
    client: TestClient, ow: OrderWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    order, _, _ = fresh_order(client, ow)
    event(client, ow, order, "sales", "send_quote")
    event(client, ow, order, "sales", "customer_accept")
    # replay: the same event id, values and time of occurrence
    moment = datetime.now(UTC).isoformat()
    eid = uid()
    body = {
        "id": eid,
        "type": "record_payment",
        "amount_paise": 5000,
        "ledger_id": uid(),
        "occurred_at": moment,
    }
    first = client.post(
        url(ow.t, f"/orders/{order}/events"), json=body, headers=headers(ow, "admin")
    )
    again = client.post(
        url(ow.t, f"/orders/{order}/events"), json=body, headers=headers(ow, "admin")
    )
    assert (
        first.status_code == again.status_code == 200
        and again.json()["replayed"] is True
        and again.json()["seq"] == first.json()["seq"]
    )
    assert again.json()["allowed_next_events"] == [] and first.json()["allowed_next_events"], (
        "a replay reports no guidance"
    )
    changed = client.post(
        url(ow.t, f"/orders/{order}/events"),
        json={**body, "amount_paise": 5001},
        headers=headers(ow, "admin"),
    )
    assert changed.status_code == 409 and err(changed) == "conflict"
    # a stale read: the API builds its request from a ledger that another event has since changed
    runtime = client.app.state.runtime  # type: ignore[attr-defined]
    stale = runtime.orders.snapshot(ow.users["admin"].token, ow.t.id, order)
    assert event(client, ow, order, "admin", "record_payment", amount=7000).status_code == 200
    monkeypatch.setattr(
        PostgrestOrdersRepository, "snapshot", lambda self, token, tenant, order_id: stale
    )
    r = event(client, ow, order, "admin", "record_payment", amount=100)
    assert (
        r.status_code == 409
        and err(r) == "order_changed"
        and "Reload" in r.json()["error"]["message"]
    )
    monkeypatch.undo()
    assert (
        event(client, ow, order, "admin", "record_payment", amount=100).status_code == 200
    )  # after reloading it goes through
    ow.invariants(order)


def test_the_lifecycles_refusals_arrive_with_one_closed_reason(
    client: TestClient, ow: OrderWorld
) -> None:
    order, _, created = fresh_order(client, ow)
    expect = [
        ("sales", "customer_accept", "ILLEGAL_TRANSITION", None),
        ("sales", "expire", "QUOTE_NOT_EXPIRED", None),
    ]
    for user, type_, reason, amount in expect:
        r = event(client, ow, order, user, type_, amount=amount)
        assert (
            r.status_code == 409
            and r.json()["error"]["reason"] == reason
            and err(r) == "order_event_refused"
        ), type_
    event(client, ow, order, "sales", "send_quote")
    event(client, ow, order, "sales", "customer_accept")
    over = event(
        client, ow, order, "admin", "record_payment", amount=created["order_total_paise"] + 1
    )
    assert over.json()["error"]["reason"] == "OVERPAYMENT"
    assert (
        event(client, ow, order, "owner", "record_refund", amount=1).json()["error"]["reason"]
        == "REFUND_EXCEEDS_PAID"
    )
    assert (
        event(client, ow, order, "sales", "start_preparation").json()["error"]["reason"]
        == "ADVANCE_NOT_PAID"
    )
    pay = uid()
    body = {"id": uid(), "type": "record_payment", "amount_paise": 100, "ledger_id": pay}
    assert (
        client.post(
            url(ow.t, f"/orders/{order}/events"), json=body, headers=headers(ow, "admin")
        ).status_code
        == 200
    )
    dup = client.post(
        url(ow.t, f"/orders/{order}/events"),
        json={**body, "id": uid()},
        headers=headers(ow, "admin"),
    )
    assert dup.json()["error"]["reason"] == "DUPLICATE_PAYMENT_ID"


# ============================================================================ a lost deal does not block a new quote; a finished one does
def test_a_declined_order_does_not_block_a_new_quote_and_the_new_order_runs_to_closed_paid(
    client: TestClient, ow: OrderWorld
) -> None:
    qw = ow.qw
    _, requirement = qw.requirement([("kanjivaram", 12)])
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    old = qw.create(requirement).json()["quote_id"]
    assert qw.approve(old).status_code == 200
    first = create(client, ow, old).json()["id"]
    event(client, ow, first, "sales", "send_quote")
    new = qw.create(requirement).json()["quote_id"]
    blocked = qw.approve(new)
    assert blocked.status_code == 400 and blocked.json()["code"] == "SM237", (
        "while the order is open the quote is protected"
    )
    assert event(client, ow, first, "sales", "customer_decline").status_code == 422, (
        "a decline needs its reason"
    )
    lost = event(client, ow, first, "sales", "customer_decline", reason="price")
    assert lost.status_code == 200 and lost.json()["outcome"] == "lost"
    assert get(client, ow, first)["lost_reason"] == "price"
    assert qw.approve(new).status_code == 200
    assert operator_sql.sql(f"select status from public.quotes where id = '{old}'") == "superseded"
    second = create(client, ow, new)
    assert second.status_code == 201, second.text
    sid, total, advance = (
        second.json()["id"],
        second.json()["order_total_paise"],
        second.json()["advance_paise"],
    )
    for user, type_, amount in (
        ("sales", "send_quote", None),
        ("sales", "customer_accept", None),
        ("admin", "record_payment", advance),
        ("sales", "start_preparation", None),
        ("sales", "dispatch", None),
        ("sales", "deliver", None),
        ("admin", "record_payment", total - advance),
    ):
        assert event(client, ow, sid, user, type_, amount=amount).status_code == 200, type_
    assert (
        get(client, ow, sid)["outcome"] == "won" and get(client, ow, sid)["state"] == "closed_paid"
    )
    assert qw.withdraw(new).json()["code"] == "SM237"  # a closed_paid order keeps its quote
    assert get(client, ow, first)["state"] == "declined", "the lost deal stays as the record"


# ============================================================================ creation, the policy, the list
def test_creation_refusals_have_their_own_codes(client: TestClient, ow: OrderWorld) -> None:
    quote = ow.approved_quote()
    ok = create(client, ow, quote)
    assert ok.status_code == 201
    again = create(client, ow, quote, order_id=ok.json()["id"], user="admin")
    assert again.status_code == 200, "an exact retry replays"
    clash = create(client, ow, quote)
    assert clash.status_code == 409 and err(clash) == "order_exists"
    qw = ow.qw
    _, requirement = qw.requirement([("banarasi", 12)])
    assert qw.pick(requirement, 1, 1, 12).status_code == 200
    draft = qw.create(requirement).json()["quote_id"]
    r = create(client, ow, draft)
    assert r.status_code == 409 and err(r) == "quote_not_approved"
    assert create(client, ow, uid()).status_code in (403, 404), (
        "an unknown quote is a plain refusal"
    )
    for extra in ("total_paise", "state", "approver"):
        assert (
            client.post(
                url(ow.t, "/orders"),
                json={"id": uid(), "quote_id": quote, extra: 1},
                headers=headers(ow, "owner"),
            ).status_code
            == 422
        )


def test_the_owner_publishes_a_policy_with_a_second_factor_and_nobody_else_does(
    client: TestClient, ow: OrderWorld
) -> None:
    r = client.post(
        url(ow.t, "/order-policy-versions"),
        json={
            "id": uid(),
            "effective_from": operator_sql.sql("select app.quote_today()"),
            "advance_required": True,
            "dispatch_requires_advance": True,
            "cancel_allowed_until_state": "in_preparation",
            "allow_zero_value_orders": False,
        },
        headers=headers(ow, "owner"),
    )
    assert r.status_code == 201 and r.json()["version_no"] >= 2 and r.json()["replayed"] is False
    for user in ("admin", "sales", "viewer"):
        assert (
            client.post(
                url(ow.t, "/order-policy-versions"), json={"id": uid()}, headers=headers(ow, user)
            ).status_code
            == 403
        )
    weak = client.post(
        url(ow.t, "/order-policy-versions"),
        json={
            "id": uid(),
            "effective_from": "2026-10-07",
            "advance_required": True,
            "dispatch_requires_advance": True,
            "cancel_allowed_until_state": "in_preparation",
            "allow_zero_value_orders": False,
        },
        headers=headers(ow, "owner", weak=True),
    )
    assert err(weak) == "mfa_required"
    ow.policy()


def test_a_workspace_with_no_order_policy_is_refused_with_its_own_code(
    client: TestClient, stack: Any, signup: Any
) -> None:
    world = World(client, stack, signup)
    qw = QuoteWorld(world, world.a, n_products=2)
    qw.price_version([qw.item(0, 400000, 4, 500)])
    qw.policy_version()
    ow2 = OrderWorld(qw)
    quote = ow2.approved_quote()
    r = create(client, ow2, quote)
    assert r.status_code == 409 and err(r) == "no_order_policy"


def test_the_list_is_newest_first_keyset_paged_and_shows_the_ledger(
    client: TestClient, ow: OrderWorld
) -> None:
    ids = [fresh_order(client, ow)[0] for _ in range(3)]
    page = client.get(url(ow.t, "/orders?limit=2"), headers=headers(ow, "sales")).json()
    assert len(page["items"]) == 2 and page["next_cursor"] and page["items"][0]["id"] == ids[2]
    assert all(k in page["items"][0] for k in ("paid_paise", "balance_paise", "outcome", "state"))
    nxt = client.get(
        url(ow.t, f"/orders?limit=2&cursor={page['next_cursor']}"), headers=headers(ow, "sales")
    ).json()
    assert nxt["items"][0]["id"] != ids[2] and ids[0] in {i["id"] for i in nxt["items"]} | {
        i["id"] for i in page["items"]
    }
    assert (
        client.get(url(ow.t, "/orders?cursor=%25%25"), headers=headers(ow, "sales")).status_code
        == 422
    )


def test_nothing_internal_appears_in_any_response(client: TestClient, ow: OrderWorld) -> None:
    order, _, created = fresh_order(client, ow)
    event(client, ow, order, "sales", "send_quote")
    texts = [
        client.get(url(ow.t, f"/orders/{order}"), headers=headers(ow, "owner")).text,
        client.get(url(ow.t, "/orders"), headers=headers(ow, "owner")).text,
        str(created),
    ]
    for text in texts:
        assert (
            "request_text" not in text
            and "result_text" not in text
            and "hmac" not in text.lower()
            and "suppression" not in text.lower()
        )
        assert (
            not re.search(r"[0-9a-f]{64}", text.replace("canonical_hash", ""))
            or "canonical_hash" in text
        )  # a hash only as the event's own canonical_hash


def test_the_order_carries_guidance_from_the_lifecycle_for_the_callers_role(
    client: TestClient, ow: OrderWorld
) -> None:
    """Rehearsal step 4: the order page offers one form per event the pinned lifecycle would accept, narrowed by the API to the caller's role."""
    order, _, _ = fresh_order(client, ow)
    assert get(client, ow, order, "owner")["allowed_next_events"] == ["send_quote", "cancel"]
    for user, type_ in (("sales", "send_quote"), ("sales", "customer_accept")):
        assert event(client, ow, order, user, type_).status_code == 200
    # accepted, nothing paid: the advance is not in, so preparation is not offered; the owner and sales see the same guidance until money moves
    assert get(client, ow, order, "sales")["allowed_next_events"] == [
        "request_advance",
        "record_payment",
        "cancel",
    ]
    assert event(client, ow, order, "sales", "request_advance").status_code == 200
    assert event(client, ow, order, "admin", "record_payment", amount=1000).status_code == 200
    assert get(client, ow, order, "owner")["allowed_next_events"] == [
        "record_payment",
        "cancel",
        "record_refund",
    ]
    # a closed order offers nothing
    done, _, _ = fresh_order(client, ow)
    assert event(client, ow, done, "admin", "cancel").json()["state"] == "cancelled"
    assert get(client, ow, done, "owner")["allowed_next_events"] == []
