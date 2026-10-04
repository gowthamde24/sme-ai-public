"""The PostgREST adapter for the CRM: what it sends, how it classifies failures, and -- most
importantly -- that personal data in a data-layer error (PostgreSQL copies row values into
`message` / `details`) never reaches a response, an exception message or a log line."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import httpx
import pytest

from app.crm import repository as r
from app.crm.models import encode_cursor
from app.tenancy.repository import Forbidden, TokenRejected, UpstreamError
from tests.fakes import TENANT_A, FakeCrmRepository, auth, make_client

CANARY = "canary.zq91@example.test"
CANARY_NAME = "Canary Zq91"
TENANT = uuid.UUID(int=0xA)
TOKEN = "caller.jwt.token"
ANON = "public-anon-key"


def repo_with(handler: Any) -> tuple[r.PostgrestCrmRepository, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(recording)
    )
    return r.PostgrestCrmRepository("http://postgrest.test/rest/v1", ANON, client=client), seen


def pg_error(
    code: str, message: str, status: int = 400, details: str | None = None
) -> httpx.Response:
    return httpx.Response(
        status, json={"code": code, "message": message, "details": details, "hint": None}
    )


COMPANY_ROW: dict[str, Any] = {
    "id": str(uuid.uuid4()),
    "created_by": None,
    "created_via": "manual",
    "created_at": "2026-01-01T00:00:00+00:00",
    "updated_at": "2026-01-01T00:00:00+00:00",
    "archived_at": None,
    "name": "Acme",
    "type": "prospect",
    "website": None,
    "country": None,
    "region": None,
    "city": None,
    "industry": None,
    "tags": [],
}


# ==== what is sent ====
def test_requests_carry_the_callers_token_and_the_anon_key_only() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.list_rows(
        TOKEN, "companies", TENANT, limit=10, cursor=None, q=None, include_archived=False
    )
    repo.get_row(TOKEN, "companies", TENANT, uuid.uuid4())
    for request in seen:
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert request.headers["apikey"] == ANON
        assert not {"x-service-role", "service_role"} & set(request.headers)


def test_list_is_scoped_to_the_path_tenant_and_keyset_ordered() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.list_rows(TOKEN, "contacts", TENANT, limit=50, cursor=None, q=None, include_archived=False)
    p = seen[0].url.params
    assert p["tenant_id"] == f"eq.{TENANT}"
    assert p["order"] == "created_at.desc,id.desc"
    assert p["limit"] == "51"
    assert p["archived_at"] == "is.null"
    assert "or" not in p and "name" not in p


def test_cursor_becomes_a_keyset_condition_and_include_archived_drops_the_filter() -> None:
    import datetime as dt

    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    rid = uuid.uuid4()
    cursor = ("2026-10-05T12:30:45.123456+00:00", rid)
    repo.list_rows(TOKEN, "leads", TENANT, limit=5, cursor=cursor, q=None, include_archived=True)
    p = seen[0].url.params
    assert p["or"] == f"(created_at.lt.{cursor[0]},and(created_at.eq.{cursor[0]},id.lt.{rid}))"
    assert "archived_at" not in p
    assert dt.datetime.fromisoformat(cursor[0])


def test_name_filter_neutralises_like_metacharacters_and_only_touches_name() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    for q, expected in [
        ("acme", "ilike.*acme*"),
        ("50%_off", r"ilike.*50\%\_off*"),
        ("a*b", "ilike.*ab*"),
        ("back\\slash", r"ilike.*back\\slash*"),
        ("a,b)or(id.eq.1", "ilike.*a,b)or(id.eq.1*"),
    ]:
        seen.clear()
        repo.list_rows(
            TOKEN, "companies", TENANT, limit=5, cursor=None, q=q, include_archived=False
        )
        p = seen[0].url.params
        assert p["name"] == expected
        assert set(p.keys()) == {"select", "tenant_id", "order", "limit", "archived_at", "name"}, (
            "q cannot add filters"
        )


def test_name_filter_is_ignored_outside_companies() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=[]))
    repo.list_rows(TOKEN, "contacts", TENANT, limit=5, cursor=None, q="x", include_archived=False)
    assert "name" not in seen[0].url.params


def test_pagination_uses_a_lookahead_row_and_issues_a_cursor() -> None:
    rows = [
        {**COMPANY_ROW, "id": str(uuid.UUID(int=i)), "created_at": f"2026-01-0{i}T00:00:00+00:00"}
        for i in (3, 2, 1)
    ]
    repo, _ = repo_with(lambda req: httpx.Response(200, json=rows))
    page = repo.list_rows(
        TOKEN, "companies", TENANT, limit=2, cursor=None, q=None, include_archived=False
    )
    assert [str(i.id) for i in page.items] == [rows[0]["id"], rows[1]["id"]]
    assert page.next_cursor == encode_cursor(page.items[-1].created_at, page.items[-1].id)
    last = repo.list_rows(
        TOKEN, "companies", TENANT, limit=3, cursor=None, q=None, include_archived=False
    )
    assert last.next_cursor is None


def test_create_sends_the_path_tenant_and_selects_only_known_columns() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(201, json=[COMPANY_ROW]))
    row, created = repo.create_row(
        TOKEN, "companies", TENANT, {"id": COMPANY_ROW["id"], "name": "Acme"}
    )
    assert created and row.name == "Acme"
    body = json.loads(seen[0].content)
    assert body == {"id": COMPANY_ROW["id"], "name": "Acme", "tenant_id": str(TENANT)}
    assert seen[0].headers["prefer"] == "return=representation"
    assert "tenant_id" not in seen[0].url.params["select"]


def test_consent_rpc_is_a_closed_list() -> None:
    repo, seen = repo_with(lambda req: httpx.Response(200, json=str(uuid.uuid4())))
    assert isinstance(repo.consent_rpc(TOKEN, "suppress_contact", {"p_tenant_id": "t"}), uuid.UUID)
    assert seen[0].url.path.endswith("/rpc/suppress_contact")
    with pytest.raises(ValueError):
        repo.consent_rpc(TOKEN, "create_tenant", {})
    none_repo, _ = repo_with(lambda req: httpx.Response(200, content=b"null"))
    assert none_repo.consent_rpc(TOKEN, "lift_suppression", {}) is None


# ==== idempotent create ====
def test_a_retry_with_the_same_payload_returns_the_existing_row() -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.method)
        if req.method == "POST":
            return pg_error(
                "23505", 'duplicate key value violates unique constraint "companies_pkey"', 409
            )
        return httpx.Response(200, json=[COMPANY_ROW])

    repo, _ = repo_with(handler)
    row, created = repo.create_row(
        TOKEN,
        "companies",
        TENANT,
        {"id": COMPANY_ROW["id"], "name": "Acme", "type": "prospect", "tags": []},
    )
    assert not created and str(row.id) == COMPANY_ROW["id"]
    assert calls == ["POST", "GET"]


def test_a_retry_is_recognised_even_when_postgres_reports_the_email_constraint_first() -> None:
    contact = {
        "id": str(uuid.uuid4()),
        "created_by": None,
        "created_via": "manual",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "archived_at": None,
        "company_id": None,
        "full_name": CANARY_NAME,
        "email": CANARY,
        "phone": None,
        "job_title": None,
        "email_consent": "unknown",
        "whatsapp_consent": "unknown",
        "phone_consent": "unknown",
        "suppressed_at": None,
        "suppression_reason": None,
    }

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error(
                "23505",
                'duplicate key value violates unique constraint "contacts_tenant_email_key"',
                409,
                f"Key (lower(email))=({CANARY}) already exists.",
            )
        return httpx.Response(200, json=[contact])

    repo, _ = repo_with(handler)
    payload = {
        "id": contact["id"],
        "full_name": CANARY_NAME,
        "email": CANARY,
        "company_id": None,
        "phone": None,
        "job_title": None,
    }
    row, created = repo.create_row(TOKEN, "contacts", TENANT, payload)
    assert not created and row.email == CANARY


def test_same_id_different_payload_is_a_conflict() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error(
                "23505", 'duplicate key value violates unique constraint "companies_pkey"', 409
            )
        return httpx.Response(200, json=[COMPANY_ROW])

    repo, _ = repo_with(handler)
    with pytest.raises(r.ConflictError):
        repo.create_row(
            TOKEN,
            "companies",
            TENANT,
            {"id": COMPANY_ROW["id"], "name": "Different", "type": "prospect", "tags": []},
        )


def test_an_id_that_exists_only_in_another_tenant_is_the_same_conflict() -> None:
    """The retry lookup is made with the caller's RLS: the foreign row is invisible, so it returns
    [] and we raise the very same ConflictError as for a payload mismatch."""

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error(
                "23505", 'duplicate key value violates unique constraint "companies_pkey"', 409
            )
        return httpx.Response(200, json=[])

    repo, _ = repo_with(handler)
    with pytest.raises(r.ConflictError) as foreign:
        repo.create_row(TOKEN, "companies", TENANT, {"id": str(uuid.uuid4()), "name": "Acme"})

    def mismatch_handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return pg_error(
                "23505", 'duplicate key value violates unique constraint "companies_pkey"', 409
            )
        return httpx.Response(200, json=[COMPANY_ROW])

    repo2, _ = repo_with(mismatch_handler)
    with pytest.raises(r.ConflictError) as same_tenant:
        repo2.create_row(
            TOKEN,
            "companies",
            TENANT,
            {"id": COMPANY_ROW["id"], "name": "Other", "type": "prospect", "tags": []},
        )
    assert type(foreign.value) is type(same_tenant.value)
    assert str(foreign.value) == str(same_tenant.value)


# ==== classification ====
@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (
            409,
            {
                "code": "23505",
                "message": 'duplicate key value violates unique constraint "companies_pkey"',
            },
            r.ConflictError,
        ),
        (
            409,
            {
                "code": "23505",
                "message": 'violates unique constraint "contacts_tenant_email_key"',
            },
            r.DuplicateValueError,
        ),
        (
            409,
            {
                "code": "23505",
                "message": 'violates unique constraint "products_tenant_id_sku_key"',
            },
            r.DuplicateValueError,
        ),
        (
            409,
            {
                "code": "23503",
                "message": 'insert or update on table "leads" violates foreign key constraint "x"',
            },
            r.InvalidReferenceError,
        ),
        (
            400,
            {
                "code": "23514",
                "message": 'new row for relation "leads" violates check constraint "leads_check"',
            },
            r.InvalidValueError,
        ),
        (
            400,
            {"code": "SM001", "message": "won and lost are terminal: reopen the opportunity first"},
            r.InvalidTransitionError,
        ),
        (
            400,
            {"code": "SM002", "message": "contact is suppressed; lift the suppression first"},
            r.ContactSuppressedError,
        ),
        # no message-text matching: the same words under an ordinary code are just invalid
        (
            400,
            {"code": "23514", "message": "won and lost are terminal: reopen the opportunity first"},
            r.InvalidValueError,
        ),
        (
            403,
            {"code": "42501", "message": "only an owner or admin can reopen a closed opportunity"},
            Forbidden,
        ),
        (
            403,
            {
                "code": "42501",
                "message": 'new row violates row-level security policy for table "companies"',
            },
            Forbidden,
        ),
        (401, {"code": "PGRST303", "message": "JWT expired"}, TokenRejected),
        (400, {"code": "P0002", "message": "contact not found"}, r.NotFoundError),
        (
            400,
            {"code": "22023", "message": "granting consent requires a basis"},
            r.InvalidValueError,
        ),
        (
            400,
            {"code": "22P02", "message": "invalid input syntax for type uuid"},
            r.InvalidValueError,
        ),
        (500, {"code": "XX000", "message": "boom"}, UpstreamError),
        (404, {"code": "PGRST202", "message": "no function"}, UpstreamError),
        (502, None, UpstreamError),
    ],
)
def test_data_layer_errors_are_classified(
    status: int, body: Any, expected: type[Exception]
) -> None:
    assert type(r.classify_error(status, body)) is expected


def test_duplicate_value_names_only_the_field() -> None:
    err = r.classify_error(
        409,
        {
            "code": "23505",
            "message": 'duplicate key value violates unique constraint "contacts_tenant_email_key"',
            "details": CANARY,
        },
    )
    assert isinstance(err, r.DuplicateValueError) and err.field == "email"
    assert CANARY not in str(err) and CANARY not in repr(err)


# ==== personal data never escapes (the canary) ====
def _hostile_error(req: httpx.Request) -> httpx.Response:
    """What PostgREST really sends: the Postgres text, with the row's personal data inside."""
    return pg_error(
        "23505",
        'duplicate key value violates unique constraint "contacts_tenant_email_key" '
        f"for {CANARY_NAME}",
        409,
        f"Key (tenant_id, lower(email::text))=(x, {CANARY}) already exists. "
        f"Failing row contains ({CANARY_NAME}, {CANARY}).",
    )


