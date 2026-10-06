"""Order conversion on the real stack: the database's decision EQUALS the real lifecycle's, on generated ledgers (ADR 0021 decision 3).

record_order_event refuses any result that is not what `app.order_decide` computes from the request. That is only safe if the two implementations agree. Here the REAL package
(packages/pure/order_lifecycle, through the adapter) and the database run on the SAME requests and must return the same decision: the status, the first rejection code, the new
state, the money and the flags. Three sources of requests:

  * an exhaustive grid: every state x every event x every time position (before, at and after the end of the quote's last day) x override x advance rules, on a standard order;
  * seeded random orders: totals (zero, tiny, large, at and above the cap), advances (zero, the total, above it), policy flags and windows, ledgers of payments and refunds
    (mostly consistent, sometimes overpaid or refunded beyond what was paid), event amounts (including 0 and above the cap), reused ids, every state and event;
  * the ledger limits: exactly one thousand entries and one above.
A coverage test fails when the generator stops reaching a rejection code, a flag or a state, so a weakened generator cannot pass silently.
Not compared: `allowed_next_events` (guidance for the web, never approval) and the rule trace (stored as given). Not representable in the database, so not generated: a historical
duplicate ledger id (unique indexes), a ledger amount below 1 (a table check), a malformed timestamp (a typed column). All data is synthetic."""

# ruff: noqa: E501, S311, S608

from __future__ import annotations

import json
import os
import random
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from order_support import psql

from app.orders import lifecycle_port
from app.orders.lifecycle_port import STATES, run_transition

CASES = int(os.environ.get("ORDER_EQUIVALENCE_CASES", "2500"))
SEED = 20261019
EVENTS = (
    "send_quote",
    "customer_accept",
    "customer_decline",
    "expire",
    "request_advance",
    "record_payment",
    "start_preparation",
    "dispatch",
    "deliver",
    "cancel",
    "record_refund",
)
PRE = STATES[:6]
CAP = 1_000_000_000
BATCH = 250

MATRIX = {
    "quote_approved": ("send_quote", "expire", "cancel"),
    "quote_sent": ("customer_accept", "customer_decline", "expire", "cancel"),
    "accepted": (
        "request_advance",
        "record_payment",
        "start_preparation",
        "cancel",
        "record_refund",
    ),
    "advance_requested": ("record_payment", "start_preparation", "cancel", "record_refund"),
    "advance_paid": ("record_payment", "start_preparation", "cancel", "record_refund"),
    "in_preparation": ("record_payment", "dispatch", "cancel", "record_refund"),
    "dispatched": ("record_payment", "deliver", "record_refund"),
    "delivered": ("record_payment", "record_refund"),
}


def stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_uuid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def request(state: str, event: dict[str, Any], *, total: int, advance: int, adv_req: bool, disp_req: bool, window: str, payments: list[tuple[str, int]], refunds: list[tuple[str, int]],
            as_of: datetime, until: datetime, override: bool) -> dict[str, Any]:  # fmt: skip
    return {
        "current_state": state,
        "event": event,
        "as_of": stamp(as_of),
        "valid_until": stamp(until),
        "order_total": total,
        "payments": [{"payment_id": i, "amount": a} for i, a in payments],
        "refunds": [{"refund_id": i, "amount": a} for i, a in refunds],
        "policy": {
            "advance_required": adv_req,
            "advance_amount": advance,
            "dispatch_requires_advance": disp_req,
            "cancel_allowed_until_state": window,
        },
        "flags": {"owner_override": override},
    }


def event_for(name: str, amount: int, ledger_id: str) -> dict[str, Any]:
    if name == "record_payment":
        return {"type": name, "amount": amount, "payment_id": ledger_id}
    if name == "record_refund":
        return {"type": name, "amount": amount, "refund_id": ledger_id}
    return {"type": name}


