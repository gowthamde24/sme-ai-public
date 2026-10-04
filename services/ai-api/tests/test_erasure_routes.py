"""The HTTP side of erasure against an in-memory fake: authorization order, the role matrix (Owner
executes, Admin requests and cancels, nobody else does anything), idempotent requests, the
strictness of the bodies and fixed error messages. The database rules (the three functions, RLS,
the exception to immutability) are proved in pgTAP and against the real stack in
tests/integration/test_erasure_direct_postgrest.py."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.crm.repository import ConflictError, InvalidReferenceError
from app.erasure.repository import (
    AlreadyExecutedError,
    NotPendingError,
    RequestCancelledError,
    WindowNotElapsedError,
)
from app.tenancy.repository import Forbidden, UpstreamError
from tests.erasure_fakes import FakeErasureRepository
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

CONTACT = uuid.UUID(int=0xC0)
REQ = uuid.UUID(int=0xE1)
CANARY = "CANARY-erase-7d41"


class World:
    def __init__(self) -> None:
        self.repo = FakeErasureRepository()
        self.client, _ = make_client(erasure=self.repo)

    def url(self, path: str = "", tenant: uuid.UUID = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}/erasure-requests{path}"

    def body(self, **over: Any) -> dict[str, Any]:
        return {"id": str(REQ), "scope": "contact", "subject_id": str(CONTACT), **over}


@pytest.fixture
def w() -> World:
    return World()


def client(w: World) -> TestClient:
    return w.client


# ---- authentication and the role matrix
def test_no_token_is_401_on_every_endpoint(w: World) -> None:
    for method, path in [
        ("post", ""),
        ("get", ""),
        ("get", f"/{REQ}"),
        ("post", f"/{REQ}/execute"),
        ("post", f"/{REQ}/cancel"),
    ]:
        assert client(w).request(method, w.url(path), json={}).status_code == 401, (method, path)
    assert w.repo.calls == []


@pytest.mark.parametrize("user", ["a_sales", "a_viewer"])
def test_sales_and_viewer_can_do_nothing(w: World, user: str) -> None:
    w.repo.seed(TENANT_A.id, REQ)
    for method, path, body in [
        ("post", "", w.body()),
        ("get", "", None),
        ("get", f"/{REQ}", None),
        ("post", f"/{REQ}/execute", {}),
        ("post", f"/{REQ}/cancel", None),
    ]:
        r = client(w).request(method, w.url(path), json=body, headers=auth(user))
        assert r.status_code == 403, (user, method, path)
        assert r.json() == {
            "error": {"code": "forbidden", "message": "Your role does not allow this action."}
        }
    assert w.repo.calls == [], "the database was never asked"


def test_an_admin_may_request_list_get_and_cancel_but_not_execute(w: World) -> None:
    h = auth("a_admin")
    assert client(w).post(w.url(), json=w.body(), headers=h).status_code == 201
    assert client(w).get(w.url(), headers=h).status_code == 200
    assert client(w).get(w.url(f"/{REQ}"), headers=h).status_code == 200
    r = client(w).post(w.url(f"/{REQ}/execute"), json={}, headers=h)
    assert r.status_code == 403
    assert "execute" not in w.repo.calls
    assert client(w).post(w.url(f"/{REQ}/cancel"), headers=h).json()["status"] == "cancelled"


def test_an_owner_may_do_everything(w: World) -> None:
    h = auth("a_owner")
    assert client(w).post(w.url(), json=w.body(), headers=h).status_code == 201
    dry = client(w).post(w.url(f"/{REQ}/execute"), json={"dry_run": True}, headers=h)
    assert dry.status_code == 200 and dry.json()["dry_run"] is True
    assert client(w).get(w.url(f"/{REQ}"), headers=h).json()["status"] == "pending", (
        "a preview changes nothing"
    )
    done = client(w).post(w.url(f"/{REQ}/execute"), json={"dry_run": False}, headers=h)
    assert done.json()["status"] == "executed"
    assert w.repo.dry_runs == [True, False]


def test_an_execute_body_defaults_to_a_real_run_only_when_it_is_empty_json(w: World) -> None:
    w.repo.seed(TENANT_A.id, REQ)
    client(w).post(w.url(f"/{REQ}/execute"), json={}, headers=auth("a_owner"))
    assert w.repo.dry_runs == [False]


# ---- tenancy: a foreign tenant or a foreign request is a 404
def test_a_tenant_the_caller_does_not_belong_to_is_a_404(w: World) -> None:
    for user in ("a_owner", "outsider"):
        r = client(w).get(w.url(tenant=TENANT_B.id), headers=auth(user))
        assert r.status_code == 404, user
    assert w.repo.calls == []


def test_another_tenants_request_id_is_a_404_for_every_action(w: World) -> None:
    w.repo.seed(TENANT_B.id, REQ)
    h = auth("a_owner")
    assert client(w).get(w.url(f"/{REQ}"), headers=h).status_code == 404
    assert client(w).post(w.url(f"/{REQ}/execute"), json={}, headers=h).status_code == 404
    assert client(w).post(w.url(f"/{REQ}/cancel"), headers=h).status_code == 404
    assert "execute" not in w.repo.calls and "cancel" not in w.repo.calls


def test_a_malformed_id_is_a_404(w: World) -> None:
    for path in ("/not-a-uuid", "/not-a-uuid/execute", "/not-a-uuid/cancel"):
        method = "get" if path == "/not-a-uuid" else "post"
        kwargs: dict[str, Any] = {"json": {}} if path.endswith("execute") else {}
        r = client(w).request(method, w.url(path), headers=auth("a_owner"), **kwargs)
        assert r.status_code == 404, path


def test_the_callers_own_token_reaches_the_data_layer(w: World) -> None:
    h = auth("a_owner")
    client(w).post(w.url(), json=w.body(), headers=h)
    token = h["Authorization"].removeprefix("Bearer ")
    assert set(w.repo.tokens_seen) == {token}


# ---- idempotency
def test_the_same_request_twice_is_a_replay_not_a_second_request(w: World) -> None:
    h = auth("a_owner")
    first = client(w).post(w.url(), json=w.body(), headers=h)
    second = client(w).post(w.url(), json=w.body(), headers=h)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json() == second.json()
    assert len(w.repo.rows) == 1


def test_the_same_id_with_another_payload_is_a_conflict(w: World) -> None:
    h = auth("a_owner")
    client(w).post(w.url(), json=w.body(), headers=h)
    r = client(w).post(w.url(), json=w.body(scope="company"), headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


# ---- strict bodies
@pytest.mark.parametrize(
    "extra",
    [
        {"tenant_id": str(TENANT_B.id)},
        {"status": "executed"},
        {"result": {}},
        {"requested_by": str(uuid.uuid4())},
        {"execute_after": "2020-01-01T00:00:00Z"},
    ],
)
def test_a_request_body_cannot_carry_a_server_owned_field(w: World, extra: dict[str, Any]) -> None:
    r = client(w).post(w.url(), json={**w.body(), **extra}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert w.repo.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {"id": str(REQ), "scope": "tenant", "subject_id": str(CONTACT)},
        {"id": str(REQ), "scope": "contact"},
        {"id": str(REQ), "scope": "company"},
        {"id": str(REQ), "scope": "everything"},
        {"scope": "tenant"},
        {"id": "nope", "scope": "tenant"},
    ],
)
def test_a_request_must_have_a_valid_shape(w: World, body: dict[str, Any]) -> None:
    r = client(w).post(w.url(), json=body, headers=auth("a_owner"))
    assert r.status_code == 422
    assert w.repo.calls == []


def test_the_execute_body_forbids_unknown_keys(w: World) -> None:
    w.repo.seed(TENANT_A.id, REQ)
    r = client(w).post(
        w.url(f"/{REQ}/execute"), json={"dry_run": True, "tenant_id": "x"}, headers=auth("a_owner")
    )
    assert r.status_code == 422


def test_a_workspace_request_takes_no_subject(w: World) -> None:
    r = client(w).post(w.url(), json={"id": str(REQ), "scope": "tenant"}, headers=auth("a_owner"))
    assert r.status_code == 201
    assert r.json()["subject_id"] is None and r.json()["scope"] == "tenant"
    assert r.json()["execute_after"] > r.json()["created_at"], "the 24-hour window is shown"


# ---- fixed error messages: nothing from the data layer reaches the client
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (NotPendingError(CANARY), 409, "erasure_not_pending"),
        (WindowNotElapsedError(CANARY), 409, "erasure_window_open"),
        (AlreadyExecutedError(CANARY), 409, "erasure_already_executed"),
        (RequestCancelledError(CANARY), 409, "erasure_cancelled"),
        (Forbidden(CANARY), 403, "forbidden"),
        (UpstreamError(CANARY), 502, "upstream_error"),
    ],
)
def test_data_layer_failures_become_fixed_messages(
    w: World, error: Exception, status: int, code: str
) -> None:
    w.repo.seed(TENANT_A.id, REQ)
    w.repo.execute_error = error
    r = client(w).post(w.url(f"/{REQ}/execute"), json={}, headers=auth("a_owner"))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)
    assert CANARY not in r.text


def test_request_failures_become_fixed_messages(w: World) -> None:
    for error, status, code in [
        (InvalidReferenceError(CANARY), 422, "invalid_reference"),
        (ConflictError(CANARY), 409, "conflict"),
    ]:
        w.repo.request_error = error
        r = client(w).post(w.url(), json=w.body(), headers=auth("a_owner"))
        assert (r.status_code, r.json()["error"]["code"]) == (status, code)
        assert CANARY not in r.text


def test_cancel_failures_become_fixed_messages(w: World) -> None:
    w.repo.seed(TENANT_A.id, REQ)
    w.repo.cancel_error = AlreadyExecutedError(CANARY)
    r = client(w).post(w.url(f"/{REQ}/cancel"), headers=auth("a_admin"))
    assert (r.status_code, r.json()["error"]["code"]) == (409, "erasure_already_executed")
    assert CANARY not in r.text


# ---- what a response can hold
def test_the_result_holds_counts_ids_and_fixed_text_only(w: World) -> None:
    w.repo.seed(TENANT_A.id, REQ)
    r = client(w).post(w.url(f"/{REQ}/execute"), json={}, headers=auth("a_owner"))
    assert set(r.json()) == {
        "request_id",
        "scope",
        "status",
        "dry_run",
        "counts",
        "review",
        "review_truncated",
        "exports_logged",
        "note",
        "replayed",
    }
    assert all(isinstance(v, int) for v in r.json()["counts"].values())
    assert "names" in r.json()["note"].lower(), "the limit of names is stated every time"


def test_erasure_unavailable_is_a_503_not_a_silent_success() -> None:
    bare, _ = make_client()
    r = bare.get(f"/v1/tenants/{TENANT_A.id}/erasure-requests", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "erasure_unavailable"