@pytest.mark.parametrize(
    ("code", "message"),
    [
        ("23505", 'duplicate key value violates unique constraint "contacts_tenant_email_key"'),
        ("23505", 'duplicate key value violates unique constraint "contacts_pkey"'),
        ("23503", 'insert or update on table "leads" violates foreign key constraint "leads_fkey"'),
        (
            "23514",
            'new row for relation "contacts" violates check constraint "contacts_email_check"',
        ),
        ("23514", "won and lost are terminal: reopen the opportunity first"),
        ("42501", "permission denied"),
        ("22023", "invalid parameter"),
        ("XX000", "internal"),
    ],
)
def test_no_error_response_or_log_line_ever_contains_the_row(
    caplog: pytest.LogCaptureFixture, code: str, message: str
) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return pg_error(
            code,
            f"{message} {CANARY} {CANARY_NAME}",
            409,
            f"Key=({CANARY}) Failing row contains ({CANARY_NAME}, {CANARY})",
        )

    repo, _ = repo_with(handler)
    client, _ = make_client(crm=repo)  # type: ignore[arg-type]
    caplog.set_level(logging.DEBUG)
    cid = str(uuid.uuid4())
    responses = [
        client.post(
            f"/v1/tenants/{TENANT_A.id}/contacts",
            headers=auth("a_owner"),
            json={"id": cid, "full_name": CANARY_NAME, "email": CANARY},
        ),
        client.patch(
            f"/v1/tenants/{TENANT_A.id}/contacts/{cid}",
            headers=auth("a_owner"),
            json={"email": CANARY},
        ),
        client.get(f"/v1/tenants/{TENANT_A.id}/contacts", headers=auth("a_owner")),
        client.get(f"/v1/tenants/{TENANT_A.id}/companies?q={CANARY_NAME}", headers=auth("a_owner")),
        client.post(
            f"/v1/tenants/{TENANT_A.id}/contacts/{cid}/suppress",
            headers=auth("a_owner"),
            json={"reason": "manual"},
        ),
    ]
    blob = "\n".join(
        [x.text for x in responses]
        + [str(dict(x.headers)) for x in responses]
        + [rec.getMessage() for rec in caplog.records]
        + [str(getattr(rec, "exc_text", "")) for rec in caplog.records]
    )
    assert CANARY not in blob and CANARY_NAME not in blob
    assert "canary" not in blob.lower() and "zq91" not in blob.lower()
    for response in responses:
        body = response.json()
        assert set(body) == {"error"} and set(body["error"]) <= {"code", "message"}


