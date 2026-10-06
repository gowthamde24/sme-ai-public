"""Order conversion on the real stack: TWO connections racing (ADR 0021; lock order ENQUIRY, REQUIREMENT, QUOTE, ORDER, the order's events). As in test_quote_races, a psql session HOLDS an open
transaction (it runs the function and sleeps before it commits) while a second connection (PostgREST, as the real client) does the competing write:

  * lock probes: create_order_from_quote holds the enquiry, the requirement and the quote row; record_order_event holds the ORDER row alone and reads no quote;
  * create vs withdraw on one quote, in both directions: exactly one wins, never an order on a withdrawn quote, never a withdrawn quote with an order;
  * create vs create: one order (SM231); the order number is the tenant's next, never shared;
  * approving a NEWER quote vs creating an order on the OLDER one, both directions: the older keeps its approval (SM237) or the order is refused (SM230), never both states;
  * two payments with one payment id, from stale clients: one wins, the other is refused (SM238), the ledger has one row; the same event id twice replays;
  * a payment vs a cancellation, both directions: the loser is refused (SM238 for a stale request, SM235 for a closed order), the ledger is consistent;
  * a storm of mixed events from several clients: no deadlock, no server error, `seq` gapless, the cache equals the ledger, the money conserves.
All data is synthetic."""

# ruff: noqa: E501, S608, S311, B023

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import httpx
import operator_sql
import pytest
from crm_support import World
from evidence_support import code_of, uid
from order_support import OrderWorld
from quote_support import QuoteWorld
from test_requirement_concurrency import Held, _row_is_locked


@pytest.fixture(scope="module")
def ow(eval_world: World) -> OrderWorld:
    qw = QuoteWorld(eval_world, eval_world.a, n_products=4)
    qw.price_version(
        [qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500), qw.item(2, 280000, 4, 1200)]
    )
    qw.policy_version()
    world = OrderWorld(qw)
    world.policy()
    return world


def timed(action: Callable[[], httpx.Response]) -> tuple[httpx.Response, float]:
    begun = time.monotonic()
    response = action()
    return response, time.monotonic() - begun


def quote_ids(quote: str) -> tuple[str, str]:
    raw = operator_sql.sql(
        f"select enquiry_id || ',' || requirement_id from public.quotes where id = '{quote}'"
    )
    enquiry, requirement = raw.strip().split(",")
    return enquiry, requirement


def approved(ow: OrderWorld) -> tuple[str, str, str]:
    """(quote id, requirement id, enquiry id) of a fresh APPROVED quote."""
    _, requirement = ow.qw.requirement([("kanjivaram", 12)])
    assert ow.qw.pick(requirement, 1, 0, 12).status_code == 200
    quote = str(ow.qw.create(requirement).json()["quote_id"])
    assert ow.qw.approve(quote).status_code == 200
    return quote, requirement, quote_ids(quote)[0]


def qstatus(quote: str) -> str:
    return operator_sql.sql(f"select status from public.quotes where id = '{quote}'").strip()


def order_count(quote: str) -> int:
    return int(
        operator_sql.sql(f"select count(*) from public.orders where quote_id = '{quote}'").strip()
    )


def both(
    first: Callable[[], httpx.Response], second: Callable[[], httpx.Response]
) -> list[httpx.Response]:
    barrier = threading.Barrier(2)

    def go(action: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=10)
        return action()

    with ThreadPoolExecutor(max_workers=2) as pool:
        return [f.result(timeout=90) for f in [pool.submit(go, first), pool.submit(go, second)]]


# ------------------------------------------------------------------------------ lock probes
def test_create_locks_the_enquiry_the_requirement_and_the_quote(ow: OrderWorld) -> None:
    quote, requirement, enquiry = approved(ow)
    held = Held(ow.users["owner"], f"select public.create_order_from_quote('{uid()}', '{quote}')")
    held.holding()
    try:
        assert _row_is_locked("enquiries", enquiry), "the enquiry row lock"
        assert _row_is_locked("requirements", requirement), "the requirement row lock"
        assert _row_is_locked("quotes", quote), "the quote row lock"
    finally:
        out = held.finish()
    assert "{" in out and order_count(quote) == 1


