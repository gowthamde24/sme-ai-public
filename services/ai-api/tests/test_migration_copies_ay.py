"""Job AY (ADR 0069): migrations 20261110090100 / 0200 / 0300 replace, as FULL COPIES, the outbox cores and two wrappers of job AW (photos, the record flag, "approved only" claims), the guard of the
outbox rows (one more fixed column), three scheduler functions of job AW (approved messages are released whatever automatic sending says), today_summary (proposed visits are counted) and
assistant_save_reply (one more source type). Each must be the LAST definition of its function and differ from the one before it by EXACTLY the lines named here, so a copy of an old definition can never
silently undo a later fix. (The earlier pins in test_migration_copies.py now stop at the migration that made them.)"""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import AS, AT, AW, definitions, normalised

AY_OUTBOX = "20261110090100_ay_outbox_media.sql"
AY_TODAY = "20261110090200_ay_lead_search_today.sql"
AY_ASSISTANT = "20261110090300_ay_assistant_sources.sql"

SUBMIT_HEAD = "p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false"

# name -> (migration of the copy, migration it is compared with, lines dropped, lines added)
AY_CHANGED: dict[str, tuple[str, str, set[str], set[str]]] = {
    "app.outbox_submit_core": (
        AY_OUTBOX,
        AW,
        {
            SUBMIT_HEAD,
            "v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text), 'UTF8')), 'hex');",
            "disclosure_added, request_sha256, scheduled_for, created_by, created_at)",
            "p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now)",
        },
        {
            SUBMIT_HEAD + ",",
            "p_media uuid[] default '{}', p_keep_record boolean default false",
            "v_media   uuid[] := coalesce(p_media, '{}');",
            "v_n       integer;",
            "if p_keep_record is null or cardinality(v_media) > 4 or (select count(distinct x) from unnest(v_media) x) <> cardinality(v_media) or exists (select 1 from unnest(v_media) x where x is null) then",
            "perform app.outbox_error('invalid');",
            "end if;",
            "v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text)",
            "|| case when cardinality(v_media) > 0 then '|media:' || array_to_string(v_media, ',') else '' end",
            "|| case when p_keep_record then '|keep' else '' end, 'UTF8')), 'hex');",
            "if cardinality(v_media) > 0 then",
            "select count(*) into v_n from public.catalogue_photos ph join public.catalogue_items it on it.tenant_id = ph.tenant_id and it.id = ph.item_id",
            "where ph.tenant_id = p_tenant_id and ph.id = any (v_media) and ph.removed_at is null and it.active;",
            "if v_n <> cardinality(v_media) then",
            "perform app.outbox_error('reference');",
            "disclosure_added, request_sha256, scheduled_for, created_by, created_at, keep_record)",
            "p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now, p_keep_record)",
            "insert into public.outbox_message_media (tenant_id, message_id, photo_id, position)",
            "select p_tenant_id, p_message_id, x.photo_id, x.n::smallint from unnest(v_media) with ordinality as x(photo_id, n);",
        },
    ),
    "app.outbox_claim_due_core": (
        AY_OUTBOX,
        AW,
        {
            "create or replace function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer) returns jsonb",
            "if p_limit is null or p_limit not between 1 and 50 then",
            "v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language));",
        },
        {
            "create or replace function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer, p_approved_only boolean) returns jsonb",
            "if p_limit is null or p_limit not between 1 and 50 or p_approved_only is null then",
            "and (not p_approved_only or x.reason = 'owner_approved')",
            "v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language,",
            "'media', coalesce((select jsonb_agg(jsonb_build_object('photo_id', ph.id, 'bucket', ph.bucket, 'path', ph.path, 'content_type', ph.content_type) order by md.position)",
            "from public.outbox_message_media md join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id and ph.removed_at is null",
            "where md.tenant_id = r.tenant_id and md.message_id = r.id), '[]'::jsonb)));",
        },
    ),
    "app.outbox_mark_core": (AY_OUTBOX, AW, set(), {"if m.keep_record then", "perform app.outbox_record_touch(m);", "end if;"}),
    "app.outbox_messages_guard_update": (
        AY_OUTBOX,
        AT,
        {
            "v_fixed text[] := array['id', 'tenant_id', 'lead_id', 'contact_id', 'company_id', 'channel', 'language', 'category', 'source', 'request_sha256', 'created_by', 'created_at', 'policy_version', 'model_flagged', 'uncertain'];"
        },
        {
            "v_fixed text[] := array['id', 'tenant_id', 'lead_id', 'contact_id', 'company_id', 'channel', 'language', 'category', 'source', 'request_sha256', 'created_by', 'created_at', 'policy_version', 'model_flagged', 'uncertain', 'keep_record'];"
        },
    ),
    "public.outbox_submit": (
        AY_OUTBOX,
        AW,
        {
            SUBMIT_HEAD,
            "return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain);",
        },
        {
            SUBMIT_HEAD + ",",
            "p_media uuid[] default '{}', p_keep_record boolean default false",
            "return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain, p_media, p_keep_record);",
        },
    ),
    "public.outbox_claim_due": (
        AY_OUTBOX,
        AW,
        {"return app.outbox_claim_due_core(p_tenant_id, p_limit);"},
        {"return app.outbox_claim_due_core(p_tenant_id, p_limit, false);"},
    ),
    "public.scheduler_tenants": (
        AY_OUTBOX,
        AW,
        {"return coalesce((select jsonb_agg(s.tenant_id order by s.tenant_id) from public.outbox_settings s where s.auto_send_enabled), '[]'::jsonb);"},
        {
            "-- a business that switched automatic sending on, and a business with a message its Owner APPROVED that waits to be released (approval is the Owner's consent to send)",
            "return coalesce((select jsonb_agg(z.tenant_id order by z.tenant_id)",
            "from (select s.tenant_id from public.outbox_settings s where s.auto_send_enabled",
            "union",
            "select m.tenant_id from public.outbox_messages m where m.status = 'queued' and m.reason = 'owner_approved') z), '[]'::jsonb);",
        },
    ),
    "public.scheduler_claim_due": (
        AY_OUTBOX,
        AW,
        {"if not app.scheduler_tenant_on(p_tenant_id) then", "return app.outbox_claim_due_core(p_tenant_id, p_limit);"},
        {
            "if not app.outbox_switch_on() then",
            "-- automatic sending ON: everything that is due. OFF: only what the Owner approved (nothing goes without approval, and an approval is consent to send).",
            "return app.outbox_claim_due_core(p_tenant_id, p_limit, not app.scheduler_tenant_on(p_tenant_id));",
        },
    ),
    "public.scheduler_status": (
        AY_OUTBOX,
        AW,
        set(),
        {
            "-- messages the Owner approved are released while the global switch is on, whatever the business's automatic sending says",
            "'releases_approved', app.outbox_switch_on(),",
        },
    ),
    "public.assistant_save_reply": (
        AY_ASSISTANT,
        AS,
        {
            "or not app.assistant_pairs_ok(coalesce(p_sources, '[]'::jsonb), array['quote', 'lead', 'enquiry', 'order', 'company', 'customer', 'price_item', 'followup_draft', 'reply_draft', 'outbox_message', 'call_request', 'store_visit'])"
        },
        {
            "or not app.assistant_pairs_ok(coalesce(p_sources, '[]'::jsonb), array['quote', 'lead', 'enquiry', 'order', 'company', 'customer', 'price_item', 'followup_draft', 'reply_draft', 'outbox_message', 'call_request', 'store_visit', 'catalogue_item'])"
        },
    ),
    "public.today_summary": (
        AY_TODAY,
        AT,
        set(),
        {
            "v_visits  integer := 0;",
            "-- a visit Agent OWL PROPOSED (booked, source assistant, still to come within about two months, by the database clock) waits for a person to confirm it: Owner, Admin and Sales decide it. It is counted here so the menu's",
            "-- badge equals the cards on the page; it is not (yet) an item of the list below.",
            "if v_reader then",
            "select count(*)::integer into v_visits",
            "from public.store_visits v",
            "where v.tenant_id = p_tenant_id and v.status = 'booked' and v.source = 'assistant'",
            "and v.starts_at >= now() and v.starts_at < now() + interval '61 days';",
            "v_waiting := v_waiting + v_visits;",
            "end if;",
            "",
        },
    ),
}