def test_an_unreachable_data_layer_logs_the_class_only(caplog: pytest.LogCaptureFixture) -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"refused for {req.url} {CANARY}")

    repo, _ = repo_with(boom)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(UpstreamError) as info:
        repo.list_rows(
            TOKEN, "companies", TENANT, limit=5, cursor=None, q=CANARY_NAME, include_archived=False
        )
    assert CANARY not in str(info.value) and CANARY_NAME not in str(info.value)
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert CANARY not in caplog.text and CANARY_NAME not in caplog.text


def test_a_row_that_does_not_fit_the_model_is_dropped_not_echoed(
    caplog: pytest.LogCaptureFixture,
) -> None:
    bad = {**COMPANY_ROW, "name": CANARY_NAME, "tags": "not-a-list", "surprise": CANARY}
    repo, _ = repo_with(lambda req: httpx.Response(200, json=[bad]))
    caplog.set_level(logging.DEBUG)
    with pytest.raises(UpstreamError) as info:
        repo.get_row(TOKEN, "companies", TENANT, uuid.uuid4())
    assert CANARY not in str(info.value) and CANARY_NAME not in str(info.value)
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert CANARY not in caplog.text and CANARY_NAME not in caplog.text


def test_pydantic_validation_text_is_not_logged_by_the_route_layer(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client, _ = make_client(crm=FakeCrmRepository())
    caplog.set_level(logging.DEBUG)
    response = client.post(
        f"/v1/tenants/{TENANT_A.id}/contacts",
        headers=auth("a_owner"),
        json={
            "id": str(uuid.uuid4()),
            "full_name": CANARY_NAME,
            "email": f"{CANARY} nope",
            "bogus": CANARY,
        },
    )
    assert response.status_code == 422
    assert CANARY not in response.text and CANARY_NAME not in response.text
    assert CANARY not in caplog.text and CANARY_NAME not in caplog.text


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (409, "23505"),
        (409, "23503"),
        (400, "23514"),
        (403, "42501"),
        (401, "PGRST303"),
        (400, "P0002"),
        (400, "22023"),
        (500, "XX000"),
        (404, "PGRST202"),
        (400, "99999"),
    ],
)
def test_no_classified_exception_carries_any_part_of_the_database_text(
    status: int, code: str
) -> None:
    body = {
        "code": code,
        "message": f'violates constraint "contacts_tenant_email_key" {CANARY} {CANARY_NAME}',
        "details": f"Key (email)=({CANARY}) Failing row contains ({CANARY_NAME})",
        "hint": CANARY,
    }
    err = r.classify_error(status, body)
    for text in (str(err), repr(err), str(err.args)):
        assert CANARY not in text and CANARY_NAME not in text and "canary" not in text.lower()


