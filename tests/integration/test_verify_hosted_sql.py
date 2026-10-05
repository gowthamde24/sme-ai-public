"""supabase/hosted/verify.sql is what the operator runs on a hosted project. Here it runs against the LOCAL schema, which must pass every
check, and against deliberately broken copies (inside a transaction that is rolled back), each of which it must catch."""

# ruff: noqa: E501, S608

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


ENROLLED = "every Owner and Admin has a verified authenticator"
NO_OWNER_WITHOUT_FACTOR = (
    "set session_replication_role = replica; "  # (no triggers: this is a throwaway transaction)
    "delete from public.memberships m where m.role in ('owner', 'admin') and not exists "
    "(select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified' and f.factor_type = 'totp'); "
)


def test_the_local_schema_passes_every_check_once_every_owner_and_admin_has_an_authenticator() -> (
    None
):
    rows = run(NO_OWNER_WITHOUT_FACTOR)
    assert len(rows) >= 20
    assert failures(rows) == []
    assert rows[ENROLLED][0] == "t"
    assert rows["the second-factor enforcement is installed (ADR 0016)"][0] == "t"


def test_an_owner_without_an_authenticator_is_a_failure_with_a_count() -> None:
    rows = run(
        NO_OWNER_WITHOUT_FACTOR
        + "insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values "
        "('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-owner@it.example.test', now(), now()); "
        "insert into public.tenants (id, name, slug) values ('00000000-0000-0000-0000-00000000bb01', 'Probe', 'probe-verify'); "
        "insert into public.memberships (tenant_id, user_id, role) values ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa01', 'owner'); "
    )
    assert failures(rows) == [ENROLLED]
    assert rows[ENROLLED][1].startswith("1 Owner / Admin account(s) without one")


def test_the_local_schema_fails_only_the_enrolment_check_today() -> None:
    """Tests create Owners without an authenticator on purpose; every OTHER check passes on the real schema."""
    rows = run()
    assert set(failures(rows)) <= {ENROLLED}
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
