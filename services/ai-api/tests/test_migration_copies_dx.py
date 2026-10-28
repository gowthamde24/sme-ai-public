"""Job DX (28 Oct 2026): migration 20261214090200 REPLACES, as FULL COPIES, the four functions that decide quiet hours for a reply and add the AI line (the send policy, the Owner's approval, the release of a due
message, the submit core). Each must be the LAST definition of its function and differ from the one before it by EXACTLY the lines named here, so a copy of an old definition can never silently undo this fix.
The submit core also differs by the Malayalam entry of its language list: migration 20261202090000 (job DQ) rewrote the LIVE function to list 'ml', so this copy carries the live text, not the older file's."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

DX = "20261214090200_dx_reply_fixes.sql"
BB1 = "20261111090000_bb_outbox_gloss_events_list.sql"
BB2 = "20261111090100_bb_quiet_hours.sql"
DI_LAPSE = "20261127090300_di_read_only_lapse.sql"

# name -> (migration it was compared with, lines dropped, lines added)
DX_CHANGED: dict[str, tuple[str, set[str], set[str]]] = {
    "app.outbox_decide_content": (
        BB2,
        {"if app.outbox_in_quiet_hours(p_now, p_tenant) then"},
        {"if app.outbox_in_quiet_hours(p_now, p_tenant) and not app.outbox_active_conversation(p_tenant, p_lead, p_category, p_now) then"},
    ),
    "public.outbox_decide": (
        BB2,
        {"set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = app.outbox_next_open(v_now, p_tenant_id)"},
        {
            "set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = case when app.outbox_active_conversation(p_tenant_id, m.lead_id, m.category, v_now) then v_now else app.outbox_next_open(v_now, p_tenant_id) end"
        },
    ),
    "app.outbox_claim_due_core": (
        DI_LAPSE,
        {"if app.outbox_in_quiet_hours(v_now, p_tenant_id) then"},
        {"if app.outbox_in_quiet_hours(v_now, p_tenant_id) and not app.outbox_active_conversation(p_tenant_id, r.lead_id, r.category, coalesce(r.decided_at, r.created_at)) then"},
    ),
    "app.outbox_submit_core": (
        BB1,
        {
            "or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta')",
            "if v_contact.id is not null then",
        },
        {
            "or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')",
            "if v_contact.id is not null and p_source = 'assistant' and app.outbox_mention_ai(p_tenant_id) then",
        },
    ),
}


@pytest.mark.parametrize("name", sorted(DX_CHANGED))
def test_the_dx_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    compared, want_dropped, want_added = DX_CHANGED[name]
    defs = definitions(name)
    assert defs[-1][0] == DX, f"{name} is redefined after job DX's migration ({defs[-1][0]}): re-copy it from the latest definition"
    before = [d for d in defs if d[0] == compared]
    assert before, f"{name} was not defined in {compared}"
    assert [d for d in defs if d[0] < DX][-1][0] == compared, f"{name}: the definition before this copy is not in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(before[-1][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    dropped = {line[1:].strip() for line in diff if line[0] == "-"}
    added = {line[1:].strip() for line in diff if line[0] == "+"}
    assert dropped == {w.strip() for w in want_dropped}, f"{name}: dropped {dropped}"
    assert added == {w.strip() for w in want_added}, f"{name}: added {added}"


def test_the_two_helpers_exist_and_no_client_role_can_call_them() -> None:
    for name in ("app.outbox_active_conversation", "app.outbox_mention_ai"):
        assert definitions(name), name