# ---------------------------------------------------------------------------------------------- the two sides
def database(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for start in range(0, len(requests), BATCH):
        chunk = requests[start : start + BATCH]
        raw = psql(
            "select coalesce(jsonb_agg(app.order_decide(t.x) order by t.n), '[]'::jsonb) from jsonb_array_elements($j$"
            + json.dumps(chunk)
            + "$j$::jsonb) with ordinality as t(x, n);"
        )
        out.extend(json.loads(raw))
    return out


def summary_engine(result: dict[str, Any]) -> tuple[Any, ...]:
    if result["status"] == "rejected":
        return ("rejected", result["codes"][0])
    return (
        "ok",
        result["new_state"],
        result["paid_total"],
        result["balance_due"],
        sorted(r["code"] for r in result["flags"]["reasons"]),
    )


def summary_database(decision: dict[str, Any]) -> tuple[Any, ...]:
    if decision["status"] == "rejected":
        return ("rejected", decision["code"])
    return (
        "ok",
        decision["new_state"],
        decision["paid_total"],
        decision["balance_due"],
        sorted(decision["flags"]),
    )


def compare(requests: list[dict[str, Any]], label: str) -> Counter[tuple[Any, ...]]:
    """Run both sides on every request; fail with the first disagreement (request included). Returns what was reached."""
    decisions = database(requests)
    assert len(decisions) == len(requests), label
    reached: Counter[tuple[Any, ...]] = Counter()
    for n, (req, decision) in enumerate(zip(requests, decisions, strict=True)):
        engine = summary_engine(run_transition(req))
        db = summary_database(decision)
        assert db == engine, (
            f"{label} #{n}: the database decided {db}, the lifecycle {engine} for {json.dumps(req)[:1500]}"
        )
        reached[engine[:2] if engine[0] == "rejected" else ("ok", engine[1])] += 1
        for flag in engine[4] if engine[0] == "ok" else ():
            reached[("flag", flag)] += 1
    return reached


# ---------------------------------------------------------------------------------------------- 1. the exhaustive grid
def grid() -> list[dict[str, Any]]:
    base = datetime(2026, 10, 6, 18, 29, 59, tzinfo=UTC)  # the end of 6 October in India
    out: list[dict[str, Any]] = []
    p1, p2, r1 = (str(uuid.UUID(int=i, version=4)) for i in (1, 2, 3))
    for state in STATES:
        for name in EVENTS:
            for shift in (-1, 0, 1):
                for override in (False, True):
                    for adv_req, disp_req in (
                        (True, True),
                        (False, False),
                        (True, False),
                        (False, True),
                    ):
                        for paid in (0, 40000, 100000):
                            refunds = (
                                [(r1, 5000)] if paid == 100000 and name == "record_refund" else []
                            )
                            payments = [(p1, paid)] if paid else []
                            if state == "closed_paid" and paid != 100000:
                                continue  # an unpaid closed order is its own case below
                            out.append(request(state, event_for(name, 1000, p2 if name == "record_payment" else r1 if name == "record_refund" else ""), total=100000, advance=40000, adv_req=adv_req,
                                               disp_req=disp_req, window="in_preparation", payments=payments, refunds=refunds, as_of=base + timedelta(seconds=shift), until=base, override=override))  # fmt: skip
    return out


def test_every_state_and_event_agree_on_the_grid() -> None:
    requests = grid()
    assert len(requests) > 4000
    reached = compare(requests, "grid")
    assert reached[("rejected", "ILLEGAL_TRANSITION")] > 0 and reached[("ok", "closed_paid")] > 0


# ---------------------------------------------------------------------------------------------- 2. seeded random orders
def random_request(rng: random.Random) -> dict[str, Any]:
    state = rng.choice(STATES)
    legal = MATRIX.get(state, ())
    name = rng.choice(legal) if legal and rng.random() < 0.75 else rng.choice(EVENTS)
    total = rng.choice(
        [
            0,
            1,
            rng.randint(1, 5000),
            rng.randint(1, 10_000_000),
            rng.randint(1, CAP),
            CAP,
            rng.randint(100, 3_000_000),
            rng.randint(100, 3_000_000),
        ]
    )
    if rng.random() < 0.03:
        total = CAP + rng.randint(1, 5)
    adv = rng.choice(
        [
            0,
            total,
            rng.randint(0, max(total, 0)),
            rng.randint(0, max(total, 0)),
            rng.randint(0, max(total, 0)),
        ]
    )
    if rng.random() < 0.04:
        adv = total + rng.randint(1, 10)
    adv_req, disp_req = rng.random() < 0.7, rng.random() < 0.7
    window = rng.choice(PRE)
    # ledger: mostly consistent; sometimes overpaid or refunded beyond the payments
    budget = max(total, 1)
    payments: list[tuple[str, int]] = []
    paid = 0
    for _ in range(rng.choice([0, 0, 1, 1, 2, 3, 6])):
        room = budget - paid
        if room < 1:
            break
        amount = rng.randint(1, room) if rng.random() < 0.7 else rng.randint(1, max(1, room // 3))
        payments.append((make_uuid(rng), amount))
        paid += amount
    if state == "closed_paid" and rng.random() < 0.8 and total > 0:
        payments, paid = [(make_uuid(rng), total)], total
    if rng.random() < 0.03 and total > 0:
        payments.append((make_uuid(rng), rng.randint(1, 50)))  # overpaid
        paid += payments[-1][1]
    refunds: list[tuple[str, int]] = []
    returned = 0
    for _ in range(rng.choice([0, 0, 0, 1, 1, 2])):
        room = paid - returned
        if room < 1:
            break
        amount = rng.randint(1, room)
        refunds.append((make_uuid(rng), amount))
        returned += amount
    if rng.random() < 0.03:
        refunds.append((make_uuid(rng), rng.randint(1, 100)))  # refunded beyond what was paid
    # the event
    remaining, net = total - (paid - returned), paid - returned
    amount = rng.choice([1, rng.randint(1, max(1, remaining)) if remaining > 0 else 1, remaining if remaining > 0 else 1, net if net > 0 else 1, rng.randint(1, max(1, total)),
                         rng.randint(1, 100000)])  # fmt: skip
    if rng.random() < 0.03:
        amount = rng.choice([0, CAP + 1, CAP])
    ledger_id = make_uuid(rng)
    if rng.random() < 0.08:
        pool = [i for i, _ in payments] if name == "record_payment" else [i for i, _ in refunds]
        if pool:
            ledger_id = rng.choice(pool)
    until = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=rng.randint(0, 300 * 86400))
    as_of = until + timedelta(seconds=rng.choice([-86400, -3600, -1, 0, 0, 1, 1, 3600, 86400]))
    return request(state, event_for(name, amount, ledger_id), total=total, advance=adv, adv_req=adv_req, disp_req=disp_req, window=window, payments=payments, refunds=refunds,
                   as_of=as_of, until=until, override=rng.random() < 0.4)  # fmt: skip


def test_random_orders_agree() -> None:
    rng = random.Random(SEED)
    requests = [random_request(rng) for _ in range(CASES)]
    reached = compare(requests, f"random (seed {SEED})")
    # the generator must keep reaching what the rules are about (a weakened generator would pass anything)
    for code in ("ILLEGAL_TRANSITION", "QUOTE_NOT_EXPIRED", "QUOTE_EXPIRED", "CANCEL_WINDOW_CLOSED", "ADVANCE_NOT_PAID", "DUPLICATE_PAYMENT_ID", "DUPLICATE_REFUND_ID", "OVERPAYMENT",
                 "REFUND_EXCEEDS_PAID", "CLOSED_UNPAID", "INVALID_ADVANCE", "OUT_OF_RANGE"):  # fmt: skip
        assert reached[("rejected", code)] > 0, f"the generator never reached {code}"
    for flag in ("REFUND_REQUIRES_OWNER_APPROVAL", "ADVANCE_OVERRIDE", "CANCELLATION_WITH_FUNDS"):
        assert reached[("flag", flag)] > 0, f"the generator never reached the flag {flag}"
    for state in STATES[1:]:  # (quote_approved is where an order starts: no event leads back to it)
        assert reached[("ok", state)] > 0, f"the generator never reached the state {state}"


# ---------------------------------------------------------------------------------------------- 3. the ledger limits
def test_the_ledger_limits_agree() -> None:
    rng = random.Random(SEED + 1)
    base = datetime(2026, 10, 6, 6, 0, 0, tzinfo=UTC)
    until = datetime(2026, 10, 6, 18, 29, 59, tzinfo=UTC)

    def ledger(n: int) -> list[tuple[str, int]]:
        return [(make_uuid(rng), 1) for _ in range(n)]

    cases = []
    for n in (999, 1000, 1001):
        cases.append(request("accepted", event_for("record_payment", 1, make_uuid(rng)), total=10**6, advance=100, adv_req=False, disp_req=False, window="in_preparation", payments=ledger(n), refunds=[],
                             as_of=base, until=until, override=False))  # fmt: skip
        cases.append(request("accepted", event_for("record_refund", 1, make_uuid(rng)), total=10**6, advance=100, adv_req=False, disp_req=False, window="in_preparation", payments=[(make_uuid(rng), 5000)],
                             refunds=ledger(n), as_of=base, until=until, override=False))  # fmt: skip
        cases.append(request("accepted", event_for("send_quote", 1, ""), total=10**6, advance=100, adv_req=False, disp_req=False, window="in_preparation", payments=ledger(n), refunds=[], as_of=base,
                             until=until, override=False))  # fmt: skip
    reached = compare(cases, "limits")
    # 1000 entries refuse the next payment (or refund), 1001 entries refuse every event
    assert reached[("rejected", "OUT_OF_RANGE")] == 5, reached
    assert reached[("ok", "accepted")] == 2 and reached[("rejected", "ILLEGAL_TRANSITION")] == 2


def test_the_engine_version_the_database_accepts_is_the_one_the_adapter_allows() -> None:
    assert psql(
        "select string_agg(version, ',' order by version) from public.order_engine_versions"
    ) == ",".join(sorted(lifecycle_port.ALLOWED_LIFECYCLE_VERSIONS))


@pytest.mark.parametrize("bad", [{"current_state": "teleported"}, {"event": {"type": "teleport"}}])
def test_a_state_or_an_event_the_database_does_not_know_is_refused_like_the_lifecycle_refuses_it(
    bad: dict[str, Any],
) -> None:
    base = datetime(2026, 10, 6, 6, 0, 0, tzinfo=UTC)
    good = request("accepted", {"type": "send_quote"}, total=100, advance=10, adv_req=True, disp_req=True, window="in_preparation", payments=[], refunds=[], as_of=base,
                   until=base + timedelta(hours=12), override=False)  # fmt: skip
    compare([{**good, **bad}], "unknown")
