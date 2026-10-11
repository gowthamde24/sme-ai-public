"""Job BD review (ADR 0071 addendum): migration 20261113090000 replaces `public.agent_record_usage` as a FULL COPY of the T007 definition (20261014090500) plus the lines named here. It must be the LAST
definition of that function and differ from the one before it by EXACTLY these lines, so a later copy of an old definition can never silently undo the voice rule."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

BD = "20261113090000_bd_voice_run_budget.sql"
T007 = "20261014090500_t007_cost_cap_review_fixes.sql"

DROPPED = {
    "or r.cost_micros_used::numeric + p_cost_micros > r.max_cost_micros then",
    "-- what is charged can never exceed the run's own cost budget",
    "if r.cost_micros_used::numeric + v_charge > r.max_cost_micros then",
    "cost_micros_used = a.cost_micros_used + v_charge",
}
ADDED = {
    "v_voice   boolean;",
    "v_voice_used bigint;",
    "-- job BD: a run that carries voice (a reservation of a voice-* accounting model, which is always made before its usage) has a larger cost ceiling, Rs 3.00; a run without voice keeps its own",
    "v_voice := exists (select 1 from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.model like 'voice-%');",
    "or r.cost_micros_used::numeric + p_cost_micros > (case when v_voice then greatest(r.max_cost_micros, 3000000) else r.max_cost_micros end) then",
    "-- what is charged can never exceed the run's own cost budget. Job BD: the run's own counter (cost_micros_used, which a table check holds to max_cost_micros) counts what the MODEL spends; a voice charge",
    "-- (speech to text, text to speech) is recorded on the ledger and the step but NOT in that counter, and is held instead to Rs 3.00 for the whole run (the model's spending and the voice charges together)",
    "select coalesce(sum(x.settled_micros), 0) into v_voice_used from public.agent_cost_reservations x",
    "where x.tenant_id = r.tenant_id and x.run_id = r.id and x.model like 'voice-%' and x.settled_micros is not null;",
    "if e.model like 'voice-%' then",
    "if r.cost_micros_used::numeric + v_voice_used + v_charge > greatest(r.max_cost_micros, 3000000) then",
    "perform app.agent_state_error('SM203');",
    "end if;",
    "elsif r.cost_micros_used::numeric + v_charge > r.max_cost_micros then",
    "cost_micros_used = a.cost_micros_used + (case when e.model like 'voice-%' then 0 else v_charge end)",
}


def test_the_bd_copy_is_the_last_definition_and_differs_from_t007_by_exactly_the_named_lines() -> (
    None
):
    defs = definitions("public.agent_record_usage")
    assert defs[-1][0] == BD, (
        f"agent_record_usage is redefined after job BD's migration ({defs[-1][0]}): re-copy it from the latest definition"
    )
    assert defs[-2][0] == T007
    diff = [
        line
        for line in difflib.unified_diff(
            normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0
        )
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == DROPPED
    assert {line[1:].strip() for line in diff if line[0] == "+"} == ADDED


def test_the_copy_keeps_the_definers_properties() -> None:
    body = definitions("public.agent_record_usage")[-1][1]
    assert "SECURITY DEFINER" in body and "SET search_path TO ''" in body
