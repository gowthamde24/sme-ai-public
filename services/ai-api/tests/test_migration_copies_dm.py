"""Job DM: migrations 20261129090100 and 20261129090400 REPLACE, as FULL COPIES, functions of job DI. Each must be the LAST definition of its function (so an old copy can never silently undo the trial clock or
the pending hold), and the two that the outbox claim and the call start depend on differ from job DI's by exactly the named line."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

CLOCK = "20261129090100_dm_trial_clock.sql"
PENDING = "20261129090400_dm_trial_pending.sql"
LAST = {
    "public.billing_start_trial": PENDING,
    "app.billing_access_until": PENDING,
    "public.billing_cancel": PENDING,
    "app.billing_subscription_json": PENDING,
    "app.billing_stopped": PENDING,
    "app.billing_read_only": PENDING,
    "app.billing_trial_clock": PENDING,
    "public.billing_plans": CLOCK,
    "public.billing_get": CLOCK,
}


@pytest.mark.parametrize("name", sorted(LAST))
def test_the_dm_copy_is_the_last_definition(name: str) -> None:
    defs = definitions(name)
    assert defs[-1][0] == LAST[name], f"{name} is redefined after job DM's migration ({defs[-1][0]}): re-copy it from the latest definition"


def _diff(name: str) -> tuple[set[str], set[str]]:
    defs = definitions(name)
    diff = [line for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0) if line[:1] in "+-" and not line.startswith(("---", "+++"))]
    return {line[1:].strip() for line in diff if line[0] == "-"}, {line[1:].strip() for line in diff if line[0] == "+"}


def test_the_pending_hold_adds_one_term_to_the_stopped_and_read_only_checks() -> None:
    removed, added = _diff("app.billing_stopped")
    assert removed == {"select app.billing_enforced() and app.billing_state(app.billing_used(p_tenant, p_kind), app.billing_allowance(p_tenant, p_kind)) = 'stopped'"}
    assert added == {"select app.billing_pending(p_tenant)", "or (app.billing_enforced() and app.billing_state(app.billing_used(p_tenant, p_kind), app.billing_allowance(p_tenant, p_kind)) = 'stopped')"}
    removed, added = _diff("app.billing_read_only")
    assert "app.billing_lapse(p_tenant) ->> 'access' = 'read_only'" in " ".join(removed) and "or app.billing_pending(p_tenant)" in " ".join(added)


def test_cancel_only_learns_the_pending_status() -> None:
    removed, added = _diff("public.billing_cancel")
    assert removed == {"if sub.status in ('trialing', 'past_due') then", "-- no paid period is running (the trial, or a payment that failed): it ends at once; a plan that was paid for goes back to the base plan"}
    assert all("trial_pending" in line or line.startswith("-- no paid period") for line in added)