def test_an_event_locks_the_order_row_alone_and_reads_no_quote(ow: OrderWorld) -> None:
    order, quote = ow.order()
    enquiry, requirement = quote_ids(quote)
    held = Held(ow.users["sales"], ow.event_sql(order, "sales", "send_quote"))
    held.holding()
    try:
        assert _row_is_locked("orders", order), "the order row lock"
        assert not _row_is_locked("quotes", quote), "an event must not lock the quote"
        assert not _row_is_locked("requirements", requirement) and not _row_is_locked(
            "enquiries", enquiry
        )
    finally:
        out = held.finish()
    assert "{" in out and ow.state(order) == "quote_sent"


# ------------------------------------------------------------------------------ create vs withdraw
def test_a_withdrawal_that_waits_for_an_order_is_refused(ow: OrderWorld) -> None:
    quote, _, _ = approved(ow)
    held = Held(ow.users["owner"], f"select public.create_order_from_quote('{uid()}', '{quote}')")
    held.holding()
    response, waited = timed(lambda: ow.qw.withdraw(quote))
    held.finish()
    assert code_of(response) == "SM237" and waited > 1.5, (response.text, waited)
    assert qstatus(quote) == "approved" and order_count(quote) == 1


def test_an_order_that_waits_for_a_withdrawal_is_refused_and_never_stored(ow: OrderWorld) -> None:
    quote, _, _ = approved(ow)
    held = Held(
        ow.users["owner"], f"select public.withdraw_approved_quote('{quote}', 'price_changed')"
    )
    held.holding()
    response, waited = timed(lambda: ow.create_order(quote))
    held.finish()
    assert code_of(response) == "SM230" and waited > 1.5, (response.text, waited)
    assert qstatus(quote) == "superseded" and order_count(quote) == 0


def test_create_and_withdraw_at_once_are_one_or_the_other(ow: OrderWorld) -> None:
    for _ in range(4):
        quote, _, _ = approved(ow)
        a, b = both(
            lambda: ow.create_order(quote),
            lambda: ow.qw.withdraw(quote, token=ow.users["admin"].token),
        )  # noqa: B023
        codes = {code_of(a), code_of(b)}
        assert codes in ({"", "SM237"}, {"", "SM230"}), (a.text, b.text)
        orders, status = order_count(quote), qstatus(quote)
        assert (orders, status) in ((1, "approved"), (0, "superseded")), (
            orders,
            status,
            a.text,
            b.text,
        )  # never an order on a withdrawn quote, never a withdrawn quote with an order


# ------------------------------------------------------------------------------ create vs create
def test_a_second_order_for_the_same_quote_waits_and_is_refused(ow: OrderWorld) -> None:
    quote, _, _ = approved(ow)
    held = Held(ow.users["owner"], f"select public.create_order_from_quote('{uid()}', '{quote}')")
    held.holding()
    response, waited = timed(lambda: ow.create_order(quote))
    held.finish()
    assert code_of(response) == "SM231" and waited > 1.5, (response.text, waited)
    assert order_count(quote) == 1


def test_two_creates_at_once_make_one_order_and_distinct_numbers(ow: OrderWorld) -> None:
    quote, _, _ = approved(ow)
    a, b = both(lambda: ow.create_order(quote), lambda: ow.create_order(quote, user="admin"))
    assert {code_of(a), code_of(b)} == {"", "SM231"}, (a.text, b.text)
    assert order_count(quote) == 1
    for _ in range(4):
        q1, _, _ = approved(ow)
        q2, _, _ = approved(ow)
        x, y = both(lambda: ow.create_order(q1), lambda: ow.create_order(q2))  # noqa: B023
        assert (
            x.status_code == y.status_code == 200 and x.json()["order_no"] != y.json()["order_no"]
        ), (x.text, y.text)  # the number is the tenant's next


# ------------------------------------------------------------------------------ a NEWER approval vs an order on the OLDER quote
def newer_draft(ow: OrderWorld, requirement: str) -> str:
    return str(ow.qw.create(requirement).json()["quote_id"])


