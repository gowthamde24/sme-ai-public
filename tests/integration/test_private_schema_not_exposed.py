"""The private `app` schema (RLS helpers, audit writer, trigger functions) must be unreachable
through PostgREST for every kind of caller.

Docker-free twin: services/ai-api/tests/test_supabase_config.py.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import Stack, User

# Every function in schema `app` (T002 and T003 migrations).
# Calling any of them as an API RPC must fail.
APP_FUNCTIONS = [
    "is_tenant_member",
    "has_tenant_role",
    "my_tenant_ids",
    "my_tenant_ids_with_role",
    "my_co_member_ids",
    "can_contact",
    "append_only",
    "set_created_meta",
    "guard_archive",
    "guard_opportunity_status",
    "write_audit_event",
    "audit_row_change",
    "audit_events_append_only",
    "protect_last_owner",
    "handle_new_user",
    "forbid_tenant_id_change",
    "set_updated_at",
    # T006b (ADR 0014): the erasure internals
    "erase_column",
    "erasure_sweep",
    "erase_contact",
    "erase_company",
    "erase_tenant",
    "erasure_running",
    "erasure_columns",
    "guard_consent_update",
    "guard_audit_update",
    "guard_erased_row",
    # T007 M2 / 3: the daily cost cap (the clock helper among them)
    "agent_utc_today",
    "agent_cost_micros",
    "agent_daily_cap",
    "agent_day_spend",
    "agent_cost_lock",
]
# "suppression" is T010 (ADR 0020)
HIDDEN_SCHEMAS = [
    "app",
    "auth",
    "extensions",
    "tests",
    "storage",
    "graphql_public",
    "erasure",
    "suppression",
]


@pytest.fixture(scope="module")
def alice(signup: Any) -> User:
    user: User = signup("schema-probe")
    return user


def call(stack: Stack, token: str | None, method: str, path: str, **extra: str) -> httpx.Response:
    return httpx.request(
        method, f"{stack.rest}{path}", headers=stack.headers(token, **extra), json={}, timeout=15
    )


@pytest.mark.parametrize("schema", HIDDEN_SCHEMAS)
@pytest.mark.parametrize("as_user", [False, True])
def test_hidden_schemas_cannot_be_selected_as_a_profile(
    stack: Stack, alice: User, schema: str, as_user: bool
) -> None:
    token = alice.token if as_user else None
    read = call(stack, token, "GET", "/memberships", **{"Accept-Profile": schema})
    assert read.status_code == 406 and read.json()["code"] == "PGRST106", schema
    write = call(stack, token, "POST", "/rpc/is_tenant_member", **{"Content-Profile": schema})
    assert write.status_code == 406 and write.json()["code"] == "PGRST106", schema


@pytest.mark.parametrize("function", APP_FUNCTIONS)
@pytest.mark.parametrize("as_user", [False, True])
def test_app_functions_are_not_callable_as_rpc(
    stack: Stack, alice: User, function: str, as_user: bool
) -> None:
    token = alice.token if as_user else None
    # Default profile (public): the name must not resolve.
    plain = call(stack, token, "POST", f"/rpc/{function}")
    assert plain.status_code == 404 and plain.json()["code"] == "PGRST202", function
    # Explicit app profile: schema itself is refused.
    explicit = call(stack, token, "POST", f"/rpc/{function}", **{"Content-Profile": "app"})
    assert explicit.status_code == 406 and explicit.json()["code"] == "PGRST106", function


def test_openapi_document_lists_no_private_objects(stack: Stack, alice: User) -> None:
    for token in (None, alice.token):
        response = httpx.get(
            f"{stack.rest}/",
            headers={**stack.headers(token), "Accept": "application/openapi+json"},
            timeout=15,
        )
        if response.status_code != 200:  # OpenAPI disabled for this caller is also acceptable
            continue
        paths = set(response.json().get("paths", {}))
        assert {f"/rpc/{fn}" for fn in APP_FUNCTIONS}.isdisjoint(paths)
        if token is not None:
            assert "/rpc/create_tenant" in paths, "non-vacuous: public RPCs are listed"
