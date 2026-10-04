"""The PostgREST adapter for evidence: what it sends, how it reads, and -- most importantly -- that
a URL or snippet inside a data-layer error (Postgres copies row values into `message` / `details`)
never reaches a response, an exception message or a log line."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import httpx
import pytest

from app.crm.models import encode_cursor
from app.crm.repository import (
    ConflictError,
    InvalidReferenceError,
    InvalidValueError,
    NotFoundError,
)
from app.evidence import repository as r
from app.evidence.models import derive_link_id
from app.tenancy.repository import Forbidden, TokenRejected, UpstreamError

CANARY_URL = "https://canary-host-zq91.example/in/jane-canary?token=canary-zq91"
CANARY_SNIPPET = "Canary Zq91 said something personal"
TENANT = uuid.UUID(int=0xA)
TARGET = uuid.UUID(int=0xC1)
TOKEN = "caller.jwt.token"
ANON = "public-anon-key"
EVIDENCE_ID = uuid.uuid4()
LINK_ID = derive_link_id(EVIDENCE_ID, "company", TARGET)


def repo_with(handler: Any) -> tuple[r.PostgrestEvidenceRepository, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(recording)
    )
    return r.PostgrestEvidenceRepository("http://postgrest.test/rest/v1", ANON, client=client), seen


def pg_error(
    code: str, message: str, status: int = 400, details: str | None = None
) -> httpx.Response:
    return httpx.Response(
        status, json={"code": code, "message": message, "details": details, "hint": None}
    )


def link_row(**over: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(LINK_ID),
        "company_id": str(TARGET),
        "lead_id": None,
        "claim_id": None,
        "stance": None,
        "created_by": None,
        "created_via": "manual",
        "created_at": "2026-01-01T00:00:00+00:00",
        "archived_at": None,
        "evidence": {
            "id": str(EVIDENCE_ID),
            "kind": "web_page",
            "provider": "manual",
            "url": "https://example.test/a",
            "reference": None,
            "snippet": "a snippet",
            "retrieved_at": "2026-01-01T00:00:00+00:00",
            "published_at": None,
            "created_by": None,
            "created_via": "manual",
            "created_at": "2026-01-01T00:00:00+00:00",
            "archived_at": None,
        },
    }
    row.update(over)
    return row


PAYLOAD = {
    "id": str(EVIDENCE_ID),
    "kind": "web_page",
    "url": "https://example.test/a",
    "snippet": "a snippet",
}


# ==== what is sent ====
def test_requests_carry_the_callers_token_and_the_anon_key_only() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.list_for_target(
        TOKEN, TENANT, "company", TARGET, limit=10, cursor=None, include_archived=False
    )
    repo.get_link(TOKEN, TENANT, LINK_ID)
    for request in seen:
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert request.headers["apikey"] == ANON
        assert not {"x-service-role", "service_role"} & set(request.headers)


def test_list_is_scoped_to_tenant_and_target_keyset_ordered_and_hides_archived() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.list_for_target(
        TOKEN, TENANT, "company", TARGET, limit=50, cursor=None, include_archived=False
    )
    p = seen[0].url.params
    assert seen[0].url.path.endswith("/evidence_links")
    assert p["tenant_id"] == f"eq.{TENANT}"
    assert p["company_id"] == f"eq.{TARGET}" and "lead_id" not in p
    assert p["order"] == "created_at.desc,id.desc"
    assert p["limit"] == "51"
    assert p["archived_at"] == "is.null"
    assert p["evidence.archived_at"] == "is.null"
    assert "evidence!inner(" in p["select"], "a link is hidden together with archived evidence"
    assert "or" not in p


def test_a_lead_target_filters_on_lead_id() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.list_for_target(
        TOKEN, TENANT, "lead", TARGET, limit=5, cursor=None, include_archived=False
    )
    p = seen[0].url.params
    assert p["lead_id"] == f"eq.{TARGET}" and "company_id" not in p


def test_include_archived_drops_both_filters_and_the_cursor_becomes_a_keyset_condition() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    rid = uuid.uuid4()
    cursor = ("2026-10-05T12:30:45.123456+00:00", rid)
    repo.list_for_target(
        TOKEN, TENANT, "company", TARGET, limit=5, cursor=cursor, include_archived=True
    )
    p = seen[0].url.params
    assert p["or"] == f"(created_at.lt.{cursor[0]},and(created_at.eq.{cursor[0]},id.lt.{rid}))"
    assert "archived_at" not in p and "evidence.archived_at" not in p


def test_pagination_uses_a_lookahead_row_and_issues_a_cursor() -> None:
    rows = [
        link_row(id=str(uuid.UUID(int=i)), created_at=f"2026-01-0{i}T00:00:00+00:00")
        for i in (3, 2, 1)
    ]
    repo, _ = repo_with(lambda req: httpx.Response(200, json=rows))
    page = repo.list_for_target(
        TOKEN, TENANT, "company", TARGET, limit=2, cursor=None, include_archived=False
    )
    assert [str(i.id) for i in page.items] == [rows[0]["id"], rows[1]["id"]]
    assert page.next_cursor == encode_cursor(page.items[-1].created_at, page.items[-1].id)
    last = repo.list_for_target(
        TOKEN, TENANT, "company", TARGET, limit=3, cursor=None, include_archived=False
    )
    assert last.next_cursor is None


def test_selects_only_known_columns() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.get_link(TOKEN, TENANT, LINK_ID)
    select = seen[0].url.params["select"]
    assert "tenant_id" not in select
    assert select.startswith("id,company_id,lead_id,claim_id,stance,")
    assert "evidence:evidence(id,kind,provider,url,reference,snippet" in select


# ==== create ====
def test_create_calls_the_rpc_with_a_derived_link_id_and_the_human_provider() -> None:
    calls: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if req.method == "POST":
            return httpx.Response(200, json=str(LINK_ID))
        return httpx.Response(200, json=[link_row()])

    repo, _ = repo_with(handler)
    link, created = repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)
    assert created and link.id == LINK_ID
    rpc = calls[0]
    assert rpc.url.path.endswith("/rpc/create_evidence_with_link")
    body = json.loads(rpc.content)
    assert body == {
        "p_tenant_id": str(TENANT),
        "p_evidence_id": str(EVIDENCE_ID),
        "p_link_id": str(LINK_ID),
        "p_target_kind": "company",
        "p_target_id": str(TARGET),
        "p_kind": "web_page",
        "p_provider": "manual",
        "p_url": "https://example.test/a",
        "p_snippet": "a snippet",
    }
    assert [c.method for c in calls] == ["POST", "GET"]


def test_a_client_supplied_provider_or_origin_is_never_forwarded() -> None:
    repo, seen = repo_with(
        lambda req: (
            httpx.Response(200, json=[link_row()])
            if req.method == "GET"
            else httpx.Response(200, json="x")
        )
    )
    repo.create_for_target(
        TOKEN,
        TENANT,
        "company",
        TARGET,
        {
            **PAYLOAD,
            "provider": "agent.run",
            "created_via": "agent",
            "created_by": str(uuid.uuid4()),
        },
    )
    body = json.loads(seen[0].content)
    assert body["p_provider"] == "manual"
    assert not {"p_created_via", "p_created_by", "created_via", "created_by"} & set(body)


def test_dates_are_forwarded_only_when_supplied() -> None:
    repo, seen = repo_with(
        lambda req: (
            httpx.Response(200, json=[link_row()])
            if req.method == "GET"
            else httpx.Response(200, json="x")
        )
    )
    repo.create_for_target(
        TOKEN, TENANT, "company", TARGET, {**PAYLOAD, "retrieved_at": "2026-01-01T00:00:00Z"}
    )
    body = json.loads(seen[0].content)
    assert body["p_retrieved_at"] == "2026-01-01T00:00:00Z" and "p_published_at" not in body


# ==== idempotency ====
def test_a_retry_with_the_same_payload_returns_the_existing_link() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error(
                "23505", 'duplicate key value violates unique constraint "evidence_pkey"', 409
            )
        return httpx.Response(200, json=[link_row()])

    repo, _ = repo_with(handler)
    link, created = repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)
    assert not created and link.id == LINK_ID


def test_a_retry_with_a_matching_retrieved_at_in_another_notation_is_still_a_retry() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error("23505", 'violates unique constraint "evidence_pkey"', 409)
        return httpx.Response(200, json=[link_row()])

    repo, _ = repo_with(handler)
    _, created = repo.create_for_target(
        TOKEN, TENANT, "company", TARGET, {**PAYLOAD, "retrieved_at": "2026-01-01T05:30:00+05:30"}
    )
    assert not created
    with pytest.raises(ConflictError):
        repo.create_for_target(
            TOKEN, TENANT, "company", TARGET, {**PAYLOAD, "retrieved_at": "2026-01-02T00:00:00Z"}
        )


@pytest.mark.parametrize(
    "change",
    [
        {"url": "https://example.test/other"},
        {"snippet": "different"},
        {"snippet": None},
        {"kind": "note"},
        {"reference": "doc:abc-1"},
        {"published_at": "2025-01-01T00:00:00Z"},
    ],
)
def test_a_different_payload_under_the_same_id_is_a_conflict(change: dict[str, Any]) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error("23505", 'violates unique constraint "evidence_pkey"', 409)
        return httpx.Response(200, json=[link_row()])

    repo, _ = repo_with(handler)
    with pytest.raises(ConflictError):
        repo.create_for_target(TOKEN, TENANT, "company", TARGET, {**PAYLOAD, **change})


def test_an_id_the_caller_cannot_see_is_the_same_conflict() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error("23505", 'violates unique constraint "evidence_pkey"', 409)
        return httpx.Response(200, json=[])  # RLS: another tenant's row is invisible

    repo, _ = repo_with(handler)
    with pytest.raises(ConflictError):
        repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)


def test_a_link_stored_with_someone_elses_provider_is_not_a_retry() -> None:
    other = link_row()
    other["evidence"]["provider"] = "serper"

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error("23505", 'violates unique constraint "evidence_pkey"', 409)
        return httpx.Response(200, json=[other])

    repo, _ = repo_with(handler)
    with pytest.raises(ConflictError):
        repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)


# ==== archive ====
def test_archive_patches_only_archived_at_scoped_to_tenant_and_id() -> None:
    repo, seen = repo_with(
        lambda req: httpx.Response(200, json=[link_row(archived_at="2026-02-01T00:00:00+00:00")])
    )
    link = repo.set_link_archived(TOKEN, TENANT, LINK_ID, True)
    assert link.archived_at is not None
    req = seen[0]
    assert req.method == "PATCH" and list(json.loads(req.content)) == ["archived_at"]
    assert req.url.params["tenant_id"] == f"eq.{TENANT}" and req.url.params["id"] == f"eq.{LINK_ID}"
    repo2, seen2 = repo_with(lambda req: httpx.Response(200, json=[link_row()]))
    repo2.set_link_archived(TOKEN, TENANT, LINK_ID, False)
    assert json.loads(seen2[0].content) == {"archived_at": None}


def test_archiving_a_row_that_is_not_visible_is_not_found() -> None:
    repo, _ = repo_with(lambda req: httpx.Response(200, json=[]))
    with pytest.raises(NotFoundError):
        repo.set_link_archived(TOKEN, TENANT, LINK_ID, True)


# ==== classification: SQLSTATE only ====
@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("42501", Forbidden),
        ("23503", InvalidReferenceError),
        ("23514", InvalidValueError),
        ("22P02", InvalidValueError),
        ("23502", InvalidValueError),
        ("22023", InvalidValueError),
        ("23505", ConflictError),
    ],
)
def test_sqlstate_classification(code: str, expected: type[Exception]) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json=[])
        return pg_error(code, "some message", 400)

    repo, _ = repo_with(handler)
    with pytest.raises(expected):
        repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)


def test_a_token_problem_is_a_token_rejection_and_unknown_errors_are_upstream() -> None:
    repo, _ = repo_with(
        lambda req: httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
    )
    with pytest.raises(TokenRejected):
        repo.get_link(TOKEN, TENANT, LINK_ID)
    repo2, _ = repo_with(lambda req: pg_error("XX000", "boom", 500))
    with pytest.raises(UpstreamError):
        repo2.get_link(TOKEN, TENANT, LINK_ID)


def test_message_text_never_decides_the_class() -> None:
    # A message that LOOKS like a conflict, with a non-conflict SQLSTATE: still the SQLSTATE wins.
    repo, _ = repo_with(
        lambda req: pg_error("23514", 'duplicate key value violates unique constraint "x"')
    )
    with pytest.raises(InvalidValueError):
        repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)


# ==== PII: a URL / snippet in a data-layer error never escapes ====
def _leaky(code: str, status: int = 400) -> httpx.Response:
    return pg_error(
        code,
        'new row for relation "evidence" violates check constraint "evidence_url_check"',
        status,
        details=f"Failing row contains ({EVIDENCE_ID}, {CANARY_URL}, {CANARY_SNIPPET}).",
    )


@pytest.mark.parametrize("code", ["23514", "23505", "23503", "42501", "22P02", "XX000"])
def test_data_layer_text_never_reaches_exceptions_or_logs(
    code: str, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[]) if req.method == "GET" else _leaky(code)

    repo, _ = repo_with(handler)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(Exception) as caught:  # noqa: PT011 - any class: none may carry the text
        repo.create_for_target(TOKEN, TENANT, "company", TARGET, PAYLOAD)
    text = repr(caught.value) + str(caught.value) + repr(getattr(caught.value, "__cause__", None))
    text += repr(getattr(caught.value, "__context__", None))
    assert "canary" not in text.lower() and "zq91" not in text.lower()
    assert "canary" not in caplog.text.lower() and "zq91" not in caplog.text.lower()


def test_a_malformed_row_does_not_echo_the_row(caplog: pytest.LogCaptureFixture) -> None:
    bad_row = link_row()
    bad_row["evidence"]["kind"] = "carrier_pigeon"
    bad_row["evidence"]["url"] = CANARY_URL
    repo, _ = repo_with(lambda req: httpx.Response(200, json=[bad_row]))
    caplog.set_level(logging.DEBUG)
    with pytest.raises(UpstreamError) as caught:
        repo.get_link(TOKEN, TENANT, LINK_ID)
    assert "canary" not in (repr(caught.value) + caplog.text).lower()
    assert caught.value.__cause__ is None


def test_an_unreachable_data_layer_logs_the_class_only(caplog: pytest.LogCaptureFixture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {req.url}")

    repo, _ = repo_with(handler)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(UpstreamError):
        repo.get_link(TOKEN, TENANT, LINK_ID)
    assert "cannot reach" not in caplog.text and "ConnectError" in caplog.text


def test_a_tenant_id_smuggled_into_the_payload_is_ignored() -> None:
    other = uuid.UUID(int=0xB)
    repo, seen = repo_with(
        lambda req: (
            httpx.Response(200, json=[link_row()])
            if req.method == "GET"
            else httpx.Response(200, json="x")
        )
    )
    repo.create_for_target(
        TOKEN,
        TENANT,
        "company",
        TARGET,
        {**PAYLOAD, "tenant_id": str(other), "p_tenant_id": str(other)},
    )
    body = json.loads(seen[0].content)
    assert body["p_tenant_id"] == str(TENANT)
    assert str(other) not in seen[0].content.decode()


def test_the_application_closes_every_http_client_on_shutdown() -> None:
    """Each repository owns an httpx client; the lifespan must close all three."""
    from fastapi.testclient import TestClient

    from app.auth.deps import Runtime
    from app.auth.jwt import StaticKeyProvider, TokenVerifier
    from app.config import Settings
    from app.crm.repository import PostgrestCrmRepository
    from app.leads.repository import PostgrestLeadsRepository
    from app.main import create_app
    from app.tenancy.repository import PostgrestTenantRepository
    from tests.fakes import KEY
    from tests.keys import AUDIENCE, ISSUER

    def http() -> httpx.Client:
        return httpx.Client(
            base_url="http://postgrest.test",
            transport=httpx.MockTransport(lambda r: httpx.Response(200)),
        )

    clients = [http(), http(), http(), http()]
    runtime = Runtime(
        verifier=TokenVerifier(
            issuer=ISSUER,
            audience=AUDIENCE,
            algorithms=("ES256",),
            asymmetric_keys=StaticKeyProvider(KEY.public_key()),
            hs256_secret=None,
        ),
        repository=PostgrestTenantRepository("http://postgrest.test", ANON, client=clients[0]),
        crm=PostgrestCrmRepository("http://postgrest.test", ANON, client=clients[1]),
        evidence=r.PostgrestEvidenceRepository("http://postgrest.test", ANON, client=clients[2]),
        leads=PostgrestLeadsRepository("http://postgrest.test", ANON, client=clients[3]),
    )
    app = create_app(Settings(_env_file=None, api_env="development"), runtime=runtime)  # type: ignore[call-arg]
    with TestClient(app):
        assert not any(c.is_closed for c in clients)
    assert all(c.is_closed for c in clients), [c.is_closed for c in clients]
