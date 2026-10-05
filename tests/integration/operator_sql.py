"""Operator-level SQL for the integration tests that must act as the OPERATOR of the LOCAL stack:
flip an agent switch, move a run's clock. Nothing in the application can do this (the tables have
no client grant); a migration or the database owner can.

It talks to the local database container (`docker exec ... psql`), so it cannot reach anything but
this machine's stack, and it needs no key of any kind. The container name is derived from
supabase/config.toml's project_id."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def container() -> str:
    match = re.search(
        r'^project_id\s*=\s*"([^"]+)"', (ROOT / "supabase" / "config.toml").read_text(), re.M
    )
    assert match, "supabase/config.toml has no project_id"
    return f"supabase_db_{match.group(1)}"


def sql(statement: str) -> str:
    docker = shutil.which("docker")
    if docker is None:
        pytest.fail(
            "docker is required for the agent integration tests (the local Supabase stack runs in it)"
        )
    result = subprocess.run(  # noqa: S603 - fixed argv, our own container, our own SQL text
        [
            docker,
            "exec",
            "-i",
            container(),
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-c",
            statement,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        pytest.fail(f"operator SQL failed: {result.stderr.strip()[:300]}")
    return result.stdout.strip()


def sql_result(statement: str, *, timeout: int = 60) -> tuple[int, str, str]:
    """Like sql() but returns (exit code, stdout, stderr) instead of failing the test: for sessions that are EXPECTED to be
    able to fail, or that must run concurrently with another (a held transaction)."""
    docker = shutil.which("docker")
    if docker is None:
        pytest.fail("docker is required for the agent integration tests")
    result = subprocess.run(  # noqa: S603 - fixed argv, our own container, our own SQL text
        [
            docker,
            "exec",
            "-i",
            container(),
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-X",
            "-q",
            "-At",
            "-c",
            statement,
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def as_user(user_id: str, body: str, *, hold_seconds: float = 0.0) -> str:
    """One transaction that runs `body` (SQL statements) as the authenticated user `user_id`, the way PostgREST would
    (role + JWT claims), optionally HOLDING the transaction open for `hold_seconds` before it commits, then prints the
    commit time. The output is the statement results followed by the commit timestamp (the last line)."""
    claims = json.dumps({"sub": user_id, "role": "authenticated"})
    hold = f"select pg_sleep({hold_seconds});" if hold_seconds else ""
    return (
        "begin; set local role authenticated; "
        f"select set_config('request.jwt.claims', '{claims}', true); "
        f"{body} {hold} commit; select clock_timestamp();"
    )


def snapshot_switches() -> dict[str, object]:
    """The current platform switches and the selftest allow-list, to restore them exactly afterwards."""
    raw = sql(
        "select json_build_object("
        "'flags', (select json_object_agg(key, enabled) from public.platform_flags),"
        "'allowed', (select allowed_tenants from public.agent_definitions where agent_name = 'selftest'))"
    )
    parsed: dict[str, object] = json.loads(raw)
    return parsed


def restore_switches(saved: dict[str, object]) -> None:
    flags = saved["flags"]
    assert isinstance(flags, dict)
    for key, enabled in flags.items():
        sql(
            f"update public.platform_flags set enabled = {'true' if enabled else 'false'} where key = '{key}'"
        )
    allowed = saved["allowed"]
    if allowed is None:
        sql(
            "update public.agent_definitions set allowed_tenants = null where agent_name = 'selftest'"
        )
    else:
        assert isinstance(allowed, list)
        items = ",".join(f"'{a}'" for a in allowed)
        sql(
            f"update public.agent_definitions set allowed_tenants = array[{items}]::uuid[] where agent_name = 'selftest'"
        )


def open_real_data_gate(tenant_id: str) -> None:
    """Open the real-data gate for one LOCAL workspace, the way the operator does (ADR 0015). Tests that plant real-looking contact data
    (the erasure suites) call this for their own tenants; everything else runs with the gate closed, as a new workspace does."""
    sql(
        f"select app.operator_open_real_data_gate((select slug from public.tenants where id = '{tenant_id}'), "
        "'adr:0014', 'doc:it-hosting', 'doc:it-dpdp', 'doc:it-restore')"
    )


def close_real_data_gate(tenant_id: str) -> None:
    sql(
        f"select app.operator_close_real_data_gate((select slug from public.tenants where id = '{tenant_id}'))"
    )
