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
    defs = block_definitions(SEED_FN)
    assert defs[-1][0] == SEED, f"{SEED_FN} is redefined after {SEED}: re-copy it from the latest definition"
    earlier = [d for d in defs if d[0] < SEED]
    assert earlier
    diff = [
        line
        for line in difflib.unified_diff(normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0)
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
    defs = definitions(name)
    assert defs[-1][0] == T010_SUPPRESSION, (
        f"{name} is redefined after T010 ({defs[-1][0]}) or T010 does not define it: re-copy it from the latest definition"
    )
    earlier = [d for d in defs if d[0] < T010_SUPPRESSION]
    assert earlier
    removed = [
        line[1:].strip()
        for line in difflib.unified_diff(normalised(earlier[-1][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line.startswith("-") and not line.startswith("---")
    ]
    unexpected = [line for line in removed if line not in T010_CHANGED[name]]
    assert not unexpected, f"{name}: T010 drops lines of {earlier[-1][0]}: {unexpected}"
