"""API -> PostgREST -> Postgres with real users and real JWTs. Tenant A vs Tenant B, end to end."""

from __future__ import annotations

import base64
import json
import time
import uuid
from typing import Any

import httpx
import jwt
import pytest
from conftest import Stack, User, bearer, unique_slug
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def world(client: TestClient, signup: Any) -> dict[str, Any]:
    alice, bob, carol = signup("alice"), signup("bob"), signup("carol")
    slug_a, slug_b = unique_slug("it-a"), unique_slug("it-b")
    a = client.post("/v1/tenants", json={"name": "Tenant A", "slug": slug_a}, headers=bearer(alice))
    b = client.post("/v1/tenants", json={"name": "Tenant B", "slug": slug_b}, headers=bearer(bob))
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    return {
        "alice": alice,
        "bob": bob,
        "carol": carol,
        "a": a.json(),
        "b": b.json(),
        "slug_a": slug_a,
        "slug_b": slug_b,
    }


def rest(stack: Stack, method: str, path: str, user: User | None, **kwargs: Any) -> httpx.Response:
    headers = stack.headers(user.token if user else None, **kwargs.pop("extra", {}))
    return httpx.request(method, f"{stack.rest}{path}", headers=headers, timeout=15, **kwargs)


# ------------------------------------------------------------------------------- identity
def test_me_shows_only_own_memberships(client: TestClient, world: dict[str, Any]) -> None:
    alice = client.get("/v1/me", headers=bearer(world["alice"])).json()
    assert alice["user_id"] == str(world["alice"].id)
    assert [(m["tenant"]["id"], m["role"]) for m in alice["memberships"]] == [
        (world["a"]["id"], "owner")
    ]
    assert client.get("/v1/me", headers=bearer(world["carol"])).json()["memberships"] == []


def test_forged_tokens_are_rejected_by_the_real_stack(
    client: TestClient, stack: Stack, world: dict[str, Any]
) -> None:
    now = int(time.time())
    issuer = f"{stack.url}/auth/v1"
    payload = {
        "iss": issuer,
        "aud": "authenticated",
        "sub": str(world["alice"].id),
        "role": "authenticated",
        "iat": now,
        "exp": now + 600,
    }
    attacker = ec.generate_private_key(ec.SECP256R1())
    real_kid = jwt.get_unverified_header(world["alice"].token)["kid"]
    for kid in (real_kid, "unknown-kid"):  # right kid + wrong signature, and unknown kid
        forged = jwt.encode(payload, attacker, algorithm="ES256", headers={"kid": kid})
        response = client.get("/v1/me", headers={"Authorization": f"Bearer {forged}"})
        assert response.status_code == 401, kid
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(
        b"="
    )
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=")
    unsigned = f"{header.decode()}.{body.decode()}."
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {unsigned}"}).status_code == 401


def test_anon_key_is_not_a_user_token(client: TestClient, stack: Stack) -> None:
    response = client.get("/v1/me", headers={"Authorization": f"Bearer {stack.anon_key}"})
    assert response.status_code == 401


# ---------------------------------------------------------------------- tenant isolation
def test_a_cannot_see_b_through_the_api_and_vice_versa(
    client: TestClient, world: dict[str, Any]
) -> None:
    a_id, b_id = world["a"]["id"], world["b"]["id"]
    ghost = str(uuid.uuid4())
    for suffix in ("", "/members", "/audit-events"):
        denied = [
            client.get(f"/v1/tenants/{b_id}{suffix}", headers=bearer(world["alice"])),
            client.get(f"/v1/tenants/{a_id}{suffix}", headers=bearer(world["bob"])),
            client.get(f"/v1/tenants/{a_id}{suffix}", headers=bearer(world["carol"])),
            client.get(f"/v1/tenants/{ghost}{suffix}", headers=bearer(world["alice"])),
        ]
        assert {r.status_code for r in denied} == {404}, suffix
        assert len({r.text for r in denied}) == 1, "foreign and unknown must look identical"
    assert client.get(f"/v1/tenants/{a_id}", headers=bearer(world["alice"])).status_code == 200
    assert client.get(f"/v1/tenants/{b_id}", headers=bearer(world["bob"])).status_code == 200