# ==== claims (inputs of the ICP score) ====
def test_list_claims_is_tenant_scoped_user_jwt_only_and_returns_the_scoring_fields() -> None:
    company = uuid.uuid4()
    rows = [
        {"id": str(uuid.uuid4()), "company_id": str(company), "predicate": "buyer_type",
         "value": "saree_shop", "confidence": "unverified"},
    ]
    repo, seen = repo_with(lambda req: httpx.Response(200, json=rows))
    got = repo.list_claims(TOKEN, TENANT, company_id=company)
    assert got == rows
    (req,) = seen
    # scoring input: manual / import claims and ACCEPTED agent claims (the view)
    assert req.url.path.endswith("/claims_for_scoring")
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert req.headers["apikey"] == ANON
    q = dict(req.url.params)
    assert q["tenant_id"] == f"eq.{TENANT}" and q["company_id"] == f"eq.{company}"
    assert "archived_at" not in q, "the view has no such column; it returns live claims only"
    assert q["order"] == "created_at.desc,id.desc"
    assert set(q["select"].split(",")) == {"id", "company_id", "predicate", "value", "confidence"}


def test_list_claims_failures_are_classified_like_every_other_read() -> None:
    repo, _ = repo_with(lambda req: pg_error("42501", "permission denied", 403))
    with pytest.raises(Forbidden):
        repo.list_claims(TOKEN, TENANT, company_id=uuid.uuid4())
    repo, _ = repo_with(lambda req: httpx.Response(200, json={"not": "a list"}))
    with pytest.raises(UpstreamError):
        repo.list_claims(TOKEN, TENANT, company_id=uuid.uuid4())
