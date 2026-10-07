"""T008 (owner review of commit 3b): the T008 migrations REPLACE three functions of earlier tickets (a Postgres function is replaced whole,
so the new text is a copy of the old one plus the T008 lines). Drift is the risk: a copy of an OLD definition would silently undo a later fix
(the cost-cap changes, the claim-home changes). This test pins it down:

  * the T008 definition is the LAST definition of that function in the whole migration history (nothing redefines it afterwards without
    this test noticing and someone re-copying);
  * compared with the latest EARLIER definition, T008 only ADDS lines, except for a short, named list of lines it deliberately changes.
"""

# ruff: noqa: E501

from __future__ import annotations

import difflib
import re
from pathlib import Path

import pytest

MIGRATIONS = sorted((Path(__file__).resolve().parents[3] / "supabase" / "migrations").glob("*.sql"))
T008 = [m for m in MIGRATIONS if "_t008_" in m.name]
FIRST_T008 = T008[0].name

# function -> the earlier lines T008 replaces on purpose (stripped), and why
CHANGED = {
    "public.start_agent_run": {
        "or p_input_sha256 is null or p_target_kind not in ('company', 'lead') or jsonb_typeof(v_refs) <> 'object'",  # + 'enquiry'
        "and e.lead_id is not distinct from v_lead and e.input_sha256 = p_input_sha256 and e.input_refs = v_refs then",  # + enquiry_id
        "or p_target_kind = 'lead' and not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_target_id) then",
        "(id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, expires_at,",  # + enquiry_id
        "(p_run_id, p_tenant_id, v_uid, p_agent_name, p_agent_version, v_company, v_lead, v_exp,",  # + v_enquiry
    },
    "app.erase_contact": set(),
    "app.erase_company": set(),
}


def definitions(name: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for path in MIGRATIONS:
        text = path.read_text()
        for m in re.finditer(rf"create (?:or replace )?function {re.escape(name)}\(", text):
            tail = text[m.start() :]
            end = (
                tail.index("\n$function$;") + 11
                if "AS $function$" in tail[:4000]
                else tail.index("\n$$;") + 4
            )
            found.append((path.name, tail[:end]))
    return found


def normalised(text: str) -> list[str]:
    lines = [line.rstrip() for line in text.split("\n")]
    lines[0] = lines[0].replace("create function", "create or replace function")
    return lines


T010_SUPPRESSION = "20261018090000_t010_suppression_keys.sql"


@pytest.mark.parametrize("name", sorted(CHANGED))
def test_the_t008_copy_is_the_last_definition_and_only_adds_lines(name: str) -> None:
    # T010 (below) replaces erase_contact again; this test pins T008's copy as the last definition BEFORE that migration
    defs = [d for d in definitions(name) if d[0] < T010_SUPPRESSION]
    assert defs[-1][0] in {m.name for m in T008}, (
        f"{name} is redefined after T008 ({defs[-1][0]}): re-copy it from that definition"
    )
    earlier = [d for d in defs if d[0] < FIRST_T008]
    mine = [d for d in defs if d[0] in {m.name for m in T008}]
    assert earlier and mine
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(mine[-1][1]), lineterm="", n=0
        )
        if line.startswith("-") and not line.startswith("---")
    ]
    unexpected = [line for line in removed if line not in CHANGED[name]]
    assert not unexpected, f"{name}: the T008 copy drops lines of {earlier[-1][0]}: {unexpected}"


# ---------------------------------------------------------------------------------------------- T009 part 3
# Migration 20261017090000 replaces five functions of parts 1 and 2. Same rule: it must be the LAST definition, and compared with the latest earlier one it may only
# drop the lines named here (each is replaced by a line that adds COLLATE "C", a derived flag or the withdrawal guard).
PART3 = "20261017090000_t009_withdrawal_collation_repeat_flag.sql"
PART3_CHANGED = {
    "app.quote_build": {
        "select jsonb_agg(x order by x ->> 'sku') into v_pl from jsonb_array_elements(v_pl) x;",
        "'flags', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(v_flags) f),",
        "'review', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(v_review) f),",
    },
    "app.quote_price_version_normalised": {
        "select coalesce(jsonb_agg(item order by item ->> 'sku'), '[]'::jsonb) from ("
    },
    "app.quote_create_price_version": {
        "select jsonb_agg(x order by x ->> 'sku') into v_norm from jsonb_array_elements(v_norm) x;"
    },
    "app.quote_result_flags": {
        "as $$ select coalesce(array_agg(distinct x ->> 'code' order by x ->> 'code'), '{}') from jsonb_array_elements(p_result -> 'flags' -> 'reasons') x $$;"
    },
    "app.quote_guard_update": {
        "if (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code')",
        "is distinct from (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code') then",
    },
}