def test_slug_belonging_to_another_tenant_is_409_and_grants_nothing(
    client: TestClient, world: dict[str, Any]
) -> None:
    response = client.post(
        "/v1/tenants",
        json={"name": "Mine now", "slug": world["slug_a"]},
        headers=bearer(world["bob"]),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "slug_unavailable"
    me = client.get("/v1/me", headers=bearer(world["bob"])).json()
    assert [m["tenant"]["id"] for m in me["memberships"]] == [world["b"]["id"]]


def test_create_tenant_retry_is_idempotent_with_one_audit_trail(
    client: TestClient, world: dict[str, Any]
) -> None:
    again = client.post(
        "/v1/tenants",
        json={"name": "Different", "slug": world["slug_a"]},
        headers=bearer(world["alice"]),
    )
    assert again.status_code == 200
    assert again.json()["id"] == world["a"]["id"]
    assert again.json()["name"] == "Tenant A"
    events = client.get(
        f"/v1/tenants/{world['a']['id']}/audit-events", headers=bearer(world["alice"])
    )
    actions = [e["action"] for e in events.json()["events"]]
    assert actions.count("tenant.create") == 1
    assert actions.count("membership.create") == 1


def test_audit_trail_records_actor_and_before_after(
    client: TestClient, world: dict[str, Any]
) -> None:
    events = client.get(
        f"/v1/tenants/{world['a']['id']}/audit-events", headers=bearer(world["alice"])
    ).json()["events"]
    created = next(e for e in events if e["action"] == "membership.create")
    assert created["actor_user_id"] == str(world["alice"].id)
    assert created["actor_type"] == "user"
    assert created["old_values"] is None
    assert created["new_values"]["role"] == "owner"


# ------------------------------------------------------- roles + immediate revocation
def test_roles_gate_the_audit_trail_and_revocation_is_immediate(
    client: TestClient, stack: Stack, world: dict[str, Any], signup: Any
) -> None:
    alice, a_id = world["alice"], world["a"]["id"]
    dave, erin = signup("dave"), signup("erin")
    for user, role in ((dave, "viewer"), (erin, "admin")):
        added = rest(
            stack,
            "POST",
            "/memberships",
            alice,
            json={"tenant_id": a_id, "user_id": str(user.id), "role": role},
        )
        assert added.status_code == 201, added.text

    assert client.get(f"/v1/tenants/{a_id}/members", headers=bearer(dave)).status_code == 200
    assert client.get(f"/v1/tenants/{a_id}/audit-events", headers=bearer(dave)).status_code == 403
    assert client.get(f"/v1/tenants/{a_id}/audit-events", headers=bearer(erin)).status_code == 200
    members = client.get(f"/v1/tenants/{a_id}/members", headers=bearer(alice)).json()["members"]
    assert {m["role"] for m in members} == {"owner", "viewer", "admin"}

    # Remove dave. His token is still cryptographically valid for ~1h, but the database no longer
    # lists him, so the very next request is a 404. Roles are never trusted from the token.
    removed = rest(
        stack,
        "DELETE",
        f"/memberships?tenant_id=eq.{a_id}&user_id=eq.{dave.id}",
        alice,
        extra={"Prefer": "return=representation"},
    )
    assert removed.status_code == 200 and len(removed.json()) == 1
    assert client.get(f"/v1/tenants/{a_id}", headers=bearer(dave)).status_code == 404


# --------------------------------------------- RLS holds even if the API were bypassed
def test_postgrest_enforces_isolation_directly(stack: Stack, world: dict[str, Any]) -> None:
    alice, bob = world["alice"], world["bob"]
    b_id = world["b"]["id"]

    visible = rest(stack, "GET", "/tenants?select=id", alice).json()
    assert [t["id"] for t in visible] == [world["a"]["id"]]
    assert rest(stack, "GET", f"/memberships?tenant_id=eq.{b_id}", alice).json() == []
    assert rest(stack, "GET", f"/audit_events?tenant_id=eq.{b_id}", alice).json() == []

    forged = rest(
        stack,
        "POST",
        "/memberships",
        alice,
        json={"tenant_id": b_id, "user_id": str(alice.id), "role": "owner"},
    )
    assert forged.status_code in (401, 403), forged.text
    assert forged.json()["code"] == "42501"

    for method, path, body in (
        ("PATCH", f"/tenants?id=eq.{b_id}", {"name": "pwned"}),
        ("PATCH", f"/memberships?tenant_id=eq.{b_id}", {"role": "viewer"}),
        ("DELETE", f"/memberships?tenant_id=eq.{b_id}", None),
    ):
        response = rest(
            stack, method, path, alice, json=body, extra={"Prefer": "return=representation"}
        )
        assert response.status_code == 200 and response.json() == [], (method, path)

    assert rest(stack, "GET", f"/tenants?id=eq.{b_id}&select=name", bob).json() == [
        {"name": "Tenant B"}
    ]


def test_anon_key_alone_reads_nothing(stack: Stack, world: dict[str, Any]) -> None:
    for table in ("tenants", "memberships", "users", "audit_events"):
        response = rest(stack, "GET", f"/{table}", None)
        assert response.status_code in (401, 403), (table, response.status_code)
        assert response.json()["code"] == "42501"
    rpc = rest(stack, "POST", "/rpc/create_tenant", None, json={"p_name": "x", "p_slug": "anon-co"})
    assert rpc.status_code in (401, 403)


def test_audit_events_cannot_be_written_or_altered_through_the_api(
    stack: Stack, world: dict[str, Any]
) -> None:
    alice, a_id = world["alice"], world["a"]["id"]
    forged = rest(
        stack,
        "POST",
        "/audit_events",
        alice,
        json={"tenant_id": a_id, "actor_type": "user", "action": "forged", "entity_type": "x"},
    )
    assert forged.status_code in (401, 403)
    for method in ("PATCH", "DELETE"):
        response = rest(
            stack, method, f"/audit_events?tenant_id=eq.{a_id}", alice, json={"action": "x"}
        )
        assert response.status_code in (401, 403), method
    assert (
        rest(stack, "GET", f"/audit_events?tenant_id=eq.{a_id}&action=eq.forged", alice).json()
        == []
    )
