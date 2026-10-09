"""The PostgREST adapter: what it sends (caller's JWT, anon key, no privileged key) and how it
maps the data layer's answers."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from app.tenancy.models import Role
from app.tenancy.repository import (
    EmailNotConfirmed,
    Forbidden,
    InvalidInput,
    PostgrestTenantRepository,
    SlugUnavailable,
    TermsNotAccepted,
    TokenRejected,
    UpstreamError,
    WorkspaceLimitReached,
)

USER = uuid.UUID(int=1)
TENANT = uuid.UUID(int=2)
USER_TOKEN = "user.jwt.token"
ANON_KEY = "public-anon-key"


def repo_with(handler: Any) -> tuple[PostgrestTenantRepository, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(recording)
    )
    return PostgrestTenantRepository("http://postgrest.test/rest/v1", ANON_KEY, client=client), seen


def json_response(body: Any, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body)


def test_requests_carry_the_users_jwt_and_the_anon_key_only() -> None:
    repo, seen = repo_with(lambda r: json_response([]))
    repo.get_me(USER_TOKEN, USER)
    request = seen[0]
    assert request.headers["authorization"] == f"Bearer {USER_TOKEN}"
    assert request.headers["apikey"] == ANON_KEY
    assert set(request.headers) & {"x-service-role", "service_role"} == set()


def test_get_me_parses_embedded_tenants() -> None:
    tenant = {"id": str(TENANT), "name": "Tenant A", "slug": "tenant-a"}
    repo, seen = repo_with(lambda r: json_response([{"role": "admin", "tenants": tenant}]))
    me = repo.get_me(USER_TOKEN, USER)
    assert me.memberships[0].role is Role.ADMIN
    assert me.memberships[0].tenant.slug == "tenant-a"
    assert seen[0].url.params["user_id"] == f"eq.{USER}"


def test_get_membership_filters_by_user_and_tenant_and_returns_none_when_absent() -> None:
    repo, seen = repo_with(lambda r: json_response([]))
    assert repo.get_membership(USER_TOKEN, USER, TENANT) is None
    params = seen[0].url.params
    assert params["user_id"] == f"eq.{USER}"
    assert params["tenant_id"] == f"eq.{TENANT}"


def test_members_tolerate_an_invisible_profile() -> None:
    repo, _ = repo_with(
        lambda r: json_response([{"user_id": str(USER), "role": "viewer", "users": None}])
    )
    members = repo.list_members(USER_TOKEN, TENANT).members
    assert members[0].display_name is None


def _event(i: int) -> dict[str, Any]:
    return {
        "id": i,
        "actor_user_id": None,
        "actor_type": "system",
        "action": "tenant.update",
        "entity_type": "tenant",
        "entity_id": str(TENANT),
        "old_values": {"name": "a"},
        "new_values": {"name": "b"},
        "request_id": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    }


def test_audit_pagination_uses_a_lookahead_row() -> None:
    repo, seen = repo_with(lambda r: json_response([_event(9), _event(8), _event(7)]))
    page = repo.list_audit_events(USER_TOKEN, TENANT, limit=2, before_id=10)
    assert [e.id for e in page.events] == [9, 8]
    assert page.next_before_id == 8
    assert seen[0].url.params["limit"] == "3"
    assert seen[0].url.params["id"] == "lt.10"
    last = repo.list_audit_events(USER_TOKEN, TENANT, limit=5, before_id=None)
    assert last.next_before_id is None


def test_create_tenant_posts_the_rpc_arguments() -> None:
    row = {
        "id": str(TENANT),
        "name": "Acme",
        "slug": "acme-silks",
        "created_at": "x",
        "updated_at": "x",
    }
    repo, seen = repo_with(lambda r: json_response(row))
    tenant = repo.create_tenant(USER_TOKEN, "Acme", "acme-silks")
    assert tenant.slug == "acme-silks"
    assert seen[0].url.path.endswith("/rpc/create_tenant")
    assert json.loads(seen[0].content) == {"p_name": "Acme", "p_slug": "acme-silks"}


def test_get_plan_reads_three_columns_of_one_tenant_with_the_callers_token() -> None:
    row = {
        "plan": "free_trial",
        "workspace_limit": 1,
        "trial_started_at": "2026-10-01T09:00:00+00:00",
    }
    repo, seen = repo_with(lambda r: json_response([row]))
    plan = repo.get_plan(USER_TOKEN, TENANT)
    assert (plan.plan, plan.workspace_limit) == ("free_trial", 1)
    assert plan.trial_started_at.year == 2026
    assert seen[0].url.path.endswith("/tenants")
    assert dict(seen[0].url.params) == {
        "select": "plan,workspace_limit,trial_started_at",
        "id": f"eq.{TENANT}",
        "limit": "1",
    }
    assert seen[0].headers["authorization"] == f"Bearer {USER_TOKEN}"


def test_get_plan_of_a_tenant_the_caller_cannot_see_is_a_refusal_not_a_crash() -> None:
    repo, _ = repo_with(lambda r: json_response([]))
    with pytest.raises(Forbidden):
        repo.get_plan(USER_TOKEN, TENANT)


@pytest.mark.parametrize(
    ("status", "code", "expected"),
    [
        (409, "23505", SlugUnavailable),
        (400, "22023", InvalidInput),
        (400, "23514", InvalidInput),
        (403, "42501", Forbidden),
        (401, "PGRST303", TokenRejected),
        (401, "PGRST301", TokenRejected),
        (400, "SM307", WorkspaceLimitReached),
        (400, "SM308", TermsNotAccepted),
        (400, "SM309", EmailNotConfirmed),
        (500, "XX000", UpstreamError),
        (404, "PGRST202", UpstreamError),
        (406, "PGRST106", UpstreamError),
    ],
)
def test_postgrest_errors_are_mapped(status: int, code: str, expected: type[Exception]) -> None:
    repo, _ = repo_with(lambda r: json_response({"code": code, "message": "internal text"}, status))
    with pytest.raises(expected):
        repo.create_tenant(USER_TOKEN, "Acme", "acme-silks")


def test_non_json_error_body_is_an_upstream_error() -> None:
    repo, _ = repo_with(lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    with pytest.raises(UpstreamError):
        repo.get_me(USER_TOKEN, USER)


def test_network_failure_is_an_upstream_error_without_leaking_details() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused to 10.0.0.5")

    repo, _ = repo_with(boom)
    with pytest.raises(UpstreamError) as info:
        repo.get_me(USER_TOKEN, USER)
    assert "10.0.0.5" not in str(info.value)


def test_get_account_setup_posts_an_empty_body_to_the_rpc_with_the_callers_token() -> None:
    reply = {"state": "needed", "tenant_id": None, "business_name": "Sri Lakshmi Silks"}
    repo, seen = repo_with(lambda r: json_response(reply))
    out = repo.get_account_setup(USER_TOKEN)
    assert (out.state, out.business_name, out.tenant_id) == ("needed", "Sri Lakshmi Silks", None)
    assert seen[0].method == "POST" and seen[0].url.path.endswith("/rpc/get_account_setup")
    assert json.loads(seen[0].content) == {}
    assert seen[0].headers["authorization"] == f"Bearer {USER_TOKEN}"


def test_complete_setup_sends_only_the_two_choices() -> None:
    repo, seen = repo_with(lambda r: json_response({"tenant_id": str(TENANT), "created": True}))
    out = repo.complete_setup(USER_TOKEN, "textiles", "te")
    assert (out.tenant_id, out.created) == (TENANT, True)
    assert seen[0].url.path.endswith("/rpc/complete_setup")
    assert json.loads(seen[0].content) == {"p_business_type": "textiles", "p_language": "te"}
    assert seen[0].headers["authorization"] == f"Bearer {USER_TOKEN}"
