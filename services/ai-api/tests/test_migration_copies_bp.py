"""Job BP (ADR 0078): migration 20261119090000 replaces `public.agent_record_usage` as a FULL COPY of job BD's definition (20261113090000). It must be the LAST definition of that function and differ from
BD's by EXACTLY these lines (every `voice-%` test becomes `app.is_metered_model(...)`, and the voice-only ceiling of Rs 3.00 becomes `app.metered_ceiling(tenant, run)`, which is still Rs 3.00 for a run with
voice only), so a later copy of an old definition can never silently undo the web-tool accounting or the voice rule."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

BP = "20261119090000_bp_research_tools.sql"
BD = "20261113090000_bd_voice_run_budget.sql"

DROPPED = {
    "v_voice := exists (select 1 from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.model like 'voice-%');",
    "or r.cost_micros_used::numeric + p_cost_micros > (case when v_voice then greatest(r.max_cost_micros, 3000000) else r.max_cost_micros end) then",
    "where x.tenant_id = r.tenant_id and x.run_id = r.id and x.model like 'voice-%' and x.settled_micros is not null;",
    "if e.model like 'voice-%' then",
    "if r.cost_micros_used::numeric + v_voice_used + v_charge > greatest(r.max_cost_micros, 3000000) then",
    "cost_micros_used = a.cost_micros_used + (case when e.model like 'voice-%' then 0 else v_charge end)",
}
ADDED = {
    "v_voice := exists (select 1 from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and app.is_metered_model(x.model));",
    "or r.cost_micros_used::numeric + p_cost_micros > (case when v_voice then greatest(r.max_cost_micros, app.metered_ceiling(r.tenant_id, r.id)) else r.max_cost_micros end) then",
    "where x.tenant_id = r.tenant_id and x.run_id = r.id and app.is_metered_model(x.model) and x.settled_micros is not null;",
    "if app.is_metered_model(e.model) then",
    "if r.cost_micros_used::numeric + v_voice_used + v_charge > greatest(r.max_cost_micros, app.metered_ceiling(r.tenant_id, r.id)) then",
    "cost_micros_used = a.cost_micros_used + (case when app.is_metered_model(e.model) then 0 else v_charge end)",
}


def test_the_bp_copy_is_the_last_definition_and_differs_from_bd_by_exactly_the_named_lines() -> None:
    defs = definitions("public.agent_record_usage")
    assert defs[-1][0] == BP, (
        f"agent_record_usage is redefined after job BP's migration ({defs[-1][0]}): re-copy it from the latest definition"
    )
    assert defs[-2][0] == BD
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == DROPPED
    assert {line[1:].strip() for line in diff if line[0] == "+"} == ADDED


def test_the_copy_keeps_the_definers_properties() -> None:
    body = definitions("public.agent_record_usage")[-1][1]
    assert "SECURITY DEFINER" in body and "SET search_path TO ''" in body
