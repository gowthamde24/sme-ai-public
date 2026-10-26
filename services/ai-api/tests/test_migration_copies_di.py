"""Job DI (ADR 0092): migration 20261127090200 REPLACES, as a FULL COPY, `app.outbox_claim_due_core` (the claim of the outbox) so that a business-initiated message is not handed out while the workspace's WhatsApp
meter is stopped. It must be the LAST definition and differ from the job BR copy by EXACTLY the lines named here, so a copy of an old definition can never silently undo the hold (or the WhatsApp send context)."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

DI = "20261127090200_di_billing_meters.sql"
DI4 = "20261127090300_di_read_only_lapse.sql"
BR = "20261117090000_br_whatsapp.sql"
ADDED = {
    "v_held boolean;",
    "v_held := app.billing_stopped(p_tenant_id, 'whatsapp_messages');   -- job DI: 100 percent of the period's business-initiated messages (or none included)",
    "and (not v_held or x.category = 'reply_to_inbound')",
}


def test_the_di_copy_is_the_last_definition_and_differs_from_the_br_copy_by_exactly_the_named_lines() -> None:
    defs = definitions("app.outbox_claim_due_core")
    assert defs[-1][0] == DI4, f"redefined after job DI's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert [d[0] for d in defs[-3:]] == [BR, DI, DI4]
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-3][1]), normalised(defs[-2][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == set(), "nothing is dropped"
    assert {line[1:].strip() for line in diff if line[0] == "+"} == ADDED


READ_ONLY_ADDED = {
    "if app.billing_read_only(p_tenant_id) then",
    "return v_out;   -- job DI: the trial ended unpaid; read-only: nothing is sent, nothing is lost",
    "end if;",
}


def test_the_read_only_copy_of_the_claim_adds_exactly_the_read_only_hold() -> None:
    defs = definitions("app.outbox_claim_due_core")
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == set()
    assert {line[1:].strip() for line in diff if line[0] == "+"} == READ_ONLY_ADDED


def test_only_the_claim_and_the_call_check_ask_the_meter_whether_a_kind_is_stopped() -> None:
    from pathlib import Path

    names = set()
    for path in sorted((Path(__file__).resolve().parents[3] / "supabase" / "migrations").glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        if "billing_stopped(" in text and path.name not in (DI, DI4):
            names.add(path.name)
    # job DM's pending hold redefines the check itself (migration 4); nothing else consults it
    # job DR A3: the scheduler's outreach run is a call check of its own (calls are held for the hour when call minutes are stopped)
    assert names == {"20261129090400_dm_trial_pending.sql", "20261206090000_dr_speed_approvals.sql"}, "no other migration consults the meter"
