"""The due list's candidates function (docs/plans/followups-due-candidates-plan.md, section 7): copy tests for migration 20261028090000.

* `public.followup_due_candidates` is defined ONCE, in that migration, and nothing after it redefines it without this file noticing; its text is PINNED (a normalised hash), so an edit to the terminal list, the
  role proof, the ordering or the paging must be made here on purpose;
* the STATIC "no cadence rules" guard turns the plan's constraint ("the function must never duplicate or change cadence rules") into a failing test: it calls only the named existing functions and contains none of
  the cadence vocabulary (gaps, quiet hours, weekdays, holidays, minimum gap, the offset); `max_touches` appears once, as an element of the terminal list;
* the terminal list is exactly the four answers of the database's own mirror of the engine whose engine counterparts are terminal, each of which the LAST definition of `app.followup_blocker_inner` can give;
* the grants: no PUBLIC, no anon, the signed-in role.
"""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import re
from pathlib import Path

MIGRATIONS = sorted((Path(__file__).resolve().parents[3] / "supabase" / "migrations").glob("*.sql"))
NAME = "public.followup_due_candidates"
MINE = next(m for m in MIGRATIONS if m.name == "20261028090000_t010_followup_due_candidates.sql")

# the normalised text of the function as built in C1; change it only on purpose, in the same commit as the migration's successor
PINNED_SHA256 = "4a1f756e28eabb25f09a75b74016cd322d7619842f73e485fd72b3e6b52d2647"

TERMINAL = ("suppressed", "replied", "closed", "max_touches")
CALLED = {
    "app.has_tenant_role",
    "app.followup_deny",
    "app.followup_error",
    "app.followup_active_policy_version",
    "app.quote_today",
    "app.followup_stopped",
    "app.followup_build",
    "app.followup_blocker",
}
CADENCE_VOCABULARY = (
    "gap_days",
    "min_gap_hours",
    "quiet_hours",
    "quiet_start",
    "quiet_end",
    "allowed_weekdays",
    "holidays",
    "recipient_utc_offset_minutes",
    "next_eligible",
    "eligible_now",
)


def definitions(name: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for path in MIGRATIONS:
        text = path.read_text()
        for m in re.finditer(rf"create (?:or replace )?function {re.escape(name)}\(", text):
            tail = text[m.start() :]
            found.append((path.name, tail[: tail.index("\n$$;") + 4]))
    return found


def mine() -> str:
    all_defs = definitions(NAME)
    assert [n for n, _ in all_defs] == [MINE.name], all_defs
    return all_defs[-1][1]


def code_only(text: str) -> str:
    """The function without its comments (a comment may name the rules it does not copy)."""
    return "\n".join(line.split("--")[0] for line in text.splitlines())


def test_the_function_is_defined_once_and_is_the_last_definition() -> None:
    assert [n for n, _ in definitions(NAME)] == [MINE.name]


def test_the_text_is_pinned() -> None:
    normalised = re.sub(r"\s+", " ", mine()).strip()
    assert hashlib.sha256(normalised.encode()).hexdigest() == PINNED_SHA256, (
        "public.followup_due_candidates changed: update the pin ON PURPOSE, together with pgTAP 66, the equivalence gate and the plan"
    )


def test_it_is_a_definer_stable_function_with_an_empty_search_path() -> None:
    text = mine()
    head = text.split("as $$")[0]
    for needle in ("language plpgsql", "stable", "security definer", "set search_path = ''"):
        assert needle in head, needle
    assert "volatile" not in head


def test_it_calls_only_the_named_existing_functions() -> None:
    body = code_only(mine())
    called = set(re.findall(r"\b((?:app|public)\.[a-z_]+)\(", body)) - {NAME}
    assert called <= CALLED, sorted(called - CALLED)
    assert {
        "app.followup_stopped",
        "app.followup_build",
        "app.followup_blocker",
        "app.has_tenant_role",
    } <= called, sorted(called)


def test_it_copies_no_cadence_rule() -> None:
    body = code_only(mine()).lower()
    for word in CADENCE_VOCABULARY:
        assert word not in body, (
            f"the candidates function must not read or copy the cadence rule vocabulary: {word}"
        )
    assert body.count("max_touches") == 1, (
        "max_touches may appear only as an element of the terminal list"
    )
    assert "interval" not in body and "isodow" not in body and "make_interval" not in body, (
        "no calendar or gap arithmetic belongs here"
    )
    assert "draft_followup" not in body and "'wait'" not in body, (
        "the function never returns or decides an engine action"
    )


def test_the_terminal_list_is_exactly_the_four_answers_and_each_can_be_given() -> None:
    body = code_only(mine())
    match = re.search(r"c_terminal constant text\[\] := array\[([^\]]*)\]", body)
    assert match
    assert tuple(re.findall(r"'([a-z_]+)'", match.group(1))) == TERMINAL
    blocker = definitions("app.followup_blocker_inner")[-1][1]
    answers = set(re.findall(r"return '([a-z_]+)'", blocker))
    assert set(TERMINAL) <= answers, (
        "the LAST blocker definition no longer gives a terminal answer this function relies on"
    )
    assert {"not_yet", "future_history", "initial_outreach", "invalid"} <= answers
    assert not (answers - set(TERMINAL)) & set(re.findall(r"'([a-z_]+)'", match.group(1))), (
        "a non-terminal answer is in the terminal list"
    )


def test_the_blocker_it_depends_on_has_not_been_redefined_since_the_equivalence_gate_pinned_it() -> (
    None
):
    last_inner = definitions("app.followup_blocker_inner")[-1][0]
    assert last_inner == "20261027090000_t010_part2_blocker_missing_arrays.sql", (
        f"app.followup_blocker_inner was redefined in {last_inner}: re-run the equivalence gate and review the terminal list of public.followup_due_candidates"
    )


def test_the_grants_are_the_signed_in_role_only() -> None:
    text = MINE.read_text()
    assert (
        "revoke all on function public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer) from public, anon;"
        in text
    )
    assert (
        "grant execute on function public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer) to authenticated;"
        in text
    )
    assert "to anon" not in text and "to public" not in text


def test_the_migration_adds_no_table_no_index_and_no_other_function() -> None:
    code = code_only(MINE.read_text()).lower()
    assert len(re.findall(r"\bcreate (?:or replace )?function\b", code)) == 1
    assert not re.search(
        r"\bcreate (?:unique )?index\b|\bcreate table\b|\balter table\b|\bcreate trigger\b", code
    )
