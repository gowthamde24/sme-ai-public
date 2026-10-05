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


@pytest.mark.parametrize("name", sorted(CHANGED))
def test_the_t008_copy_is_the_last_definition_and_only_adds_lines(name: str) -> None:
    defs = definitions(name)
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
