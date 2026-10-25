"""Job BR (ADR 0076): migration 20261117090000 REPLACES, as FULL COPIES, `app.outbox_mark_core` (the real adapter and five new closed failure codes) and `app.outbox_claim_due_core` (the attempt number and the
WhatsApp send context in each claimed item). Each must be the LAST definition of its function and differ from the one before it by EXACTLY the lines named here, so a copy of an old definition can never
silently undo a later fix. (The earlier pins stop at the migration that made them.)"""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

BR = "20261117090000_br_whatsapp.sql"

BR_CHANGED: dict[str, tuple[set[str], set[str]]] = {
    "app.outbox_mark_core": (
        {
            "if p_outcome is null or p_outcome not in ('sent', 'failed') or p_adapter is distinct from 'fake'",
            "or (p_outcome = 'failed' and (p_failure_code is null or p_failure_code not in ('adapter_error', 'timeout', 'rejected'))) then",
        },
        {
            "if p_outcome is null or p_outcome not in ('sent', 'failed') or p_adapter is null or p_adapter not in ('fake', 'whatsapp')",
            "or (p_outcome = 'failed' and (p_failure_code is null or p_failure_code not in ('adapter_error', 'timeout', 'rejected', 'window_closed', 'template_required', 'recipient_unreachable', 'rate_limited', 'not_configured'))) then",
        },
    ),
    "app.outbox_claim_due_core": (
        {"update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id;"},
        {
            "update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id returning * into r;",
            "'attempts', r.attempts, 'wa', app.wa_send_context(r, v_now),",
        },
    ),
}


@pytest.mark.parametrize("name", sorted(BR_CHANGED))
def test_the_br_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    want_dropped, want_added = BR_CHANGED[name]
    defs = definitions(name)
    # a later job may copy it again, if ITS pin says exactly what it changed (DI: test_migration_copies_di.py)
    later = {"app.outbox_claim_due_core": ("20261127090200_di_billing_meters.sql", "20261127090300_di_read_only_lapse.sql")}
    assert defs[-1][0] in (BR, *later.get(name, ())), f"{name} is redefined after job BR's migration ({defs[-1][0]}): re-copy it from the latest definition"
    at = next(i for i, d in enumerate(defs) if d[0] == BR)
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[at - 1][1]), normalised(defs[at][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    dropped = {line[1:].strip() for line in diff if line[0] == "-"}
    added = {line[1:].strip() for line in diff if line[0] == "+"}
    assert dropped == {w.strip() for w in want_dropped}, f"{name}: dropped {dropped}"
    assert added == {w.strip() for w in want_added}, f"{name}: added {added}"
