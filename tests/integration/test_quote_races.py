"""T009 part 2 on the real stack: TWO connections racing on one requirement (ADR 0018 decision 9: every writer locks the ENQUIRY row first, then the requirement,
then the quote). As in test_requirement_concurrency, a psql session HOLDS an open transaction (it runs the function and sleeps before it commits) while a second
connection (PostgREST, as the real client) does the competing write:

  * lock probes: pick / create / approve / reject / discard each hold the enquiry row and the requirement row (and approve / reject the quote row);
  * discard vs create: either the discard wins and the create is refused (SM213), or the draft exists and the discard is refused (SM212): never half of each;
  * discard vs approve: SM212 after the approval commits;
  * a pick that changes while a quote is being created makes that quote's request wrong (SM216), not a 500;
  * two approvals at once approve once; two creates at once leave one draft; approve vs reject is one or the other;
  * a five-way storm: no deadlock, at most one draft and one approved quote, a discarded requirement has neither.
All data is synthetic."""

# ruff: noqa: E501, S608, S603, S311

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

import httpx
import operator_sql
import pytest
from crm_support import World
from evidence_support import code_of, uid
from quote_support import QuoteWorld, rpc
from test_requirement_concurrency import Held, _row_is_locked

from app.quotes import engine_port


@pytest.fixture(scope="module")
def qw(eval_world: World) -> QuoteWorld:
    q = QuoteWorld(eval_world, eval_world.a, n_products=4)
    q.price_version(
        [q.item(0, 400000, 4, 500), q.item(1, 310000, 4, 500), q.item(2, 280000, 4, 1200)]
    )
    q.policy_version()
    return q


def ready(qw: QuoteWorld, qty: int = 12, product: int = 0) -> tuple[str, str]:
    eid, requirement = qw.requirement([("kanjivaram", qty)])
    assert qw.pick(requirement, 1, product, qty).status_code == 200
    return eid, requirement


def create_sql(qw: QuoteWorld, requirement: str, quote: str) -> str:
    request = qw.build(requirement)["request"]
    request_text, result_text, _ = qw.engine(request)
    return f"select public.create_quote_draft('{quote}', '{requirement}', 'new', 'TS', '{engine_port.engine_version()}', $q${request_text}$q$, $q${result_text}$q$)"


def hash_of(quote: str) -> str:
    return operator_sql.sql(
        f"select canonical_hash from public.quotes where id = '{quote}'"
    ).strip()


def timed(action: Callable[[], httpx.Response]) -> tuple[httpx.Response, float]:
    begun = time.monotonic()
    response = action()
    return response, time.monotonic() - begun


def status_of(quote: str) -> str:
    return operator_sql.sql(f"select status from public.quotes where id = '{quote}'").strip()


# ------------------------------------------------------------------------------ lock probes
@pytest.mark.parametrize("writer", ["pick", "create", "approve", "reject", "discard", "withdraw"])
def test_every_quote_writer_locks_the_enquiry_then_the_requirement(
    qw: QuoteWorld, writer: str
) -> None:
    eid, requirement = ready(qw)
    quote = ""
    if writer in ("approve", "reject", "withdraw"):
        quote = qw.create(requirement).json()["quote_id"]
    if writer == "withdraw":
        assert qw.approve(quote).status_code == 200
    statements = {
        "pick": f"select public.pick_requirement_line_product('{requirement}', 1::smallint, '{qw.products[0]}', 12, 'piece')",
        "create": create_sql(qw, requirement, uid()),
        "approve": f"select public.approve_quote('{quote}', '{hash_of(quote) if quote else ''}')",
        "reject": f"select public.reject_quote('{quote}', 'wrong_prices')",
        "discard": f"select public.discard_requirement('{requirement}')",
        "withdraw": f"select public.withdraw_approved_quote('{quote}', 'price_changed')",
    }
    user = qw.owner if writer in ("approve", "reject", "discard", "withdraw") else qw.sales
    held = Held(user, statements[writer])
    held.holding()
    try:
        assert _row_is_locked("enquiries", eid), f"{writer}: the enquiry row lock"
        assert _row_is_locked("requirements", requirement), f"{writer}: the requirement row lock"
        if quote:
            assert _row_is_locked("quotes", quote), f"{writer}: the quote row lock"
    finally:
        out = held.finish()
    assert "{" in out  # the function returned its JSON


# ------------------------------------------------------------------------------ the deterministic races
def test_a_create_that_waits_for_a_discard_is_refused_not_stored(qw: QuoteWorld) -> None:
    _, requirement = ready(qw)
    held = Held(qw.sales, f"select public.discard_requirement('{requirement}')")
    held.holding()
    response, waited = timed(lambda: qw.create(requirement))
    held.finish()
    assert code_of(response) == "SM213" and waited > 1.5, (
        response.text,
        waited,
    )  # the discard won: the requirement is no longer confirmed
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where requirement_id = '{requirement}'"
        ).strip()
        == "0"
    )