def block_definitions(name: str) -> list[tuple[str, str]]:
    """Every definition of `name`, from its `create` line to the first `$$;` after its `as $$` (right for one-line SQL functions too)."""
    found: list[tuple[str, str]] = []
    for path in MIGRATIONS:
        text = path.read_text()
        for m in re.finditer(rf"create (?:or replace )?function {re.escape(name)}\(", text):
            start = text.index("as $$", m.start()) + 5
            found.append((path.name, text[m.start() : text.index("$$;", start) + 3]))
    return found


@pytest.mark.parametrize("name", sorted(PART3_CHANGED))
def test_the_part3_copy_is_the_last_definition_and_only_drops_the_named_lines(name: str) -> None:
    defs = block_definitions(name)
    assert defs[-1][0] == PART3, (
        f"{name} is redefined after part 3 ({defs[-1][0]}) or part 3 does not define it: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < PART3]
    assert earlier
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line.startswith("-") and not line.startswith("---")
    ]
    unexpected = [line for line in removed if line not in PART3_CHANGED[name]]
    assert not unexpected, f"{name}: part 3 drops lines of {earlier[-1][0]}: {unexpected}"


# ---------------------------------------------------------------------------------------------- T009 step 3: the seed's seller state
SEED = "20261017090100_t009_seed_state_code.sql"
SEED_FN = "app.operator_seed_quote_reference_data"


