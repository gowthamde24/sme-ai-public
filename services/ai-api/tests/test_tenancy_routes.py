"""HTTP behaviour: authentication, tenant isolation (404 not 403), role gates, structured output."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.tenancy import repository as repo
from tests.fakes import TENANT_A, TENANT_B, USERS, auth, make_client
from tests.keys import claims, mint

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[3] / "packages" / "contracts" / "tenancy.schema.json"
    ).read_text()
)


def validate(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


# ----------------------------------------------------------------------- authentication
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": ""},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Bearer not.a.jwt"},
        {"Authorization": "Token abc"},
    ],
)
def test_missing_or_garbage_credentials_get_401(headers: dict[str, str]) -> None:
    client, _ = make_client()
    for path in ("/v1/me", f"/v1/tenants/{TENANT_A.id}", f"/v1/tenants/{TENANT_A.id}/members"):
        response = client.get(path, headers=headers)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        validate(response.json(), "Error")
        assert response.json()["error"]["code"] == "unauthorized"


def test_401_never_reveals_why_or_echoes_the_token() -> None:
    client, _ = make_client()
    token = "Bearer " + mint(__import__("tests.fakes").fakes.KEY, claims(exp=1, iat=0))
    response = client.get("/v1/me", headers={"Authorization": token})
    assert response.status_code == 401
    assert "expir" not in response.text.lower()
    assert token.split(" ")[1] not in response.text


def test_expired_token_is_401() -> None:
    client, _ = make_client()
    assert client.get("/v1/me", headers=auth("a_owner", exp=1, iat=0)).status_code == 401


def test_non_user_tokens_are_401() -> None:
    client, _ = make_client()
    for role in ("anon", "service_role"):
        assert client.get("/v1/me", headers=auth("a_owner", role=role)).status_code == 401


def test_every_v1_route_requires_authentication() -> None:
    client, _ = make_client()
    unauthenticated = [
        ("GET", "/v1/me"),
        ("POST", "/v1/tenants"),
        ("GET", f"/v1/tenants/{TENANT_A.id}"),
        ("GET", f"/v1/tenants/{TENANT_A.id}/members"),
        ("GET", f"/v1/tenants/{TENANT_A.id}/audit-events"),
    ]
    for method, path in unauthenticated:
        assert client.request(method, path).status_code == 401, (method, path)


def test_identity_comes_only_from_the_verified_token() -> None:
    """Spoofed headers/params naming another user or tenant must change nothing."""
    client, fake = make_client()
    spoof = {
        **auth("a_viewer"),
        "X-User-Id": str(USERS["a_owner"]),
        "X-Tenant-Id": str(TENANT_A.id),
    }
    response = client.get(
        f"/v1/tenants/{TENANT_B.id}", headers=spoof, params={"user_id": USERS["b_owner"]}
    )
    assert response.status_code == 404
    assert fake.membership_lookups == [(USERS["a_viewer"], TENANT_B.id)]


def test_data_layer_receives_the_callers_own_token_and_nothing_else() -> None:
    client, fake = make_client()
    headers = auth("a_owner")
    client.get("/v1/me", headers=headers)
    client.get(f"/v1/tenants/{TENANT_A.id}/members", headers=headers)
    assert set(fake.tokens_seen) == {headers["Authorization"].removeprefix("Bearer ")}


# ----------------------------------------------------------------------- /v1/me
def test_me_lists_only_own_memberships_and_matches_contract() -> None:
    client, _ = make_client()
    body = client.get("/v1/me", headers=auth("a_admin")).json()
    validate(body, "Me")
    assert body["user_id"] == str(USERS["a_admin"])
    assert [(m["tenant"]["slug"], m["role"]) for m in body["memberships"]] == [
        ("tenant-a", "admin")
    ]


def test_user_without_tenant_gets_an_empty_list() -> None:
    client, _ = make_client()
    body = client.get("/v1/me", headers=auth("outsider")).json()
    validate(body, "Me")
    assert body["memberships"] == []


# ------------------------------------------------------------- tenant isolation: 404 not 403
def test_foreign_unknown_and_malformed_tenants_are_indistinguishable() -> None:
    client, _ = make_client()
    headers = auth("a_owner")
    responses = [
        client.get(f"/v1/tenants/{TENANT_B.id}", headers=headers),  # exists, not theirs
        client.get(f"/v1/tenants/{uuid.uuid4()}", headers=headers),  # does not exist
        client.get("/v1/tenants/not-a-uuid", headers=headers),  # malformed
    ]
    for response in responses:
        assert response.status_code == 404
        validate(response.json(), "Error")
    assert len({r.text for r in responses}) == 1, "bodies must be identical so nothing leaks"


@pytest.mark.parametrize("suffix", ["", "/members", "/audit-events"])
def test_foreign_tenant_is_404_on_every_tenant_route_for_every_role(suffix: str) -> None:
    client, _ = make_client()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer", "outsider"):
        response = client.get(f"/v1/tenants/{TENANT_B.id}{suffix}", headers=auth(user))
        assert response.status_code == 404, (user, suffix)


def test_member_can_read_own_tenant() -> None:
    client, _ = make_client()
    body = client.get(f"/v1/tenants/{TENANT_A.id}", headers=auth("a_viewer")).json()
    validate(body, "TenantDetail")
    assert (body["slug"], body["role"]) == ("tenant-a", "viewer")


def test_members_visible_to_any_member_and_matches_contract() -> None:
    client, _ = make_client()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        response = client.get(f"/v1/tenants/{TENANT_A.id}/members", headers=auth(user))
        assert response.status_code == 200, user
        validate(response.json(), "MemberList")
        assert len(response.json()["members"]) == 4


# ----------------------------------------------------------------------- role gates
@pytest.mark.parametrize(
    ("user", "status"),
    [("a_owner", 200), ("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404)],
)
def test_audit_events_are_owner_and_admin_only(user: str, status: int) -> None:
    client, _ = make_client()
    response = client.get(f"/v1/tenants/{TENANT_A.id}/audit-events", headers=auth(user))
    assert response.status_code == status
    if status == 200:
        validate(response.json(), "AuditEventList")
    else:
        validate(response.json(), "Error")


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"before_id": 0}, {"limit": "x"}])
def test_audit_pagination_params_are_validated(params: dict[str, Any]) -> None:
    client, _ = make_client()
    response = client.get(
        f"/v1/tenants/{TENANT_A.id}/audit-events", headers=auth("a_owner"), params=params
    )
    assert response.status_code == 422
    validate(response.json(), "Error")


# ----------------------------------------------------------------------- create tenant
def test_create_tenant_is_idempotent_for_retries() -> None:
    client, _ = make_client()
    body = {"name": "Acme Silks", "slug": "acme-silks"}
    first = client.post("/v1/tenants", json=body, headers=auth("outsider"))
    second = client.post("/v1/tenants", json=body, headers=auth("outsider"))
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    validate(first.json(), "TenantDetail")
    assert first.json()["role"] == "owner"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": "", "slug": "acme-silks"},
        {"name": "   ", "slug": "acme-silks"},
        {"name": "x" * 121, "slug": "acme-silks"},
        {"name": "Acme", "slug": "Bad Slug!"},
        {"name": "Acme", "slug": "ab"},
        {"name": "Acme", "slug": "a" * 41},
        {"name": "Acme", "slug": "-leading-hyphen"},
        {"name": "Acme", "slug": "acme-silks", "role": "owner"},  # unknown fields refused
        {"name": None, "slug": "acme-silks"},
    ],
)
def test_create_tenant_validates_input_without_echoing_it(body: dict[str, Any]) -> None:
    client, fake = make_client()
    response = client.post("/v1/tenants", json=body, headers=auth("outsider"))
    assert response.status_code == 422
    validate(response.json(), "Error")
    assert response.json()["error"]["code"] == "validation_error"
    if body.get("slug") == "Bad Slug!":
        assert "Bad Slug" not in response.text
    assert fake.created == {}


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (repo.SlugUnavailable("23505"), 409, "slug_unavailable"),
        (repo.Forbidden("42501"), 403, "forbidden"),
        (repo.InvalidInput("22023"), 422, "validation_error"),
        (repo.TokenRejected("PGRST303"), 401, "unauthorized"),
        (repo.UpstreamError("secret internal detail"), 502, "upstream_error"),
    ],
)
def test_data_layer_errors_map_to_safe_responses(
    error: repo.RepositoryError, status: int, code: str
) -> None:
    client, fake = make_client()
    fake.raise_on_next = error
    response = client.post(
        "/v1/tenants", json={"name": "Acme", "slug": "acme-silks"}, headers=auth("outsider")
    )
    assert response.status_code == status
    validate(response.json(), "Error")
    assert response.json()["error"]["code"] == code
    assert "secret internal detail" not in response.text


def test_unknown_route_uses_the_error_shape() -> None:
    client, _ = make_client()
    response = client.get("/v1/nope")
    assert response.status_code == 404
    validate(response.json(), "Error")


def test_health_is_public() -> None:
    client, _ = make_client()
    assert client.get("/health").status_code == 200
