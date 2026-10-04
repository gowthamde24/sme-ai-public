"""HTTP behaviour of the evidence endpoints with an in-memory data layer: the authorization order
(401 -> 404 for foreign tenants -> 403 for too-low roles -> 404 for an unknown / foreign target),
request validation, idempotent create (201 / 200 / 409), archive rules, pagination. The real
database rules are covered by the integration suite and the pgTAP suite."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from tests.fakes import (
    TENANT_A,
    TENANT_B,
    FakeCrmRepository,
    FakeEvidenceRepository,
    auth,
    make_client,
)

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[3] / "packages" / "contracts" / "evidence.schema.json"
    ).read_text()
)

ROLES_A = ["a_owner", "a_admin", "a_sales", "a_viewer"]
SALES_PLUS = ["a_owner", "a_admin", "a_sales"]
ADMIN_PLUS = ["a_owner", "a_admin"]
SEGMENTS = ["companies", "leads"]
CANARY_URL = "https://canary-host-qq77.example/in/jane-canary?token=canary-qq77"
CANARY_SNIPPET = "Canary Qq77 said something personal"


def validate(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


class Env:
    def __init__(self) -> None:
        self.crm = FakeCrmRepository()
        self.evidence = FakeEvidenceRepository()
        self.client, _ = make_client(crm=self.crm, evidence=self.evidence)
        self.targets: dict[tuple[str, uuid.UUID], str] = {}

    def target(self, segment: str, tenant: Any = TENANT_A.id, **fields: Any) -> str:
        rid = uuid.uuid4()
        data = {"name": "Acme"} if segment == "companies" else {}
        self.crm.seed(segment, tenant, rid, **data, **fields)
        return str(rid)

    def url(self, segment: str, target: str, tenant: Any = TENANT_A.id, suffix: str = "") -> str:
        return f"/v1/tenants/{tenant}/{segment}/{target}/evidence{suffix}"

    def post(
        self, user: str, segment: str, target: str, body: dict[str, Any], tenant: Any = TENANT_A.id
    ) -> Any:
        return self.client.post(self.url(segment, target, tenant), json=body, headers=auth(user))


@pytest.fixture
def env() -> Env:
    return Env()


def body(**over: Any) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "kind": "web_page",
        "url": "https://example.test/a",
        "snippet": "text",
        **over,
    }


# ==== authentication and tenancy ====
@pytest.mark.parametrize("segment", SEGMENTS)
def test_every_endpoint_requires_a_token(env: Env, segment: str) -> None:
    t = env.target(segment)
    link = uuid.uuid4()
    assert env.client.get(env.url(segment, t)).status_code == 401
    assert env.client.post(env.url(segment, t), json=body()).status_code == 401
    for action in ("archive", "restore"):
        assert (
            env.client.post(f"/v1/tenants/{TENANT_A.id}/evidence-links/{link}/{action}").status_code
            == 401
        )
    assert env.evidence.calls == []


@pytest.mark.parametrize("segment", SEGMENTS)
@pytest.mark.parametrize("user", [*ROLES_A, "outsider"])
def test_a_foreign_tenant_is_404_on_every_endpoint_for_every_role(
    env: Env, segment: str, user: str
) -> None:
    t = env.target(segment, TENANT_B.id)
    link = uuid.uuid4()
    h = auth(user)
    responses = [
        env.client.get(env.url(segment, t, TENANT_B.id), headers=h),
        env.client.post(env.url(segment, t, TENANT_B.id), json=body(), headers=h),
        env.client.post(f"/v1/tenants/{TENANT_B.id}/evidence-links/{link}/archive", headers=h),
        env.client.post(f"/v1/tenants/{TENANT_B.id}/evidence-links/{link}/restore", headers=h),
    ]
    assert [r.status_code for r in responses] == [404, 404, 404, 404]
    assert len({r.text for r in responses}) == 1, "every foreign-tenant answer is identical"
    assert env.evidence.calls == [], "nothing reached the data layer"


def test_reaching_another_tenants_target_through_my_own_tenant_path_is_404(env: Env) -> None:
    foreign_company = env.target("companies", TENANT_B.id)
    foreign_lead = env.target("leads", TENANT_B.id)
    for segment, t in (("companies", foreign_company), ("leads", foreign_lead)):
        get = env.client.get(env.url(segment, t), headers=auth("a_owner"))
        post = env.post("a_owner", segment, t, body())
        assert (get.status_code, post.status_code) == (404, 404)
        assert (
            get.json() == post.json() == {"error": {"code": "not_found", "message": "Not found."}}
        )
    assert env.evidence.calls == [], "the target is looked up first: no evidence call happened"


@pytest.mark.parametrize("segment", SEGMENTS)
def test_unknown_and_malformed_targets_are_404_and_identical(env: Env, segment: str) -> None:
    answers = set()
    for raw in [str(uuid.uuid4()), "not-a-uuid", "0" * 32, "urn:uuid:" + str(uuid.uuid4()), "1"]:
        g = env.client.get(env.url(segment, raw), headers=auth("a_owner"))
        p = env.post("a_owner", segment, raw, body())
        assert (g.status_code, p.status_code) == (404, 404), raw
        answers.add(g.text + p.text)
    assert len(answers) == 1
    assert env.evidence.calls == []


def test_malformed_link_ids_are_404(env: Env) -> None:
    for action in ("archive", "restore"):
        r = env.client.post(
            f"/v1/tenants/{TENANT_A.id}/evidence-links/nope/{action}", headers=auth("a_admin")
        )
        assert r.status_code == 404
    assert env.evidence.calls == []


# ==== roles ====
@pytest.mark.parametrize("segment", SEGMENTS)
@pytest.mark.parametrize("user", ROLES_A)
def test_role_matrix(env: Env, segment: str, user: str) -> None:
    t = env.target(segment)
    assert env.client.get(env.url(segment, t), headers=auth(user)).status_code == 200
    created = env.post(user, segment, t, body())
    assert created.status_code == (201 if user in SALES_PLUS else 403)
    if user not in SALES_PLUS:
        assert created.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize("user", ROLES_A)
def test_archive_and_restore_are_admin_plus(env: Env, user: str) -> None:
    t = env.target("companies")
    link_id = env.post("a_owner", "companies", t, body()).json()["id"]
    archive = env.client.post(
        f"/v1/tenants/{TENANT_A.id}/evidence-links/{link_id}/archive", headers=auth(user)
    )
    assert archive.status_code == (200 if user in ADMIN_PLUS else 403)
    restore = env.client.post(
        f"/v1/tenants/{TENANT_A.id}/evidence-links/{link_id}/restore", headers=auth(user)
    )
    assert restore.status_code == (200 if user in ADMIN_PLUS else 403)


def test_a_403_never_touches_the_data_layer(env: Env) -> None:
    t = env.target("companies")
    before = list(env.evidence.calls)
    env.post("a_viewer", "companies", t, body())
    env.client.post(
        f"/v1/tenants/{TENANT_A.id}/evidence-links/{uuid.uuid4()}/archive", headers=auth("a_sales")
    )
    assert env.evidence.calls == before


# ==== request validation ====
@pytest.mark.parametrize(
    "field",
    [
        "provider",
        "created_by",
        "created_via",
        "created_at",
        "tenant_id",
        "archived_at",
        "company_id",
        "lead_id",
        "claim_id",
        "stance",
        "supersedes_id",
    ],
)
def test_forbidden_fields_are_422_and_call_nothing(env: Env, field: str) -> None:
    t = env.target("companies")
    r = env.post("a_owner", "companies", t, body(**{field: str(uuid.uuid4())}))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert field in r.json()["error"]["message"]
    assert env.evidence.calls == []


def test_provider_is_set_by_the_api_never_by_the_client(env: Env) -> None:
    t = env.target("companies")
    r = env.post("a_sales", "companies", t, body())
    assert r.status_code == 201 and r.json()["evidence"]["provider"] == "manual"
    assert "provider" not in env.evidence.payloads[0], "the route does not even pass one"


def test_the_target_comes_from_the_path(env: Env) -> None:
    t = env.target("leads")
    r = env.post("a_sales", "leads", t, body())
    assert (
        r.json()["lead_id"] == t and r.json()["company_id"] is None and r.json()["claim_id"] is None
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"url": "javascript:alert(1)"},
        {"url": "https://user:pw@example.test/"},
        {"url": "https://example.test/​"},
        {"snippet": "x" * 1001},
        {"snippet": "a‮b"},
        {"snippet": "a\U000e0020b"},
        {"snippet": ""},
        {"reference": "not a ref"},
        {"kind": "carrier_pigeon"},
        {"retrieved_at": "yesterday"},
        {"retrieved_at": "2026-01-01T00:00:00", "published_at": None},
        {"id": "nope"},
        {"id": None},
    ],
)
def test_invalid_bodies_are_422(env: Env, bad: dict[str, Any]) -> None:
    t = env.target("companies")
    r = env.post("a_owner", "companies", t, body(**bad))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert env.evidence.calls == []


def test_a_source_without_url_or_reference_is_422(env: Env) -> None:
    t = env.target("companies")
    r = env.client.post(
        env.url("companies", t),
        json={"id": str(uuid.uuid4()), "kind": "note", "snippet": "text"},
        headers=auth("a_owner"),
    )
    assert r.status_code == 422


def test_validation_errors_name_fields_but_never_echo_values(env: Env) -> None:
    t = env.target("companies")
    r = env.post(
        "a_owner",
        "companies",
        t,
        body(url=CANARY_URL + " nope", snippet=CANARY_SNIPPET + "​", bogus=CANARY_SNIPPET),
    )
    assert r.status_code == 422
    text = r.text.lower()
    assert "canary" not in text and "qq77" not in text and "nope" not in text
    assert "url" in text and "snippet" in text


def test_invalid_json_and_wrong_types_are_422(env: Env) -> None:
    t = env.target("companies")
    h = {**auth("a_owner"), "Content-Type": "application/json"}
    for content in (b"{", b"[]", b'"x"', b"null", b'{"id": 1}'):
        assert (
            env.client.post(env.url("companies", t), content=content, headers=h).status_code == 422
        )
    assert env.evidence.calls == []


# ==== create / idempotency ====
@pytest.mark.parametrize("segment", SEGMENTS)
def test_create_then_retry_then_conflict(env: Env, segment: str) -> None:
    t = env.target(segment)
    payload = body()
    first = env.post("a_sales", segment, t, payload)
    assert first.status_code == 201
    again = env.post("a_sales", segment, t, payload)
    assert again.status_code == 200 and again.json() == first.json()
    different = env.post("a_sales", segment, t, {**payload, "snippet": "something else"})
    assert different.status_code == 409 and different.json()["error"]["code"] == "conflict"
    listed = env.client.get(env.url(segment, t), headers=auth("a_viewer")).json()
    assert len(listed["items"]) == 1, "the retry created no duplicate"


def test_an_id_owned_by_another_tenant_gets_the_identical_409(env: Env) -> None:
    mine = env.target("companies")
    theirs = env.target("companies", TENANT_B.id)
    payload = body()
    # tenant B owns this evidence id
    env.evidence.create_for_target(
        "seed", TENANT_B.id, "company", uuid.UUID(theirs), {**payload, "kind": "web_page"}
    )
    foreign = env.post("a_owner", "companies", mine, payload)
    mismatch_payload = body()
    assert env.post("a_owner", "companies", mine, mismatch_payload).status_code == 201
    mismatch = env.post("a_owner", "companies", mine, {**mismatch_payload, "snippet": "changed"})
    assert foreign.status_code == mismatch.status_code == 409
    assert foreign.json() == mismatch.json(), (
        "foreign id and payload mismatch are indistinguishable"
    )


def test_the_same_evidence_id_cannot_be_attached_to_a_second_target(env: Env) -> None:
    a, b = env.target("companies"), env.target("companies")
    payload = body()
    assert env.post("a_owner", "companies", a, payload).status_code == 201
    assert env.post("a_owner", "companies", b, payload).status_code == 409


def test_an_archived_target_refuses_new_evidence(env: Env) -> None:
    t = env.target("companies", archived_at=None)
    env.crm.set_archived("x", "companies", TENANT_A.id, uuid.UUID(t), True)
    r = env.post("a_owner", "companies", t, body())
    assert r.status_code == 409 and r.json()["error"]["code"] == "archived"
    assert env.evidence.calls == []
    assert env.client.get(env.url("companies", t), headers=auth("a_viewer")).status_code == 200


def test_retrieved_at_is_optional_and_published_at_stays_null(env: Env) -> None:
    t = env.target("companies")
    r = env.post("a_owner", "companies", t, body())
    ev = r.json()["evidence"]
    assert ev["retrieved_at"] and ev["published_at"] is None


def test_supplied_dates_are_kept(env: Env) -> None:
    t = env.target("companies")
    r = env.post(
        "a_owner",
        "companies",
        t,
        body(retrieved_at="2026-01-02T03:04:05Z", published_at="2026-01-01T00:00:00Z"),
    )
    ev = r.json()["evidence"]
    assert ev["retrieved_at"].startswith("2026-01-02T03:04:05") and ev["published_at"].startswith(
        "2026-01-01"
    )


# ==== data-layer failures map to stable codes ====
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        ("invalid_value", 422, "invalid_value"),
        ("invalid_reference", 422, "invalid_reference"),
        ("forbidden", 403, "forbidden"),
        ("conflict", 409, "conflict"),
        ("upstream", 502, "upstream_error"),
    ],
)
def test_data_layer_errors_have_stable_generic_bodies(
    env: Env, error: str, status: int, code: str
) -> None:
    from app.crm import repository as c
    from app.tenancy.repository import Forbidden, UpstreamError

    errors = {
        "invalid_value": c.InvalidValueError("23514"),
        "invalid_reference": c.InvalidReferenceError("23503"),
        "forbidden": Forbidden("42501"),
        "conflict": c.ConflictError("23505"),
        "upstream": UpstreamError("x"),
    }
    t = env.target("companies")
    env.evidence.error = errors[error]
    r = env.post("a_owner", "companies", t, body(url=CANARY_URL))
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert "canary" not in r.text.lower() and "qq77" not in r.text.lower()
    assert set(r.json()["error"]) == {"code", "message"}


# ==== list ====
def test_keyset_pagination_walks_every_link_once(env: Env) -> None:
    t = env.target("companies")
    created = [env.post("a_owner", "companies", t, body()).json()["id"] for _ in range(23)]
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 5}
        if cursor:
            params["cursor"] = cursor
        page = env.client.get(
            env.url("companies", t), params=params, headers=auth("a_viewer")
        ).json()
        seen += [i["id"] for i in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert pages == 5 and len(seen) == len(set(seen)) == 23
    assert seen == list(reversed(created)), "newest first"


def test_default_and_maximum_page_size(env: Env) -> None:
    t = env.target("companies")
    for _ in range(3):
        env.post("a_owner", "companies", t, body())
    h = auth("a_viewer")
    assert (
        env.client.get(env.url("companies", t), params={"limit": 100}, headers=h).status_code == 200
    )
    for bad in (0, 101, -1, "x"):
        assert (
            env.client.get(env.url("companies", t), params={"limit": bad}, headers=h).status_code
            == 422
        )


def test_bad_cursors_are_422(env: Env) -> None:
    t = env.target("companies")
    for cursor in ("garbage", "e30", "a" * 400, "Zm9vYmFy"):
        assert (
            env.client.get(
                env.url("companies", t), params={"cursor": cursor}, headers=auth("a_viewer")
            ).status_code
            == 422
        )


def test_archived_links_are_hidden_unless_asked_for(env: Env) -> None:
    t = env.target("companies")
    link_id = env.post("a_owner", "companies", t, body()).json()["id"]
    kept = env.post("a_owner", "companies", t, body()).json()["id"]
    assert (
        env.client.post(
            f"/v1/tenants/{TENANT_A.id}/evidence-links/{link_id}/archive", headers=auth("a_admin")
        ).status_code
        == 200
    )
    h = auth("a_viewer")
    visible = [i["id"] for i in env.client.get(env.url("companies", t), headers=h).json()["items"]]
    assert visible == [kept]
    everything = [
        i["id"]
        for i in env.client.get(
            env.url("companies", t), params={"include_archived": "true"}, headers=h
        ).json()["items"]
    ]
    assert set(everything) == {link_id, kept}


def test_a_list_contains_only_this_targets_links(env: Env) -> None:
    a, b = env.target("companies"), env.target("companies")
    env.post("a_owner", "companies", a, body())
    env.post("a_owner", "companies", b, body())
    items = env.client.get(env.url("companies", a), headers=auth("a_viewer")).json()["items"]
    assert len(items) == 1 and items[0]["company_id"] == a


# ==== archive / restore ====
def test_archive_restore_are_idempotent_and_return_the_link(env: Env) -> None:
    t = env.target("leads")
    link = env.post("a_owner", "leads", t, body()).json()
    base = f"/v1/tenants/{TENANT_A.id}/evidence-links/{link['id']}"
    h = auth("a_admin")
    assert (
        env.client.post(f"{base}/restore", headers=h).json()["archived_at"] is None
    )  # already active
    first = env.client.post(f"{base}/archive", headers=h)
    assert first.status_code == 200 and first.json()["archived_at"] is not None
    assert env.client.post(f"{base}/archive", headers=h).json() == first.json()
    back = env.client.post(f"{base}/restore", headers=h)
    assert back.status_code == 200 and back.json()["archived_at"] is None
    assert env.evidence.calls.count("archive") == 1 and env.evidence.calls.count("restore") == 1


def test_archiving_an_unknown_or_foreign_link_is_404(env: Env) -> None:
    link = env.post("a_owner", "companies", env.target("companies"), body()).json()["id"]
    for tenant in (TENANT_A.id,):
        r = env.client.post(
            f"/v1/tenants/{tenant}/evidence-links/{uuid.uuid4()}/archive", headers=auth("a_admin")
        )
        assert r.status_code == 404
    # tenant B's admin cannot reach tenant A's link through B's own path
    r = env.client.post(
        f"/v1/tenants/{TENANT_B.id}/evidence-links/{link}/archive", headers=auth("b_owner")
    )
    assert r.status_code == 404


# ==== surface ====
def test_there_is_no_delete_put_patch_or_claims_endpoint(env: Env) -> None:
    t = env.target("companies")
    link = env.post("a_owner", "companies", t, body()).json()["id"]
    h = auth("a_owner")
    paths = [env.url("companies", t), f"/v1/tenants/{TENANT_A.id}/evidence-links/{link}"]
    for method in ("DELETE", "PUT", "PATCH"):
        for path in paths:
            assert env.client.request(method, path, headers=h).status_code in (404, 405), (
                method,
                path,
            )
    for path in (
        f"/v1/tenants/{TENANT_A.id}/claims",
        f"/v1/tenants/{TENANT_A.id}/evidence",
        f"/v1/tenants/{TENANT_A.id}/evidence-links",
        f"/v1/tenants/{TENANT_A.id}/contacts/{t}/evidence",
        f"/v1/tenants/{TENANT_A.id}/opportunities/{t}/evidence",
    ):
        assert env.client.get(path, headers=h).status_code in (404, 405), path


def test_responses_match_the_generated_json_schema(env: Env) -> None:
    t = env.target("companies")
    created = env.post(
        "a_owner", "companies", t, body(reference="doc:abc-1", published_at="2026-01-01T00:00:00Z")
    )
    validate(created.json(), "EvidenceLinkOut")
    validate(
        env.client.get(env.url("companies", t), headers=auth("a_viewer")).json(),
        "Page_EvidenceLinkOut_",
    )


def test_only_the_callers_own_token_reaches_the_data_layer(env: Env) -> None:
    t = env.target("companies")
    h = auth("a_owner")
    env.client.post(env.url("companies", t), json=body(), headers=h)
    env.client.get(env.url("companies", t), headers=h)
    token = h["Authorization"].split(" ", 1)[1]
    assert env.evidence.tokens_seen and set(env.evidence.tokens_seen) == {token}


def test_openapi_documents_the_evidence_request_model(env: Env) -> None:
    spec = env.client.get("/openapi.json").json()
    schema = spec["components"]["schemas"]["EvidenceCreate"]
    assert schema["additionalProperties"] is False
    assert not set(schema["properties"]) & {
        "provider",
        "created_by",
        "created_via",
        "tenant_id",
        "archived_at",
    }