@pytest.mark.parametrize("name", sorted(AY_CHANGED))
def test_the_ay_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    mig, compared, want_dropped, want_added = AY_CHANGED[name]
    # job BB (test_migration_copies_bb.py) replaces some of these again: this pin is about the last definition up to and including AY's migration
    defs = [d for d in definitions(name) if d[0] <= mig]
    assert defs[-1][0] == mig, f"{name} is redefined after job AY's migration ({defs[-1][0]}): re-copy it from the latest definition"
    before = [d for d in defs if d[0] == compared]
    assert before, f"{name} was not defined in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(before[-1][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    dropped = {line[1:].strip() for line in diff if line[0] == "-"}
    added = {line[1:].strip() for line in diff if line[0] == "+"}
    assert dropped == {w.strip() for w in want_dropped}, f"{name}: dropped {dropped}"
    assert added == {w.strip() for w in want_added}, f"{name}: added {added}"


def test_the_ay_cores_hold_no_bare_now_and_no_role_decision_and_the_wrappers_keep_their_role_checks() -> None:
    for core in ("app.outbox_submit_core", "app.outbox_claim_due_core", "app.outbox_mark_core"):
        body = definitions(core)[-1][1]
        code = "\n".join(line for line in body.split("\n") if not line.lstrip().startswith("--"))
        assert "now()" not in code.replace("app.outbox_now()", ""), core
        assert "has_tenant_role" not in code, f"{core} takes no role decision"
    for wrapper, roles in (("public.outbox_submit", "array['owner', 'admin', 'sales']"), ("public.outbox_claim_due", "array['owner', 'admin']")):
        body = definitions(wrapper)[-1][1]
        checks = [line.strip() for line in body.split("\n") if "app.has_tenant_role" in line]
        assert len(checks) == 1 and "v_uid is null" in checks[0] and roles in checks[0], wrapper
