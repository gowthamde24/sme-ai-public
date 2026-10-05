"""ADR 0016 at the API: an Owner or Admin with a password-only (aal1) session, or a token with no
aal claim, is refused the privileged actions with 403 mfa_required; a second-factor (aal2) session
is allowed; Sales and Viewers are never asked (they get the plain role refusal, so the session level
is no oracle); reads and ordinary work are unaffected. The database enforces the erasure actions and
the agents switch again (pgTAP 47, tests/integration/test_mfa_enforcement.py)."""

from __future__ import annotations

import json
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


@pytest.mark.parametrize(("method", "path", "body"), ACTIONS)
@pytest.mark.parametrize("who", ["a_owner", "a_admin"])
def test_a_password_only_session_is_refused(method: str, path: str, body: Any, who: str) -> None:
    env = Env()
    for claim in ({"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}, {"aal": "aal3"}, {"aal": ""}):
        r = call(env, who, method, path, body, **claim)
        assert r.status_code == 403, (who, path, claim, r.text)
        if who == "a_admin" and path.endswith("/execute"):
            continue  # only the Owner runs an erasure: the plain role refusal comes first
        assert r.json()["error"]["code"] == "mfa_required", (who, path, claim)


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