def test_the_seed_copy_is_the_last_definition_and_changes_exactly_the_seller_state() -> None:
    defs = [
        d for d in block_definitions(SEED_FN) if d[0] < SMALL
    ]  # the small-fixes migration (below) changes the credit limit again
    assert defs[-1][0] == SEED, (
        f"{SEED_FN} is redefined after {SEED}: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < SEED]
    assert earlier
    diff = [
        line
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert [line[1:].strip() for line in diff if line[0] == "-"] == [
        "'seller_state', 'TS', 'required_inputs', jsonb_build_array('delivery_state')));"
    ]
    assert [line[1:].strip() for line in diff if line[0] == "+"] == [
        "'seller_state', 'TG', 'required_inputs', jsonb_build_array('delivery_state')));"
    ]


# ---------------------------------------------------------------------------------------------- T010 part 1 (ADR 0020)
# Migration 20261018090000 replaces three functions. It must be the LAST definition of each, and compared with the latest earlier one it may only DROP the lines named here
# (lift_suppression: the Owner-or-Admin role check becomes the Owner-only check followed by the second factor). erase_contact and erase_tenant only ADD lines.
T010_CHANGED = {
    "app.erase_contact": set(),
    "app.erase_tenant": set(),
    "public.lift_suppression": {
        "if not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then",
        "raise exception 'only an owner or admin can lift a suppression' using errcode = '42501';",
    },
}


@pytest.mark.parametrize("name", sorted(T010_CHANGED))
def test_the_t010_copy_is_the_last_definition_and_only_drops_the_named_lines(name: str) -> None:
    defs = [
        d for d in definitions(name) if d[0] < "20261021090000_erased_marker.sql"
    ]  # (the erased-marker migration replaces the erasure functions again)
    assert defs[-1][0] == T010_SUPPRESSION, (
        f"{name} is redefined after T010 ({defs[-1][0]}) or T010 does not define it: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < T010_SUPPRESSION]
    assert earlier
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line.startswith("-") and not line.startswith("---")
    ]
    unexpected = [line for line in removed if line not in T010_CHANGED[name]]
    assert not unexpected, f"{name}: T010 drops lines of {earlier[-1][0]}: {unexpected}"


# ---------------------------------------------------------------------------------------------- order conversion (ADR 0021)
# Migration 20261019090000 replaces two quote functions with the latest earlier definitions plus the SM237 lines. It must be the LAST definition of each, and compared with the
# latest earlier one it may only DROP the lines named here (approve_quote drops nothing; withdraw_approved_quote's HOOK comment becomes the SM237 check).
ORDERS = "20261019090000_order_conversion.sql"
ORDERS_CHANGED = {
    "public.approve_quote": set(),
    "public.withdraw_approved_quote": {
        "-- HOOK (order conversion, docs/plans/order-conversion.md): once an order exists for this quote the withdrawal is refused here"
    },
}


@pytest.mark.parametrize("name", sorted(ORDERS_CHANGED))
def test_the_order_copy_is_the_last_definition_and_only_drops_the_named_lines(name: str) -> None:
    # the review fixes (below) replace both functions again; this pins the order migration's copy as the last definition BEFORE that migration
    defs = [d for d in definitions(name) if d[0] < "20261020090000_review_fixes.sql"]
    assert defs[-1][0] == ORDERS, (
        f"{name} is redefined after order conversion ({defs[-1][0]}) or the order migration does not define it: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < ORDERS]
    assert earlier
    diff = list(
        difflib.unified_diff(normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0)
    )
    removed = [
        line[1:].strip() for line in diff if line.startswith("-") and not line.startswith("---")
    ]
    added = [
        line[1:].strip() for line in diff if line.startswith("+") and not line.startswith("+++")
    ]
    unexpected = [line for line in removed if line not in ORDERS_CHANGED[name]]
    assert not unexpected, f"{name}: order conversion drops lines of {earlier[-1][0]}: {unexpected}"
    # what it adds is the SM237 check and nothing else that touches the quote
    assert any("app.order_error('SM237')" in line for line in added), name
    assert not any("update public.quotes" in line for line in added if "SM237" not in line), name


def test_the_order_migration_is_the_last_to_define_the_two_quote_functions_and_nothing_after_it_does() -> (
    None
):
    later = [m.name for m in MIGRATIONS if m.name > ORDERS]
    for name in ORDERS_CHANGED:
        assert all(d[0] <= "20261020090000_review_fixes.sql" for d in definitions(name)), (
            name,
            later,
        )


# ---------------------------------------------------------------------------------------------- review fixes (owner review of T010 part 1 and the order database)
# Migration 20261020090000 replaces functions of two earlier migrations with the LATEST definitions plus the lines named in its header. It must be the LAST definition of each; compared
# with the latest earlier one it may only drop a line that it re-adds (indentation aside) or that is named here.
REVIEW = "20261020090000_review_fixes.sql"
MARKER = "20261021090000_erased_marker.sql"
SMALL = "20261022090000_small_fixes.sql"
NOPRICE = "20261023090000_seed_without_price_list.sql"
REVIEW_CHANGED: dict[str, set[str]] = {
    "app.contacts_sync_suppression_keys": set(),
    "app.order_error": {"when 'SM234' then 'a refund needs the owner'"},
    "public.record_order_event": {
        "v_approver := case when 'REFUND_REQUIRES_OWNER_APPROVAL' = any (v_flags) or 'ADVANCE_OVERRIDE' = any (v_flags) then v_uid end;"
    },
    "public.withdraw_approved_quote": {
        "if exists (select 1 from public.orders o where o.tenant_id = z.tenant_id and o.quote_id = z.id) then"
    },
    "public.approve_quote": {
        "if exists (select 1 from public.quotes x join public.orders o on o.tenant_id = x.tenant_id and o.quote_id = x.id"
    },
}
# rewritten, not copied: only "it is the last definition" is pinned
REVIEW_REWRITTEN = ("app.order_stops_followups",)


@pytest.mark.parametrize("name", sorted(REVIEW_CHANGED))
def test_the_review_copy_is_the_last_definition_and_only_drops_the_named_lines(name: str) -> None:
    # the erased-marker migration (below) replaces the sync trigger again: pin the review migration's copy as the last definition BEFORE it
    defs = [d for d in definitions(name) if d[0] < MARKER]
    assert defs[-1][0] == REVIEW, (
        f"{name} is redefined after the review fixes ({defs[-1][0]}) or the review migration does not define it: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < REVIEW]
    assert earlier
    kept = {line.strip() for line in defs[-1][1].split("\n")}
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line.startswith("-") and not line.startswith("---")
    ]
    unexpected = [line for line in removed if line not in REVIEW_CHANGED[name] and line not in kept]
    assert not unexpected, f"{name}: the review fixes drop lines of {earlier[-1][0]}: {unexpected}"


@pytest.mark.parametrize("name", REVIEW_REWRITTEN)
def test_a_rewritten_review_function_is_the_last_definition(name: str) -> None:
    defs = [d for d in definitions(name) if d[0] < MARKER]
    assert defs[-1][0] == REVIEW, f"{name} is redefined after the review fixes ({defs[-1][0]})"


# ---------------------------------------------------------------------------------------------- the erased marker (second review, step 0)
# Migration 20261021090000 replaces the two erasure functions and the sync trigger. Last definition; compared with the latest earlier one it may only drop a line it re-adds
# (indentation aside) or one named here.
MARKER_CHANGED: dict[str, set[str]] = {
    "app.order_stops_followups": {
        "select o.state, z.quote_no from public.orders o join public.quotes z on z.tenant_id = o.tenant_id and z.id = o.quote_id",
        "-- a newer approved quote of the lead that has no order yet: a new deal is being made, nothing stops",
        "select 1 from latest l join public.quotes q on q.lead_id = p_lead and q.status = 'approved' and q.quote_no > l.quote_no",
    },
    "app.erase_contact": {
        "if c.email is not null and k.email_hmac is not null",
        "and app.suppression_key_add(r.tenant_id, 'email', k.email_hmac, k.key_version, 'erased', c.id, auth.uid()) then",
        "if c.phone is not null and k.phone_hmac is not null",
        "and app.suppression_key_add(r.tenant_id, 'phone', k.phone_hmac, k.key_version, 'erased', c.id, auth.uid()) then",
    },
    "app.erase_tenant": {
        "if k.email_hmac is not null and app.suppression_key_add(r.tenant_id, 'email', k.email_hmac, k.key_version, 'erased', k.contact_id, auth.uid()) then",
        "if k.phone_hmac is not null and app.suppression_key_add(r.tenant_id, 'phone', k.phone_hmac, k.key_version, 'erased', k.contact_id, auth.uid()) then",
    },
    "app.contacts_sync_suppression_keys": {
        "-- ... and a key whose current suppression came from an ERASURE stays suppressed (a person erased by right is never re-contacted through a shared number)",
        "and not exists (select 1 from (select e.event, e.reason from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'email' and e.key_hmac = k.email_hmac",
        "order by e.seq desc limit 1) l where l.event = 'suppressed' and l.reason = 'erased') then",
        "and not exists (select 1 from (select e.event, e.reason from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'phone' and e.key_hmac = k.phone_hmac",
    },
}


@pytest.mark.parametrize("name", sorted(MARKER_CHANGED))
def test_the_marker_copy_is_the_last_definition_and_only_drops_the_named_lines(name: str) -> None:
    defs = definitions(name)
    assert defs[-1][0] == MARKER, (
        f"{name} is redefined after the erased marker ({defs[-1][0]}) or the marker migration does not define it: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < MARKER]
    assert earlier
    kept = {line.strip() for line in defs[-1][1].split("\n")}
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line.startswith("-") and not line.startswith("---")
    ]
    unexpected = [line for line in removed if line not in MARKER_CHANGED[name] and line not in kept]
    assert not unexpected, (
        f"{name}: the marker migration drops lines of {earlier[-1][0]}: {unexpected}"
    )


# ---------------------------------------------------------------------------------------------- small fixes (owner review of rehearsal steps 0-3)
# Migration 20261022090000: A1 add_requirement_field (an exact retry replays on a confirmed requirement: lines are ADDED only) and A3 the seed's repeat credit limit (exactly one line changes).
def test_the_small_fixes_copy_of_add_requirement_field_is_the_last_definition_and_only_adds_lines() -> (
    None
):
    defs = definitions("public.add_requirement_field")
    assert defs[-1][0] == SMALL, (
        f"add_requirement_field is redefined after the small fixes ({defs[-1][0]}): re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < SMALL]
    assert earlier
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line.startswith("-") and not line.startswith("---")
    ]
    kept = {line.strip() for line in defs[-1][1].split("\n")}
    assert [line for line in removed if line not in kept] == []


def test_the_small_fixes_seed_changes_exactly_the_repeat_credit_limit() -> None:
    defs = [
        d for d in block_definitions(SEED_FN) if d[0] < NOPRICE
    ]  # the next migration (below) adds the skip switch
    assert defs[-1][0] == SMALL, (
        f"{SEED_FN} is redefined after the small fixes ({defs[-1][0]}): re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < SMALL]
    diff = [
        line
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert [line[1:].strip() for line in diff if line[0] == "-"] == [
        "'repeat_advance_bps', 2500, 'net_days', 30, 'tax_mode', 'exclusive', 'rounding_mode', 'half_up', 'repeat_credit_limit_paise', 0,"
    ]
    assert [line[1:].strip() for line in diff if line[0] == "+"] == [
        "'repeat_advance_bps', 2500, 'net_days', 30, 'tax_mode', 'exclusive', 'rounding_mode', 'half_up', 'repeat_credit_limit_paise', 50000000,"
    ]


# ---------------------------------------------------------------------------------------------- seed without a price list (rehearsal step 5)
def test_the_seed_can_skip_the_price_list_and_changes_exactly_one_line() -> None:
    defs = block_definitions(SEED_FN)
    assert defs[-1][0] == NOPRICE, (
        f"{SEED_FN} is redefined after {NOPRICE} ({defs[-1][0]}): re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < NOPRICE]
    diff = [
        line
        for line in difflib.unified_diff(
            normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert [line[1:].strip() for line in diff if line[0] == "-"] == [
        "if not exists (select 1 from public.price_list_versions v where v.tenant_id = v_tenant) then"
    ]
    assert [line[1:].strip() for line in diff if line[0] == "+"] == [
        "if not exists (select 1 from public.price_list_versions v where v.tenant_id = v_tenant) and coalesce(current_setting('app.seed_skip_price_list', true), '') <> 'on' then"
    ]


# ---------------------------------------------------------------------------------------------- T010 part 2, commit 2b: the blocker follows the engine's order
BLOCKER_FN = "app.followup_blocker_inner"
BLOCKER_ORDER = "20261025090000_t010_part2_blocker_order.sql"


def _code_lines(text: str) -> list[str]:
    """The statements of a function body, comments and blank lines dropped, whitespace stripped."""
    return [ln.strip() for ln in text.split("\n") if ln.strip() and not ln.strip().startswith("--")]


def test_the_blocker_order_copy_is_the_last_definition_and_only_moves_one_block() -> None:
    defs = block_definitions(BLOCKER_FN)
    assert defs[-1][0] == BLOCKER_ORDER, (
        f"{BLOCKER_FN} is redefined after {BLOCKER_ORDER} ({defs[-1][0]}): re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < BLOCKER_ORDER]
    assert earlier
    old, new = _code_lines(earlier[-1][1]), _code_lines(defs[-1][1])
    # the same statements, reordered: nothing added, nothing dropped (the `create function` line becomes `create or replace function`)
    assert sorted(old[1:]) == sorted(new[1:]) and old[0] != new[0]
    assert old != new
    # and the moved block is the future-history check, now BEFORE the first stop flag
    moved = "return 'future_history';"
    assert old.index(moved) > old.index("return 'suppressed';")
    assert new.index(moved) < new.index("return 'suppressed';")
    assert (
        new.index("return 'suppressed';")
        < new.index("return 'replied';")
        < new.index("return 'closed';")
    )
    assert (
        new.index("return 'closed';")
        < new.index("return 'max_touches';")
        < new.index("return 'initial_outreach';")
    )
