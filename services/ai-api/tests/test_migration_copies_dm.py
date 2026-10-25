"""Job DM: migrations 20261129090100 and 20261129090400 REPLACE, as FULL COPIES, functions of job DI. Each must be the LAST definition of its function (so an old copy can never silently undo the trial clock or
the pending hold), and the two that the outbox claim and the call start depend on differ from job DI's by exactly the named line."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

CLOCK = "20261129090100_dm_trial_clock.sql"
PENDING = "20261129090400_dm_trial_pending.sql"
# job DP part 3 (migration 20261130090100) re-copies these two once more: the DM copy is the one it was made from, and the test below says exactly what DP changed
READONLY = "20261130090100_dp_readonly_gate.sql"
NEWER = {"public.billing_start_trial": READONLY, "public.billing_get": READONLY}
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
    expected = NEWER.get(name, LAST[name])
    assert defs[-1][0] == expected, f"{name} is redefined after job DM's migration ({defs[-1][0]}): re-copy it from the latest definition"
    if name in NEWER:
        assert defs[-2][0] == LAST[name], f"{name}: job DP's copy must be made from job DM's ({defs[-2][0]})"


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


def test_the_readonly_copies_add_exactly_what_they_say() -> None:
    removed, added = _diff("public.billing_get")
    assert removed == {"'can_start_trial', not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id),"}
    assert len(added) == 2 and any("app.billing_can_resume(p_tenant_id)" in line for line in added) and any("'can_resume'" in line for line in added), added
    removed, added = _diff("public.billing_start_trial")
    assert removed == {"if exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id) then"}
    assert added == {"if exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id) or app.billing_can_resume(p_tenant_id) then"}
