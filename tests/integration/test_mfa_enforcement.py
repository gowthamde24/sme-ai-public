"""ADR 0016 against the real stack: a password-only (aal1) Owner or Admin is refused the privileged
actions, a second-factor (aal2) one is allowed, Sales is never asked. Tokens come from the real Auth
server (TOTP enrolled and answered through its API). The database and the API are attacked
separately: straight through PostgREST (the erasure functions, the agents switch, memberships, the
workspace row) and through our API (exports, the ICP profile, the agents switch, erasure)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import base64
import dataclasses
import json
from pathlib import Path
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import Stack, User, aal1_token, aal2_token, bearer, challenge_verify, enroll_totp
from crm_support import World
from evidence_support import code_of, pg, uid
from fastapi.testclient import TestClient

TEMPLATE = json.loads(
    (Path(__file__).resolve().parents[2] / "config" / "icp" / "silk-wholesale.v1.json").read_text(
        encoding="utf-8"
    )
)
GENERIC = "erasure action not permitted"
MFA_MESSAGE = "a second factor is required for this action"


@pytest.fixture(scope="module")
def w(client: TestClient, stack: Stack, signup: Any) -> World:
    return World(client, stack, signup)


def at(stack: Stack, user: User, level: str) -> User:
    """The same person at a given assurance level: a password-only or a second-factor session."""
    token = aal1_token(stack, user) if level == "aal1" else aal2_token(stack, user)
    return dataclasses.replace(user, token=token)


def rpc(w: World, user: User, name: str, **args: Any) -> httpx.Response:
    return pg(w.stack, user, "POST", f"/rpc/{name}", json=args)


def is_mfa(r: httpx.Response) -> bool:
    return (
        r.status_code in (400, 403)
        and code_of(r) == "SM306"
        and r.json().get("message") == MFA_MESSAGE
    )


def is_generic(r: httpx.Response) -> bool:
    return (
        r.status_code in (401, 403) and code_of(r) == "42501" and r.json().get("message") == GENERIC
    )


def api_is_mfa(r: httpx.Response) -> bool:
    return r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"


def level(token: str) -> str:
    payload = token.split(".")[1]
    return str(json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["aal"])


def authed(stack: Stack, token: str) -> dict[str, str]:
    return {"apikey": stack.anon_key, "Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------------------ the tokens themselves
def test_the_two_sessions_carry_the_two_levels(w: World) -> None:
    owner = w.a.users["owner"]
    assert level(owner.token) == "aal2"
    assert level(aal1_token(w.stack, owner)) == "aal1"
    assert level(aal2_token(w.stack, owner)) == "aal2"


# ------------------------------------------------------------------------------ the database, straight through PostgREST
def test_erasure_functions_refuse_a_password_only_session(w: World) -> None:
    a = w.a
    owner1, admin1 = at(w.stack, a.users["owner"], "aal1"), at(w.stack, a.users["admin"], "aal1")
    owner2, admin2 = a.users["owner"], a.users["admin"]
    rid = uid()
    ask = {
        "p_request_id": rid,
        "p_tenant_id": a.id,
        "p_scope": "contact",
        "p_subject_id": a.rows["contacts"]["id"],
    }
    for user in (owner1, admin1):
        assert is_mfa(rpc(w, user, "request_erasure", **ask)), user.label
    assert pg(w.stack, owner2, "GET", f"/erasure_requests?id=eq.{rid}").json() == []
    assert rpc(w, admin2, "request_erasure", **ask).status_code == 200
    for dry in (True, False):
        assert is_mfa(rpc(w, owner1, "execute_erasure", p_request_id=rid, p_dry_run=dry)), dry
    assert is_mfa(rpc(w, admin1, "cancel_erasure", p_request_id=rid))
    status = pg(w.stack, owner2, "GET", f"/erasure_requests?id=eq.{rid}&select=status").json()[0][
        "status"
    ]
    assert status == "pending"
    assert rpc(w, owner2, "execute_erasure", p_request_id=rid, p_dry_run=True).status_code == 200
    assert rpc(w, admin2, "cancel_erasure", p_request_id=rid).status_code == 200
    # a replay of the (cancelled) request is refused at aal1 too: nothing stored goes to a password-only session
    assert is_mfa(rpc(w, owner1, "request_erasure", **ask))


def test_the_session_level_is_no_oracle_for_strangers_and_wrong_roles(w: World) -> None:
    a, b = w.a, w.b
    rid = uid()
    ask = {"p_request_id": rid, "p_tenant_id": a.id, "p_scope": "tenant"}
    assert rpc(w, a.users["owner"], "request_erasure", **ask).status_code == 200
    sales1 = at(w.stack, a.users["sales"], "aal1")
    foreign1 = at(w.stack, b.users["owner"], "aal1")
    admin1 = at(w.stack, a.users["admin"], "aal1")
    bodies = set()
    for user, name, args in (
        (
            sales1,
            "request_erasure",
            {"p_request_id": uid(), "p_tenant_id": a.id, "p_scope": "tenant"},
        ),
        (
            foreign1,
            "request_erasure",
            {"p_request_id": uid(), "p_tenant_id": a.id, "p_scope": "tenant"},
        ),
        (sales1, "execute_erasure", {"p_request_id": rid, "p_dry_run": False}),
        (foreign1, "execute_erasure", {"p_request_id": rid, "p_dry_run": False}),
        (
            admin1,
            "execute_erasure",
            {"p_request_id": rid, "p_dry_run": False},
        ),  # an Admin is not the Owner
        (sales1, "cancel_erasure", {"p_request_id": rid}),
        (foreign1, "cancel_erasure", {"p_request_id": rid}),
    ):
        r = rpc(w, user, name, **args)
        assert is_generic(r), (user.label, name, r.status_code, r.text)
        bodies.add(json.dumps(r.json(), sort_keys=True))
    assert len(bodies) == 1, "wrong role and foreign tenant look the same at aal1"
    rpc(w, a.users["owner"], "cancel_erasure", p_request_id=rid)


def test_the_agents_switch_needs_a_second_factor_in_the_database(w: World) -> None:
    a = w.a
    for who in ("owner", "admin"):
        r = rpc(
            w,
            at(w.stack, a.users[who], "aal1"),
            "set_tenant_agents_enabled",
            p_tenant_id=a.id,
            p_enabled=True,
        )
        assert is_mfa(r), who
    sales = rpc(
        w,
        at(w.stack, a.users["sales"], "aal1"),
        "set_tenant_agents_enabled",
        p_tenant_id=a.id,
        p_enabled=True,
    )
    assert (
        sales.status_code in (401, 403) and sales.json()["message"] == "agent action not permitted"
    )
    state = pg(
        w.stack,
        a.users["owner"],
        "GET",
        f"/tenant_agent_settings?tenant_id=eq.{a.id}&select=enabled",
    ).json()
    assert state in ([], [{"enabled": False}])
    assert (
        rpc(
            w, a.users["admin"], "set_tenant_agents_enabled", p_tenant_id=a.id, p_enabled=False
        ).status_code
        == 200
    )


def test_memberships_and_the_workspace_row_need_a_second_factor_in_the_database(
    w: World, signup: Any
) -> None:
    a = w.a
    newcomer: User = signup("mfa-newcomer", mfa=False)
    owner1, admin1 = at(w.stack, a.users["owner"], "aal1"), at(w.stack, a.users["admin"], "aal1")
    add = {"tenant_id": a.id, "user_id": str(newcomer.id), "role": "viewer"}
    for user in (owner1, admin1):
        r = pg(w.stack, user, "POST", "/memberships", json=add, representation=False)
        assert is_mfa(r), (user.label, r.text)
    assert (
        pg(
            w.stack, a.users["owner"], "GET", f"/memberships?user_id=eq.{newcomer.id}&select=role"
        ).json()
        == []
    )
    sales_id = a.users["sales"].id
    where = f"tenant_id=eq.{a.id}&user_id=eq.{sales_id}"
    assert is_mfa(
        pg(
            w.stack,
            owner1,
            "PATCH",
            f"/memberships?{where}",
            json={"role": "admin"},
            representation=False,
        )
    )
    assert is_mfa(pg(w.stack, admin1, "DELETE", f"/memberships?{where}", representation=False))
    held = pg(w.stack, a.users["owner"], "GET", f"/memberships?{where}&select=role").json()
    assert held == [{"role": "sales"}]
    r = pg(
        w.stack,
        owner1,
        "PATCH",
        f"/tenants?id=eq.{a.id}",
        json={"name": "Renamed At Aal1"},
        representation=False,
    )
    assert is_mfa(r), r.text
    name = pg(w.stack, a.users["owner"], "GET", f"/tenants?id=eq.{a.id}&select=name").json()[0][
        "name"
    ]
    assert name != "Renamed At Aal1"
    # with a second factor all of it works
    owner2 = a.users["owner"]
    ok = (200, 201, 204)
    assert (
        pg(w.stack, owner2, "POST", "/memberships", json=add, representation=False).status_code
        in ok
    )
    patch = pg(
        w.stack,
        owner2,
        "PATCH",
        f"/memberships?tenant_id=eq.{a.id}&user_id=eq.{newcomer.id}",
        json={"role": "sales"},
        representation=False,
    )
    assert patch.status_code in ok
    delete = pg(
        w.stack,
        owner2,
        "DELETE",
        f"/memberships?tenant_id=eq.{a.id}&user_id=eq.{newcomer.id}",
        representation=False,
    )
    assert delete.status_code in ok
    assert (
        pg(
            w.stack,
            owner2,
            "PATCH",
            f"/tenants?id=eq.{a.id}",
            json={"name": name},
            representation=False,
        ).status_code
        in ok
    )


def test_sales_is_unaffected_and_an_owner_at_aal1_still_does_ordinary_work(w: World) -> None:
    a = w.a
    sales1 = at(w.stack, a.users["sales"], "aal1")
    owner1 = at(w.stack, a.users["owner"], "aal1")
    for user in (sales1, owner1):
        r = w.client.post(
            f"/v1/tenants/{a.id}/companies",
            json={"id": uid(), "name": f"DEMO Aal1 {user.label}"},
            headers=bearer(user),
        )
        assert r.status_code == 201, (user.label, r.text)
        assert w.client.get(f"/v1/tenants/{a.id}/leads", headers=bearer(user)).status_code == 200
    where = f"tenant_id=eq.{a.id}&user_id=eq.{a.users['sales'].id}"
    r = pg(
        w.stack,
        sales1,
        "PATCH",
        f"/memberships?{where}",
        json={"role": "admin"},
        representation=False,
    )
    assert not is_mfa(r), "Sales is filtered out by the role policy, not asked for a factor"
    assert pg(w.stack, a.users["owner"], "GET", f"/memberships?{where}&select=role").json() == [
        {"role": "sales"}
    ]


# ------------------------------------------------------------------------------ through our API
def test_the_api_refuses_a_password_only_owner_or_admin_and_allows_a_second_factor(
    w: World,
) -> None:
    a = w.a
    base = f"/v1/tenants/{a.id}"
    actions = [
        ("POST", "/exports", {"kind": "lead_labels", "format": "csv"}),
        ("POST", "/icp-configs", {"config": TEMPLATE}),
        ("PUT", "/agent-settings", {"enabled": False}),
        ("POST", "/erasure-requests", {"id": uid(), "scope": "tenant"}),
    ]
    for who in ("owner", "admin"):
        weak = at(w.stack, a.users[who], "aal1")
        for method, path, body in actions:
            r = w.client.request(method, base + path, json=body, headers=bearer(weak))
            assert api_is_mfa(r), (who, path, r.status_code, r.text)
        for method, path, body in actions:
            body = {**body, "id": uid()} if path == "/erasure-requests" else body
            r = w.client.request(method, base + path, json=body, headers=bearer(a.users[who]))
            assert r.status_code < 400, (who, path, r.status_code, r.text)
    weak_owner = at(w.stack, a.users["owner"], "aal1")
    assert w.client.get(base + "/erasure-requests", headers=bearer(weak_owner)).status_code == 200
    assert w.client.get(base + "/data-policy", headers=bearer(weak_owner)).status_code == 200
    sales_weak = at(w.stack, a.users["sales"], "aal1")
    r = w.client.post(base + "/exports", json=actions[0][2], headers=bearer(sales_weak))
    assert r.json()["error"]["code"] == "forbidden"
    foreign_weak = at(w.stack, w.b.users["owner"], "aal1")
    assert (
        w.client.post(
            base + "/exports", json=actions[0][2], headers=bearer(foreign_weak)
        ).status_code
        == 404
    )


# ------------------------------------------------------------------------------ no authenticator; unenrol; the operator reset
def test_no_enrolment_no_action_then_enrolled_and_allowed(w: World, signup: Any) -> None:
    owner: User = signup("mfa-lone-owner", mfa=False)
    made = w.client.post(
        "/v1/tenants", json={"name": "Lone", "slug": f"lone-{uid()[:8]}"}, headers=bearer(owner)
    )
    assert made.status_code == 200, (
        "creating a workspace is the trusted role's job: no factor needed yet"
    )
    tenant = made.json()["id"]
    base = f"/v1/tenants/{tenant}"
    assert api_is_mfa(
        w.client.put(base + "/agent-settings", json={"enabled": False}, headers=bearer(owner))
    )
    assert is_mfa(
        pg(
            w.stack,
            owner,
            "PATCH",
            f"/tenants?id=eq.{tenant}",
            json={"name": "Lone 2"},
            representation=False,
        )
    )
    factor_id, secret = enroll_totp(w.stack, owner.token)
    done = challenge_verify(w.stack, owner.token, factor_id, secret)
    assert done.status_code == 200
    upgraded = dataclasses.replace(owner, token=done.json()["access_token"])
    assert level(upgraded.token) == "aal2"
    assert (
        w.client.put(
            base + "/agent-settings", json={"enabled": False}, headers=bearer(upgraded)
        ).status_code
        == 200
    )
    # a wrong code upgrades nothing
    factor2, _ = enroll_totp(w.stack, owner.token)
    challenge = httpx.post(
        f"{w.stack.url}/auth/v1/factors/{factor2}/challenge",
        headers=authed(w.stack, owner.token),
        json={},
        timeout=15,
    )
    wrong = httpx.post(
        f"{w.stack.url}/auth/v1/factors/{factor2}/verify",
        headers=authed(w.stack, owner.token),
        json={"challenge_id": challenge.json()["id"], "code": "000000"},
        timeout=15,
    )
    assert wrong.status_code in (400, 422)


def test_a_verified_factor_cannot_be_removed_by_a_password_only_session(
    w: World, signup: Any
) -> None:
    person: User = signup("mfa-unenrol")
    weak = aal1_token(w.stack, person)
    factors = httpx.get(
        f"{w.stack.url}/auth/v1/user", headers=authed(w.stack, weak), timeout=15
    ).json()["factors"]
    factor_id = next(f["id"] for f in factors if f["status"] == "verified")
    refused = httpx.delete(
        f"{w.stack.url}/auth/v1/factors/{factor_id}", headers=authed(w.stack, weak), timeout=15
    )
    assert refused.status_code in (400, 401, 403, 422), (
        "the Auth server itself demands aal2 to remove a verified factor"
    )
    strong = aal2_token(w.stack, person)
    removed = httpx.delete(
        f"{w.stack.url}/auth/v1/factors/{factor_id}", headers=authed(w.stack, strong), timeout=15
    )
    assert removed.status_code == 200


def test_the_operator_reset_removes_the_factor_and_ends_every_session(
    w: World, signup: Any
) -> None:
    person: User = signup("mfa-lost-device")
    creds = {"email": person.email, "password": person.password}
    session = httpx.post(
        f"{w.stack.url}/auth/v1/token?grant_type=password",
        headers={"apikey": w.stack.anon_key},
        json=creds,
        timeout=15,
    ).json()
    refresh = session["refresh_token"]
    operator_sql.sql(
        f"select app.operator_reset_mfa('{person.email}', 'device lost, identity verified by video call 2026-10-05')"
    )
    assert (
        operator_sql.sql(f"select count(*) from auth.mfa_factors where user_id = '{person.id}'")
        == "0"
    )
    again = httpx.post(
        f"{w.stack.url}/auth/v1/token?grant_type=refresh_token",
        headers={"apikey": w.stack.anon_key},
        json={"refresh_token": refresh},
        timeout=15,
    )
    assert again.status_code in (400, 401), "the old session is over"
    token = httpx.post(
        f"{w.stack.url}/auth/v1/token?grant_type=password",
        headers={"apikey": w.stack.anon_key},
        json=creds,
        timeout=15,
    ).json()["access_token"]
    assert level(token) == "aal1"
    factor_id, secret = enroll_totp(w.stack, token)
    assert challenge_verify(w.stack, token, factor_id, secret).status_code == 200