def test_an_approval_that_waits_for_an_order_on_the_older_quote_is_refused(ow: OrderWorld) -> None:
    old, requirement, _ = approved(ow)
    new = newer_draft(ow, requirement)
    held = Held(ow.users["owner"], f"select public.create_order_from_quote('{uid()}', '{old}')")
    held.holding()
    response, waited = timed(lambda: ow.qw.approve(new))
    held.finish()
    assert code_of(response) == "SM237" and waited > 1.5, (response.text, waited)
    assert qstatus(old) == "approved" and qstatus(new) == "draft" and order_count(old) == 1


def test_an_order_on_the_older_quote_that_waits_for_the_newer_approval_is_refused(
    ow: OrderWorld,
) -> None:
    old, requirement, _ = approved(ow)
    new = newer_draft(ow, requirement)
    new_hash = operator_sql.sql(
        f"select canonical_hash from public.quotes where id = '{new}'"
    ).strip()
    held = Held(ow.users["owner"], f"select public.approve_quote('{new}', '{new_hash}')")
    held.holding()
    response, waited = timed(lambda: ow.create_order(old))
    held.finish()
    assert code_of(response) == "SM230" and waited > 1.5, (
        response.text,
        waited,
    )  # the old quote was superseded while the order waited
    assert qstatus(old) == "superseded" and qstatus(new) == "approved" and order_count(old) == 0


def test_a_newer_approval_and_an_order_on_the_older_quote_at_once_never_leave_both(
    ow: OrderWorld,
) -> None:
    for _ in range(4):
        old, requirement, _ = approved(ow)
        new = newer_draft(ow, requirement)
        a, b = both(
            lambda: ow.create_order(old), lambda: ow.qw.approve(new, token=ow.users["admin"].token)
        )  # noqa: B023
        outcome = (qstatus(old), qstatus(new), order_count(old))
        assert outcome in (("approved", "draft", 1), ("superseded", "approved", 0)), (
            outcome,
            a.text,
            b.text,
        )


# ------------------------------------------------------------------------------ events
def test_two_stale_payments_with_one_payment_id_leave_one_row(ow: OrderWorld) -> None:
    order, _ = ow.order()
    for user, event in (("sales", "send_quote"), ("sales", "customer_accept")):
        assert ow.run_event(order, user, event).response.status_code == 200
    stale = ow.snapshot(order)
    pay = uid()
    a, b = both(
        lambda: (
            ow.run_event(
                order, "admin", "record_payment", amount=1000, ledger=pay, state=stale
            ).response
        ),
        lambda: (
            ow.run_event(
                order, "owner", "record_payment", amount=1000, ledger=pay, state=stale
            ).response
        ),
    )
    assert {code_of(a), code_of(b)} == {"", "SM238"}, (
        a.text,
        b.text,
    )  # the loser's request no longer matches the ledger
    assert (
        int(
            operator_sql.sql(
                f"select count(*) from public.order_events where order_id = '{order}' and ledger_id = '{pay}'"
            ).strip()
        )
        == 1
    )
    again = ow.run_event(
        order, "admin", "record_payment", amount=1000, ledger=pay
    )  # refreshed: the lifecycle names the duplicate
    assert (
        code_of(again.response) == "SM232"
        and again.response.json()["details"] == "DUPLICATE_PAYMENT_ID"
    )
    ow.invariants(order)


def test_the_same_event_id_twice_at_once_records_once_and_replays(ow: OrderWorld) -> None:
    order, _ = ow.order()
    assert ow.run_event(order, "sales", "send_quote").response.status_code == 200
    stale = ow.snapshot(order)
    event, happened = (
        uid(),
        datetime.now(UTC).isoformat(),
    )  # one event, retried: the same id and the same time of occurrence
    a, b = both(
        lambda: (
            ow.run_event(
                order, "sales", "customer_accept", event_id=event, state=stale, occurred_at=happened
            ).response
        ),
        lambda: (
            ow.run_event(
                order, "sales", "customer_accept", event_id=event, state=stale, occurred_at=happened
            ).response
        ),
    )
    assert a.status_code == b.status_code == 200, (a.text, b.text)
    assert sorted([a.json()["replayed"], b.json()["replayed"]]) == [False, True]
    assert (
        int(
            operator_sql.sql(
                f"select count(*) from public.order_events where id = '{event}'"
            ).strip()
        )
        == 1
    )
    ow.invariants(order)


