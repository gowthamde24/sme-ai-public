"""Job BB (ADR 0070): migrations 20261111090000 and 20261111090100 REPLACE, as FULL COPIES, the submit core and its wrapper, `outbox_edit`, the guard of the outbox rows and the two erasure functions
(for the English gloss), and the five places that decide quiet hours (the send policy, the Owner's approval, the release of a due message, the two reminder checks) so that each reads the hours of
THE BUSINESS. Each must be the LAST definition of its function and differ from the one before it by EXACTLY the lines named here, so a copy of an old definition can never silently undo a later fix.
(The earlier pins stop at the migration that made them.)"""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import AS, AT, AW, definitions, normalised
from tests.test_migration_copies_ay import AY_OUTBOX

BB1 = "20261111090000_bb_outbox_gloss_events_list.sql"
BB2 = "20261111090100_bb_quiet_hours.sql"
AT_CLOCK = "20261107090000_at_outbox_clock.sql"

# name -> (migration of the copy, migration it is compared with, lines dropped, lines added)
BB_CHANGED: dict[str, tuple[str, str, set[str], set[str]]] = {
    "app.outbox_messages_guard_update": (
        BB1,
        AY_OUTBOX,
        {"if new.body is distinct from old.body and old.status <> 'needs_approval' then"},
        {
            "if (new.body is distinct from old.body or new.gloss_en is distinct from old.gloss_en) and old.status <> 'needs_approval' then"
        },
    ),
    "app.outbox_submit_core": (
        BB1,
        AY_OUTBOX,
        {
            "p_media uuid[] default '{}', p_keep_record boolean default false",
            "|| case when p_keep_record then '|keep' else '' end, 'UTF8')), 'hex');",
            "disclosure_added, request_sha256, scheduled_for, created_by, created_at, keep_record)",
            "p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now, p_keep_record)",
        },
        {
            "p_media uuid[] default '{}', p_keep_record boolean default false, p_gloss_en text default null",
            "v_gloss   text := nullif(btrim(coalesce(p_gloss_en, '')), '');",
            "if v_gloss is not null and (char_length(v_gloss) not between 2 and 3000 or not app.text_is_clean(v_gloss)) then",
            "perform app.outbox_error('invalid');",
            "end if;",
            "|| case when p_keep_record then '|keep' else '' end",
            "|| case when v_gloss is not null then '|gloss:' || v_gloss else '' end, 'UTF8')), 'hex');",
            "disclosure_added, request_sha256, scheduled_for, created_by, created_at, keep_record, gloss_en)",
            "p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now, p_keep_record, v_gloss)",
        },
    ),
    "public.outbox_submit": (
        BB1,
        AY_OUTBOX,
        {
            "p_media uuid[] default '{}', p_keep_record boolean default false",
            "return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain, p_media, p_keep_record);",
        },
        {
            "p_media uuid[] default '{}', p_keep_record boolean default false, p_gloss_en text default null",
            "return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain, p_media, p_keep_record, p_gloss_en);",
        },
    ),
    "public.outbox_edit": (
        BB1,
        AT,
        {
            "create or replace function public.outbox_edit(p_tenant_id uuid, p_message_id uuid, p_body text) returns jsonb",
            "if char_length(v_text) not between 2 and 3000 or not app.text_is_clean(v_text) then",
            "set body = v_text, flags = app.outbox_content_flags(v_text), edited_by = v_uid, edited_at = now()",
        },
        {
            "create or replace function public.outbox_edit(p_tenant_id uuid, p_message_id uuid, p_body text, p_gloss_en text default null) returns jsonb",
            "v_gloss text := nullif(btrim(coalesce(p_gloss_en, '')), '');",
            "if char_length(v_text) not between 2 and 3000 or not app.text_is_clean(v_text)",
            "or (v_gloss is not null and (char_length(v_gloss) not between 2 and 3000 or not app.text_is_clean(v_gloss))) then",
            "set body = v_text, gloss_en = v_gloss, flags = app.outbox_content_flags(v_text), edited_by = v_uid, edited_at = now()",
        },
    ),
    "app.erase_contact": (
        BB1,
        AS,
        set(),
        {
            "v_counts := app.erasure_add(v_counts, 'outbox_messages.gloss_en',  app.erase_column(r.tenant_id, 'contact', 'outbox_messages', 'gloss_en', v_enq));"
        },
    ),
    "app.erase_company": (
        BB1,
        AS,
        set(),
        {
            "v_counts := app.erasure_add(v_counts, 'outbox_messages.gloss_en',  app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'gloss_en', v_enq));"
        },
    ),
    "app.outbox_decide_content": (
        BB2,
        AT,
        {
            "if app.outbox_in_quiet_hours(p_now) then",
            "return jsonb_build_object('status', 'queued', 'reason', 'quiet_hours', 'flags', to_jsonb(v_flags), 'scheduled_for', app.outbox_next_open(p_now));",
        },
        {
            "if app.outbox_in_quiet_hours(p_now, p_tenant) then",
            "return jsonb_build_object('status', 'queued', 'reason', 'quiet_hours', 'flags', to_jsonb(v_flags), 'scheduled_for', app.outbox_next_open(p_now, p_tenant));",
        },
    ),
    "public.outbox_decide": (
        BB2,
        AT_CLOCK,
        {
            "set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = app.outbox_next_open(v_now)"
        },
        {
            "set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = app.outbox_next_open(v_now, p_tenant_id)"
        },
    ),
    "app.outbox_claim_due_core": (
        BB2,
        AY_OUTBOX,
        {
            "if app.outbox_in_quiet_hours(v_now) then",
            "update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now) where id = r.id;",
        },
        {
            "if app.outbox_in_quiet_hours(v_now, p_tenant_id) then",
            "update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now, p_tenant_id) where id = r.id;",
        },
    ),
    "app.scheduler_reminder_due": (
        BB2,
        AW,
        {"and not app.outbox_in_quiet_hours(p_now)"},
        {"and not app.outbox_in_quiet_hours(p_now, m.tenant_id)"},
    ),
    "public.scheduler_due_reminders": (
        BB2,
        AW,
        {"if not app.scheduler_tenant_on(p_tenant_id) or app.outbox_in_quiet_hours(v_now) then"},
        {
            "if not app.scheduler_tenant_on(p_tenant_id) or app.outbox_in_quiet_hours(v_now, p_tenant_id) then"
        },
    ),
}


