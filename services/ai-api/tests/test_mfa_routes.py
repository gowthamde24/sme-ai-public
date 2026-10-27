"""ADR 0016 at the API, as changed by ADR 0115 (the second factor is OPTIONAL): an Owner or Admin whose sign-in is not recent (older than 10 minutes, or a token that states no sign-in time) is refused the
privileged actions with 403 mfa_required (reason recent_sign_in); a recent sign-in is allowed whatever its assurance level (a person who turned the authenticator on is asked for the code by the database); Sales and Viewers are never asked (they get the plain role refusal, so the session level
is no oracle); reads and ordinary work are unaffected. The database enforces the erasure actions and
the agents switch again (pgTAP 47, tests/integration/test_mfa_enforcement.py)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

import pytest

from app.tenancy.repository import MfaRequired
from tests.erasure_fakes import FakeErasureRepository
from tests.fakes import TENANT_A, TENANT_B, FakeLeadsRepository, auth, make_client

ICP_TEMPLATE = json.loads(
    (Path(__file__).resolve().parents[3] / "config" / "icp" / "silk-wholesale.v1.json").read_text(
        encoding="utf-8"
    )
)
REQ = uuid.UUID(int=0xE1)
CONTACT = uuid.UUID(int=0xC0)
BASE = f"/v1/tenants/{TENANT_A.id}"


class Env:
    def __init__(self) -> None:
        self.erasure = FakeErasureRepository()
        self.erasure.seed(TENANT_A.id, REQ)
        self.leads = FakeLeadsRepository()
        self.client, _ = make_client(erasure=self.erasure, leads=self.leads)


# (method, path, json body) of every privileged action the API gates
ACTIONS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "/erasure-requests", {"id": str(uuid.uuid4()), "scope": "tenant"}),
    ("POST", f"/erasure-requests/{REQ}/execute", {}),
    ("POST", f"/erasure-requests/{REQ}/cancel", None),
    ("POST", "/exports", {"kind": "lead_labels", "format": "csv"}),
    ("POST", "/icp-configs", {"config": ICP_TEMPLATE}),
]


def call(env: Env, who: str, method: str, path: str, body: Any, **claims: Any) -> Any:
    return env.client.request(method, BASE + path, json=body, headers=auth(who, **claims))


OLD = int(time.time()) - 3600
STALE = (
    {"aal": "aal1"},  # the old tests' "password-only session": the helper makes it sign in an hour ago
    {"aal": "aal2", "iat": OLD},  # a code was entered, but long ago
    {"aal": "aal1", "iat": int(time.time()), "amr": [{"method": "password", "timestamp": OLD}]},  # a fresh token, an old sign-in
)
FRESH = (
    {"aal": "aal1", "iat": int(time.time())},  # a person with no second factor, signed in just now (Google or a password)
    {"aal": None, "iat": int(time.time())},  # no aal claim: the sign-in is recent, which is what is asked
    {"aal": "aal2"},
    {"aal": "aal1", "iat": OLD, "amr": [{"method": "oauth", "timestamp": int(time.time()) - 60}]},  # an old token, a Google sign-in a minute ago
)


@pytest.mark.parametrize(("method", "path", "body"), ACTIONS)
@pytest.mark.parametrize("who", ["a_owner", "a_admin"])
def test_a_sign_in_that_is_not_recent_is_refused(method: str, path: str, body: Any, who: str) -> None:
    env = Env()
    for claim in STALE:
        r = call(env, who, method, path, body, **claim)
        assert r.status_code == 403, (who, path, claim, r.text)
        if who == "a_admin" and path.endswith("/execute"):
            continue  # only the Owner runs an erasure: the plain role refusal comes first
        assert r.json()["error"]["code"] == "mfa_required" and r.json()["error"]["reason"] == "recent_sign_in", (who, path, claim)


@pytest.mark.parametrize(("method", "path", "body"), ACTIONS)
def test_a_recent_sign_in_is_enough_whatever_its_assurance_level(method: str, path: str, body: Any) -> None:
    for claim in FRESH:
        env = Env()
        r = call(env, "a_owner", method, path, body, **claim)
        assert r.status_code < 400, (path, claim, r.status_code, r.text)


@pytest.mark.parametrize(("method", "path", "body"), ACTIONS)
def test_a_second_factor_session_is_allowed(method: str, path: str, body: Any) -> None:
    env = Env()
    who = "a_owner"
    r = call(env, who, method, path, body, aal="aal2")
    assert r.status_code < 400, (path, r.status_code, r.text)


def test_an_admin_with_a_second_factor_is_allowed_what_an_admin_may_do() -> None:
    env = Env()
    for method, path, body in ACTIONS:
        if path.endswith("/execute"):
            continue  # the Owner runs an erasure
        r = call(env, "a_admin", method, path, body, aal="aal2")
        assert r.status_code < 400, (path, r.text)
    assert (
        call(env, "a_admin", "POST", f"/erasure-requests/{REQ}/execute", {}, aal="aal2").status_code
        == 403
    )


@pytest.mark.parametrize(("method", "path", "body"), ACTIONS)
@pytest.mark.parametrize("who", ["a_sales", "a_viewer"])
def test_sales_and_viewers_get_the_plain_role_refusal_whatever_the_session(
    who: str, method: str, path: str, body: Any
) -> None:
    env = Env()
    for claim in ({"aal": "aal1"}, {"aal": "aal2"}, {"aal": None}):
        r = call(env, who, method, path, body, **claim)
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (who, path, claim)


def test_a_stranger_learns_nothing_from_the_session_level() -> None:
    env = Env()
    for who in ("b_owner", "outsider"):
        for claim in ({"aal": "aal1"}, {"aal": "aal2"}):
            r = call(
                env, who, "POST", "/exports", {"kind": "lead_labels", "format": "csv"}, **claim
            )
            assert r.status_code == 404, (who, claim)


def test_a_wrong_workspace_is_not_found_even_with_a_second_factor() -> None:
    env = Env()
    r = env.client.post(
        f"/v1/tenants/{TENANT_B.id}/exports",
        json={"kind": "lead_labels", "format": "csv"},
        headers=auth("a_owner", aal="aal2"),
    )
    assert r.status_code == 404


def test_reads_and_ordinary_work_do_not_ask_for_a_second_factor() -> None:
    env = Env()
    for who in ("a_owner", "a_admin"):
        assert call(env, who, "GET", "/erasure-requests", None, aal="aal1").status_code == 200
        assert (
            call(env, who, "GET", f"/erasure-requests/{REQ}", None, aal="aal1").status_code == 200
        )
        assert call(env, who, "GET", "/data-policy", None, aal="aal1").status_code == 200


def test_a_database_refusal_is_the_same_403() -> None:
    env = Env()
    env.erasure.request_error = MfaRequired("SM306")
    r = call(
        env,
        "a_owner",
        "POST",
        "/erasure-requests",
        {"id": str(uuid.uuid4()), "scope": "tenant"},
        aal="aal2",
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"
    assert "authenticator" in r.json()["error"]["message"]