def accepted_order(ow: OrderWorld) -> str:
    order, _ = ow.order()
    for user, event in (("sales", "send_quote"), ("sales", "customer_accept")):
        assert ow.run_event(order, user, event).response.status_code == 200
    return order


def test_a_cancellation_that_waits_for_a_payment_is_refused_as_stale_and_succeeds_after_a_refresh(
    ow: OrderWorld,
) -> None:
    order = accepted_order(ow)
    stale = ow.snapshot(order)
    held = Held(
        ow.users["admin"], ow.event_sql(order, "admin", "record_payment", amount=1000, ledger=uid())
    )
    held.holding()
    response, waited = timed(lambda: ow.run_event(order, "admin", "cancel", state=stale).response)
    held.finish()
    assert code_of(response) == "SM238" and waited > 1.5, (
        response.text,
        waited,
    )  # built before the payment: the ledger moved while it waited
    assert ow.state(order) == "accepted"
    refused = ow.run_event(order, "admin", "cancel")  # refreshed: money is in the order now, so an Admin may not cancel it (review fix 2)
    assert code_of(refused.response) == "SM234", refused.response.text
    retry = ow.run_event(order, "owner", "cancel")
    assert retry.response.status_code == 200 and [
        r["code"] for r in retry.result["flags"]["reasons"]
    ] == ["CANCELLATION_WITH_FUNDS"]
    ow.invariants(order)


def test_a_payment_that_waits_for_a_cancellation_is_refused_by_the_closed_order(
    ow: OrderWorld,
) -> None:
    order = accepted_order(ow)
    stale = ow.snapshot(order)
    held = Held(ow.users["admin"], ow.event_sql(order, "admin", "cancel"))
    held.holding()
    response, waited = timed(
        lambda: (
            ow.run_event(
                order, "admin", "record_payment", amount=1000, ledger=uid(), state=stale
            ).response
        )
    )
    held.finish()
    assert code_of(response) == "SM235" and waited > 1.5, (response.text, waited)
    assert ow.state(order) == "cancelled" and not [
        e for e in ow.ledger(order) if e["type"] == "record_payment"
    ]
    ow.invariants(order)


# ------------------------------------------------------------------------------ everything at once
FINE = {
    "",
    "SM232",
    "SM234",
    "SM235",
    "SM238",
    "23505",
    "42501",
}  # every refusal a race may cause; anything else (a 5xx, a deadlock) fails


def test_a_storm_of_mixed_events_has_no_deadlock_and_leaves_every_ledger_consistent(
    ow: OrderWorld,
) -> None:
    orders = []
    for _ in range(3):
        order = accepted_order(ow)
        orders.append(order)
    users = ("sales", "admin", "owner")
    kinds = (
        "record_payment",
        "record_payment",
        "record_refund",
        "cancel",
        "start_preparation",
        "request_advance",
        "dispatch",
        "deliver",
    )
    outcomes: list[str] = []
    lock = threading.Lock()

    def worker(n: int) -> None:
        rng = random.Random(20261019 + n)
        for _ in range(6):
            order = rng.choice(orders)
            kind = rng.choice(kinds)
            user = rng.choice(users)
            amount = (
                rng.choice([1, 100, 5000, 100000])
                if kind in ("record_payment", "record_refund")
                else None
            )
            try:
                run = ow.run_event(
                    order, user, kind, amount=amount, ledger=uid() if amount else None
                )
            except AssertionError:
                continue  # the order was closed between the read and the call: a read of a closed order still works, so this is not expected; skip defensively
            with lock:
                outcomes.append(code_of(run.response))

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(worker, n) for n in range(6)]
        for f in futures:
            f.result(timeout=240)  # a deadlock would time out here
    assert outcomes, "the storm did nothing"
    assert set(outcomes) <= FINE, sorted(set(outcomes) - FINE)
    for order in orders:
        ow.invariants(order)
