"""Job DI (ADR 0092): migration 20261127090200 REPLACES, as a FULL COPY, `app.outbox_claim_due_core` (the claim of the outbox) so that a business-initiated message is not handed out while the workspace's WhatsApp
meter is stopped. It must be the LAST definition and differ from the job BR copy by EXACTLY the lines named here, so a copy of an old definition can never silently undo the hold (or the WhatsApp send context)."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

DI = "20261127090200_di_billing_meters.sql"
BR = "20261117090000_br_whatsapp.sql"
ADDED = {
    "v_held boolean;",
    "v_held := app.billing_stopped(p_tenant_id, 'whatsapp_messages');   -- job DI: 100 percent of the period's business-initiated messages (or none included)",
    "and (not v_held or x.category = 'reply_to_inbound')",
}


def test_the_di_copy_is_the_last_definition_and_differs_from_the_br_copy_by_exactly_the_named_lines() -> None:
    defs = definitions("app.outbox_claim_due_core")
    assert defs[-1][0] == DI, f"redefined after job DI's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == BR, "the definition before the DI copy is the BR one"
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == set(), "nothing is dropped"
    assert {line[1:].strip() for line in diff if line[0] == "+"} == ADDED


def test_only_the_claim_and_the_call_check_ask_the_meter_whether_a_kind_is_stopped() -> None:
    from pathlib import Path

    names = set()
    for path in sorted((Path(__file__).resolve().parents[3] / "supabase" / "migrations").glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        if "billing_stopped(" in text and path.name != DI:
            names.add(path.name)
    assert names == set(), "no other migration consults the meter"