def test_a_discard_that_waits_for_a_create_is_refused_by_the_draft(qw: QuoteWorld) -> None:
    _, requirement = ready(qw)
    quote = uid()
    held = Held(qw.sales, create_sql(qw, requirement, quote))
    held.holding()
    response, waited = timed(
        lambda: rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement)
    )
    held.finish()
    assert code_of(response) == "SM212" and waited > 1.5, (response.text, waited)
    assert status_of(quote) == "draft"


def test_a_discard_that_waits_for_an_approval_is_refused_by_the_approved_quote(
    qw: QuoteWorld,
) -> None:
    _, requirement = ready(qw)
    quote = qw.create(requirement).json()["quote_id"]
    held = Held(qw.owner, f"select public.approve_quote('{quote}', '{hash_of(quote)}')")
    held.holding()
    response, waited = timed(
        lambda: rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement)
    )
    held.finish()
    assert code_of(response) == "SM212" and waited > 1.5, (response.text, waited)
    assert status_of(quote) == "approved"


def approved(qw: QuoteWorld) -> tuple[str, str]:
    _, requirement = ready(qw)
    quote = qw.create(requirement).json()["quote_id"]
    assert qw.approve(quote).status_code == 200
    return requirement, quote


def test_a_discard_that_waits_for_a_withdrawal_succeeds_after_it(qw: QuoteWorld) -> None:
    requirement, quote = approved(qw)
    held = Held(qw.owner, f"select public.withdraw_approved_quote('{quote}', 'price_changed')")
    held.holding()
    response, waited = timed(
        lambda: rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement)
    )
    held.finish()
    assert (
        response.status_code == 200 and response.json()["status"] == "discarded" and waited > 1.5
    ), (
        response.text,
        waited,
    )  # the withdrawal committed first: nothing depends on the requirement any more
    assert status_of(quote) == "superseded"


def test_approving_a_new_draft_while_the_old_approval_is_withdrawn_leaves_one_approved_quote(
    qw: QuoteWorld,
) -> None:
    requirement, old = approved(qw)
    new = qw.create(requirement).json()["quote_id"]
    held = Held(qw.owner, f"select public.withdraw_approved_quote('{old}', 'customer_cancelled')")
    held.holding()
    response, waited = timed(lambda: qw.approve(new))
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (response.text, waited)
    assert status_of(old) == "superseded" and status_of(new) == "approved"
    withdrawn = operator_sql.sql(
        f"select withdrawn_by is not null from public.quotes where id = '{old}'"
    ).strip()
    assert (
        withdrawn == "t"
    )  # the old one was WITHDRAWN (the replacing approval found nothing left to supersede)


def test_a_withdrawal_that_waits_for_a_replacing_approval_is_refused(qw: QuoteWorld) -> None:
    requirement, old = approved(qw)
    new = qw.create(requirement).json()["quote_id"]
    held = Held(qw.owner, f"select public.approve_quote('{new}', '{hash_of(new)}')")
    held.holding()
    response, waited = timed(lambda: qw.withdraw(old))
    held.finish()
    assert code_of(response) == "SM214" and waited > 1.5, (
        response.text,
        waited,
    )  # it was replaced (superseded without a withdrawal) while it waited
    assert (
        operator_sql.sql(
            f"select withdrawn_at is null from public.quotes where id = '{old}'"
        ).strip()
        == "t"
    )
    assert status_of(new) == "approved"


def test_two_withdrawals_at_once_withdraw_once(qw: QuoteWorld) -> None:
    _, quote = approved(qw)
    a, b = _both(
        lambda: qw.withdraw(quote, "other", token=qw.owner.token),
        lambda: qw.withdraw(quote, "other", token=qw.admin.token),
    )
    assert {code_of(a), code_of(b)} == {"", "SM214"}, (
        a.text,
        b.text,
    )  # another person's identical request is not a replay
    assert (
        operator_sql.sql(f"select withdraw_code from public.quotes where id = '{quote}'").strip()
        == "other"
    )


def test_a_pick_that_changes_while_a_quote_is_created_makes_that_quote_wrong_not_a_500(
    qw: QuoteWorld,
) -> None:
    _, requirement = ready(qw)
    request = qw.build(requirement)["request"]  # built from the OLD pick
    request_text, result_text, _ = qw.engine(request)
    held = Held(
        qw.sales,
        f"select public.pick_requirement_line_product('{requirement}', 1::smallint, '{qw.products[1]}', 12, 'piece')",
    )
    held.holding()
    response, waited = timed(lambda: rpc(qw.w, qw.sales.token, "create_quote_draft", p_quote_id=uid(), p_requirement_id=requirement, p_customer_kind="new", p_delivery_state="TS",
                                         p_engine_version=engine_port.engine_version(), p_request_text=request_text, p_result_text=result_text))  # fmt: skip
    held.finish()
    assert code_of(response) == "SM216" and waited > 1.5, (
        response.text,
        waited,
    )  # it waited for the pick, then saw the new pick and refused the old request
    assert (
        operator_sql.sql(
            f"select count(*) from public.quotes where requirement_id = '{requirement}'"
        ).strip()
        == "0"
    )


