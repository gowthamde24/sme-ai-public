"""supabase/hosted/verify.sql is what the operator runs on a hosted project. Here it runs against the LOCAL schema, which must pass every
check, and against deliberately broken copies (inside a transaction that is rolled back), each of which it must catch."""

# ruff: noqa: E501

from __future__ import annotations

from pathlib import Path

import operator_sql
import pytest

SQL = (Path(__file__).resolve().parents[2] / "supabase" / "hosted" / "verify.sql").read_text()


def run(preamble: str = "") -> dict[str, tuple[str, str]]:
    """{check name: (ok, detail)} from the verifier, after `preamble` (statements that break something), in a transaction rolled back."""
    out = operator_sql.sql(f"begin; {preamble}\n{SQL}\nrollback;")
    rows: dict[str, tuple[str, str]] = {}
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) >= 3:
            rows[parts[0]] = (parts[1], "|".join(parts[2:]))
    return rows


def failures(rows: dict[str, tuple[str, str]]) -> list[str]:
    return sorted(name for name, (ok, _) in rows.items() if ok == "f")


def test_the_local_schema_passes_every_check() -> None:
    rows = run()
    assert len(rows) >= 18
    assert failures(rows) == []
    assert rows["connected as the trusted role"][0] == "t"
    assert rows["INFO workspaces with the real-data gate OPEN"][0] == "", (
        "an INFO row has no verdict"
    )


@pytest.mark.parametrize(
    ("preamble", "check"),
    [
        (
            "grant insert on public.tenant_data_policy to authenticated;",
            "clients cannot write the immutable and operator tables",
        ),
        (
            "grant update on public.audit_events to authenticated;",
            "clients cannot write the immutable and operator tables",
        ),
        ("grant select on public.contacts to anon;", "anon holds no privilege on any public table"),
        (
            "alter table public.contacts no force row level security;",
            "RLS enabled and forced on every table with a tenant_id",
        ),
        (
            "alter table public.leads disable row level security;",
            "RLS enabled and forced on every table with a tenant_id",
        ),
        (
            "grant execute on function app.operator_open_real_data_gate(text, text, text, text, text) to authenticated;",
            "operator functions are not executable by any client role",
        ),
        (
            "grant usage on schema erasure to authenticated;",
            "private schemas are closed to client roles",
        ),
        (
            "drop trigger contacts_guard_real_data on public.contacts;",
            "the contacts guards are in place (gate and erased-row)",
        ),
        (
            "drop trigger contacts_guard_erased on public.contacts;",
            "the contacts guards are in place (gate and erased-row)",
        ),
        (
            "alter function public.execute_erasure(uuid, boolean) reset statement_timeout;",
            "execute_erasure carries its own statement timeout",
        ),
        (
            "create role verify_probe_owner nologin; grant verify_probe_owner to postgres; grant create on schema app to verify_probe_owner; alter function app.real_data_gate_open(uuid) owner to verify_probe_owner;",
            "definer functions owned by postgres",
        ),
        (
            "grant select on public.erasure_requests to anon;",
            "no operator-only table is readable by anon",
        ),
    ],
)
def test_each_breakage_is_caught(preamble: str, check: str) -> None:
    rows = run(preamble)
    assert check in failures(rows), (preamble, failures(rows))


def test_a_definer_function_without_a_pinned_search_path_is_caught() -> None:
    rows = run("alter function public.cancel_erasure(uuid) reset search_path;")
    assert "every definer function pins search_path" in failures(rows)


def test_a_changed_provenance_predicate_is_caught() -> None:
    rows = run(
        "create or replace function app.set_agent_run_id() returns trigger language plpgsql set search_path = '' as $$ begin return new; end $$;"
    )
    assert "the provenance predicate is intact (set_created_meta, set_agent_run_id)" in failures(
        rows
    )