@pytest.mark.parametrize("name", sorted(BB_CHANGED))
def test_the_bb_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(
    name: str,
) -> None:
    mig, compared, want_dropped, want_added = BB_CHANGED[name]
    defs = definitions(name)
    # a later job may copy it again, if ITS pin says exactly what it changed (BR: test_migration_copies_br.py; CA: test_migration_copies_ca.py)
    later = {
        "app.outbox_claim_due_core": ("20261117090000_br_whatsapp.sql", "20261127090200_di_billing_meters.sql"),
        "app.erase_company": ("20261123090600_cn_erasure.sql",),
    }
    assert defs[-1][0] in (mig, *later.get(name, ())), (
        f"{name} is redefined after job BB's migration ({defs[-1][0]}): re-copy it from the latest definition"
    )
    before = [d for d in defs if d[0] == compared]
    assert before, f"{name} was not defined in {compared}"
    # the function it is compared with must be the one in force just before this copy
    assert [d for d in defs if d[0] < mig][-1][0] == compared, (
        f"{name}: the definition before this copy is not in {compared}"
    )
    diff = [
        line
        for line in difflib.unified_diff(
            normalised(before[-1][1]), normalised([d for d in defs if d[0] == mig][-1][1]), lineterm="", n=0
        )
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    dropped = {line[1:].strip() for line in diff if line[0] == "-"}
    added = {line[1:].strip() for line in diff if line[0] == "+"}
    assert dropped == {w.strip() for w in want_dropped}, f"{name}: dropped {dropped}"
    assert added == {w.strip() for w in want_added}, f"{name}: added {added}"


def test_no_policy_function_still_calls_the_one_argument_quiet_hours_helpers() -> None:
    """After BB2 every caller passes the business. The one-argument helpers stay for compatibility (the fixed default 21 / 9) but nothing in the outbox or the scheduler may use them."""
    for name in (
        "app.outbox_decide_content",
        "public.outbox_decide",
        "app.outbox_claim_due_core",
        "app.scheduler_reminder_due",
        "public.scheduler_due_reminders",
    ):
        body = definitions(name)[-1][1]
        code = "\n".join(line for line in body.split("\n") if not line.lstrip().startswith("--"))
        for helper in ("outbox_in_quiet_hours", "outbox_next_open"):
            for call in code.split(helper + "(")[1:]:
                args = call.split(")")[0]
                assert "," in args, f"{name} calls {helper} without the business"


def test_the_event_trigger_and_the_log_functions_hold_no_bare_now() -> None:
    """The events and the log read the outbox clock (app.outbox_now), so a test can pin the instant; a bare now() would make a step's time differ from the message's."""
    for name in (
        "app.outbox_messages_events",
        "public.outbox_list",
        "public.outbox_summary",
        "app.worker_may_read_object",
    ):
        body = definitions(name)[-1][1]
        code = "\n".join(line for line in body.split("\n") if not line.lstrip().startswith("--"))
        assert "now()" not in code.replace("app.outbox_now()", ""), name
