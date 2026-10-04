"""Concurrent last-owner race, through real PostgREST connections.

Two Owners try to demote/remove each other at the same moment. Each request alone is legal (the
other Owner still exists when it starts), but both succeeding would leave the tenant with no Owner.
The trigger serialises them on the tenant row, so exactly one wins and one is refused (23514).
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from conftest import Stack, User, unique_slug

ITERATIONS = 12


def _new_tenant_with_two_owners(stack: Stack, one: User, two: User) -> str:
    created = httpx.post(
        f"{stack.rest}/rpc/create_tenant",
        headers=stack.headers(one.token),
        json={"p_name": "Race", "p_slug": unique_slug("it-race")},
        timeout=15,
    )
    created.raise_for_status()
    tenant_id = str(created.json()["id"])
    added = httpx.post(
        f"{stack.rest}/memberships",
        headers=stack.headers(one.token),
        json={"tenant_id": tenant_id, "user_id": str(two.id), "role": "owner"},
        timeout=15,
    )
    assert added.status_code == 201, added.text
    return tenant_id


def _owner_counts(stack: Stack, candidates: tuple[User, ...], tenant_id: str) -> list[int]:
    """Owner count as seen by each candidate who can still see the tenant."""
    counts: list[int] = []
    for candidate in candidates:
        response = httpx.get(
            f"{stack.rest}/memberships?tenant_id=eq.{tenant_id}&role=eq.owner&select=user_id",
            headers=stack.headers(candidate.token),
            timeout=15,
        )
        response.raise_for_status()
        if response.json():
            counts.append(len(response.json()))
    return counts


def _demote(
    stack: Stack, actor: User, tenant_id: str, target: User
) -> Callable[[], httpx.Response]:
    return lambda: httpx.patch(
        f"{stack.rest}/memberships?tenant_id=eq.{tenant_id}&user_id=eq.{target.id}",
        headers=stack.headers(actor.token, Prefer="return=representation"),
        json={"role": "admin"},
        timeout=30,
    )


def _remove(
    stack: Stack, actor: User, tenant_id: str, target: User
) -> Callable[[], httpx.Response]:
    return lambda: httpx.delete(
        f"{stack.rest}/memberships?tenant_id=eq.{tenant_id}&user_id=eq.{target.id}",
        headers=stack.headers(actor.token, Prefer="return=representation"),
        timeout=30,
    )


def _race(
    first: Callable[[], httpx.Response], second: Callable[[], httpx.Response]
) -> list[httpx.Response]:
    barrier = threading.Barrier(2)

    def run(action: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=10)
        return action()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, first), pool.submit(run, second)]
        return [f.result(timeout=60) for f in futures]


def _succeeded(response: httpx.Response) -> bool:
    return response.status_code == 200 and len(response.json()) == 1


def _refused(response: httpx.Response) -> bool:
    return response.status_code == 400 and response.json().get("code") == "23514"


def _lost_authority(response: httpx.Response) -> bool:
    """200 with no rows: the winner already demoted/removed the actor, so RLS stops them acting."""
    return response.status_code == 200 and response.json() == []


@pytest.fixture(scope="module")
def owners(signup: Any) -> tuple[User, User]:
    return signup("race-one"), signup("race-two")


def _assert_one_owner_remains(stack: Stack, owners: tuple[User, User], tenant_id: str) -> None:
    counts = _owner_counts(stack, owners, tenant_id)
    assert counts and set(counts) == {1}, counts


@pytest.mark.parametrize("scenario", ["both-step-down", "both-leave", "step-down-vs-leave"])
def test_two_owners_cannot_both_leave_at_once(
    stack: Stack, owners: tuple[User, User], scenario: str
) -> None:
    """Each owner acts on THEIR OWN membership, so each request is individually authorised no
    matter which commits first. Exactly one must win; the other must hit the last-owner trigger
    (23514). Deterministic outcome in either interleaving."""
    one, two = owners
    for _ in range(ITERATIONS):
        tenant_id = _new_tenant_with_two_owners(stack, one, two)
        if scenario == "both-step-down":
            responses = _race(
                _demote(stack, one, tenant_id, one), _demote(stack, two, tenant_id, two)
            )
        elif scenario == "both-leave":
            responses = _race(
                _remove(stack, one, tenant_id, one), _remove(stack, two, tenant_id, two)
            )
        else:
            responses = _race(
                _demote(stack, one, tenant_id, one), _remove(stack, two, tenant_id, two)
            )

        assert sum(_succeeded(r) for r in responses) == 1, [
            (r.status_code, r.text) for r in responses
        ]
        assert sum(_refused(r) for r in responses) == 1, [
            (r.status_code, r.text) for r in responses
        ]
        _assert_one_owner_remains(stack, owners, tenant_id)


@pytest.mark.parametrize("scenario", ["demote-each-other", "remove-each-other", "demote-vs-remove"])
def test_owners_acting_on_each_other_never_leave_zero_owners(
    stack: Stack, owners: tuple[User, User], scenario: str
) -> None:
    """Owners target EACH OTHER. Depending on timing the loser is either refused by the trigger
    (23514) or has already lost authority (0 rows). Both are safe; zero owners is not."""
    one, two = owners
    for _ in range(ITERATIONS):
        tenant_id = _new_tenant_with_two_owners(stack, one, two)
        if scenario == "demote-each-other":
            responses = _race(
                _demote(stack, one, tenant_id, two), _demote(stack, two, tenant_id, one)
            )
        elif scenario == "remove-each-other":
            responses = _race(
                _remove(stack, one, tenant_id, two), _remove(stack, two, tenant_id, one)
            )
        else:
            responses = _race(
                _demote(stack, one, tenant_id, two), _remove(stack, two, tenant_id, one)
            )

        assert sum(_succeeded(r) for r in responses) == 1, [
            (r.status_code, r.text) for r in responses
        ]
        assert sum(_refused(r) or _lost_authority(r) for r in responses) == 1, [
            (r.status_code, r.text) for r in responses
        ]
        _assert_one_owner_remains(stack, owners, tenant_id)