def _both(
    first: Callable[[], httpx.Response], second: Callable[[], httpx.Response]
) -> list[httpx.Response]:
    barrier = threading.Barrier(2)

    def go(action: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=10)
        return action()

    with ThreadPoolExecutor(max_workers=2) as pool:
        return [f.result(timeout=90) for f in [pool.submit(go, first), pool.submit(go, second)]]


def test_two_approvals_at_once_approve_once(qw: QuoteWorld) -> None:
    _, requirement = ready(qw)
    quote = qw.create(requirement).json()["quote_id"]
    h = hash_of(quote)
    a, b = _both(
        lambda: rpc(qw.w, qw.owner.token, "approve_quote", p_quote_id=quote, p_recomputed_hash=h),
        lambda: rpc(qw.w, qw.admin.token, "approve_quote", p_quote_id=quote, p_recomputed_hash=h),
    )
    assert sorted([a.status_code, b.status_code]) == [200, 400] or sorted(
        code_of(x) for x in (a, b)
    ) == ["", "SM214"], (a.text, b.text)
    assert {code_of(a), code_of(b)} == {"", "SM214"}
    assert status_of(quote) == "approved"


def test_two_creates_at_once_leave_one_draft_and_distinct_numbers(qw: QuoteWorld) -> None:
    _, requirement = ready(qw)
    a, b = _both(lambda: qw.create(requirement), lambda: qw.create(requirement))
    assert a.status_code == b.status_code == 200, (a.text, b.text)
    assert a.json()["quote_no"] != b.json()["quote_no"]
    states = sorted(
        operator_sql.sql(
            f"select string_agg(status::text, ',' order by status) from public.quotes where requirement_id = '{requirement}'"
        )
        .strip()
        .split(",")
    )
    assert states == ["draft", "superseded"], states


def test_creates_on_different_requirements_at_once_get_distinct_numbers(qw: QuoteWorld) -> None:
    """The quote number is the tenant's next: two requirements (two different enquiry locks) must still never share one."""
    for _ in range(5):
        _, first = ready(qw)
        _, second = ready(qw)
        a, b = _both(lambda: qw.create(first), lambda: qw.create(second))  # noqa: B023
        assert a.status_code == b.status_code == 200, (a.text, b.text)
        assert a.json()["quote_no"] != b.json()["quote_no"]


def test_an_approval_and_a_withdrawal_at_once_are_one_or_the_other(qw: QuoteWorld) -> None:
    _, requirement = ready(qw)
    quote = qw.create(requirement, token=qw.admin.token).json()["quote_id"]
    h = hash_of(quote)
    a, b = _both(
        lambda: rpc(qw.w, qw.owner.token, "approve_quote", p_quote_id=quote, p_recomputed_hash=h),
        lambda: rpc(qw.w, qw.admin.token, "reject_quote", p_quote_id=quote, p_code="wrong_prices"),
    )
    assert {code_of(a), code_of(b)} == {"", "SM214"}, (a.text, b.text)
    assert status_of(quote) in ("approved", "rejected")


# ------------------------------------------------------------------------------ everything at once
ALLOWED = {"SM212", "SM213", "SM214", "SM215", "SM216", "SM217", "SM218", "23514", "23503", "23505"}


def _storm_round(qw: QuoteWorld, rng: random.Random, round_no: int) -> None:
    _, requirement = ready(qw)
    first = qw.create(requirement).json()["quote_id"]
    h = hash_of(first)
    actions: list[Callable[[], httpx.Response]] = [
        lambda: rpc(qw.w, qw.owner.token, "approve_quote", p_quote_id=first, p_recomputed_hash=h),
        lambda: rpc(qw.w, qw.admin.token, "reject_quote", p_quote_id=first, p_code="other"),
        lambda: qw.create(requirement),
        lambda: rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement),
        lambda: qw.pick(requirement, 1, rng.choice([1, 2]), 12),
    ]
    rng.shuffle(actions)
    barrier = threading.Barrier(len(actions))

    def go(action: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=10)
        return action()

    with ThreadPoolExecutor(max_workers=len(actions)) as pool:
        responses = [f.result(timeout=120) for f in [pool.submit(go, a) for a in actions]]
    for r in responses:
        assert r.status_code < 500, r.text
        assert code_of(r) not in ("40P01", "40001"), f"deadlock or serialization failure: {r.text}"
        assert r.status_code == 200 or code_of(r) in ALLOWED, r.text
    counts = operator_sql.sql(
        f"select count(*) filter (where status = 'draft') || ',' || count(*) filter (where status = 'approved') from public.quotes where requirement_id = '{requirement}'"
    ).strip()
    drafts, approved = (int(x) for x in counts.split(","))
    assert drafts <= 1 and approved <= 1, (round_no, counts)
    if (
        operator_sql.sql(
            f"select status from public.requirements where id = '{requirement}'"
        ).strip()
        == "discarded"
    ):
        assert (drafts, approved) == (0, 0), "a discarded requirement still has a live quote"


def test_a_five_way_storm_never_deadlocks_and_keeps_the_invariants(qw: QuoteWorld) -> None:
    rng = random.Random(20261016)
    for round_no in range(6):
        _storm_round(qw, rng, round_no)
