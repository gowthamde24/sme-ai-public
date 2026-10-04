"""HTTP behaviour of the CRM endpoints with an in-memory data layer: the authorization order
(401 -> 404 for foreign tenants -> 403 for too-low roles), request validation, idempotent create,
archive rules, pagination, consent endpoints. The real database rules are covered by the
integration suite and the pgTAP suite."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fastapi.testclient import TestClient

from tests.fakes import TENANT_A, TENANT_B, FakeCrmRepository, auth, make_client

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[3] / "packages" / "contracts" / "crm.schema.json").read_text()
)

ROLES_A = ["a_owner", "a_admin", "a_sales", "a_viewer"]
READ_ROLES = ROLES_A
SALES_PLUS = ["a_owner", "a_admin", "a_sales"]
ADMIN_PLUS = ["a_owner", "a_admin"]

ENTITIES = ["companies", "contacts", "products", "leads", "opportunities"]
WRITERS = {
    "companies": SALES_PLUS,
    "contacts": SALES_PLUS,
    "products": ADMIN_PLUS,
    "leads": SALES_PLUS,
    "opportunities": SALES_PLUS,
}
OUT_DEF = {
    "companies": "CompanyOut",
    "contacts": "ContactOut",
    "products": "ProductOut",
    "leads": "LeadOut",
    "opportunities": "OpportunityOut",
}
PAGE_DEF = {k: f"Page_{v}_" for k, v in OUT_DEF.items()}
COMPANY_ID = str(uuid.uuid4())


def validate(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


def create_payload(entity: str, row_id: str | None = None) -> dict[str, Any]:
    rid = row_id or str(uuid.uuid4())
    return {
        "companies": {"id": rid, "name": "Acme Silks"},
        "contacts": {"id": rid, "full_name": "Pat Example", "email": f"{rid}@example.test"},
        "products": {"id": rid, "sku": f"S-{rid[:8]}", "name": "Kanjivaram"},
        "leads": {"id": rid},
        "opportunities": {"id": rid, "company_id": COMPANY_ID, "title": "Wedding order"},
    }[entity]


UPDATE_PAYLOAD = {
    "companies": {"name": "Acme Renamed"},
    "contacts": {"job_title": "Buyer"},
    "products": {"name": "Renamed"},
    "leads": {"source": "trade fair"},
    "opportunities": {"title": "Renamed"},
}


@pytest.fixture
def env() -> tuple[TestClient, FakeCrmRepository]:
    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    return client, crm


def url(entity: str, tenant: Any = TENANT_A.id, suffix: str = "") -> str:
    return f"/v1/tenants/{tenant}/{entity}{suffix}"


def seed(crm: FakeCrmRepository, entity: str, tenant: Any = TENANT_A.id) -> str:
    rid = uuid.uuid4()
    crm.seed(
        entity,
        tenant,
        rid,
        **{k: v for k, v in create_payload(entity, str(rid)).items() if k != "id"},
    )
    return str(rid)


# ==== authentication ====
@pytest.mark.parametrize("entity", ENTITIES)
def test_every_endpoint_requires_a_token(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, _ = env
    rid = str(uuid.uuid4())
    for method, path in [
        ("GET", url(entity)),
        ("POST", url(entity)),
        ("GET", url(entity, suffix=f"/{rid}")),
        ("PATCH", url(entity, suffix=f"/{rid}")),
        ("POST", url(entity, suffix=f"/{rid}/archive")),
        ("POST", url(entity, suffix=f"/{rid}/restore")),
    ]:
        assert client.request(method, path).status_code == 401, (method, path)


def test_consent_endpoints_require_a_token(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, _ = env
    rid = str(uuid.uuid4())
    for action in ("record-consent", "suppress", "lift-suppression"):
        assert client.post(url("contacts", suffix=f"/{rid}/{action}"), json={}).status_code == 401


# ==== tenant isolation: 404, never 403, never data ====
@pytest.mark.parametrize("entity", ENTITIES)
@pytest.mark.parametrize("user", ROLES_A + ["outsider"])
def test_a_foreign_tenant_is_404_on_every_endpoint_for_every_role(
    env: tuple[TestClient, FakeCrmRepository], entity: str, user: str
) -> None:
    client, crm = env
    foreign_id = seed(crm, entity, TENANT_B.id)  # a real row, in tenant B
    h = auth(user)
    before = len(crm.calls)
    bodies = []
    for method, path, body in [
        ("GET", url(entity, TENANT_B.id), None),
        ("POST", url(entity, TENANT_B.id), create_payload(entity)),
        ("GET", url(entity, TENANT_B.id, f"/{foreign_id}"), None),
        ("PATCH", url(entity, TENANT_B.id, f"/{foreign_id}"), UPDATE_PAYLOAD[entity]),
        ("POST", url(entity, TENANT_B.id, f"/{foreign_id}/archive"), None),
        ("POST", url(entity, TENANT_B.id, f"/{foreign_id}/restore"), None),
    ]:
        response = client.request(method, path, headers=h, json=body)
        assert response.status_code == 404, (method, path, response.status_code)
        bodies.append(response.text)
    assert len(set(bodies)) == 1, "every foreign-tenant answer is byte-identical"
    assert foreign_id not in " ".join(bodies)
    assert crm.calls[before:] == [], "the data layer was never reached"


@pytest.mark.parametrize("entity", ENTITIES)
def test_reaching_a_foreign_row_through_my_own_tenant_path_is_404(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    foreign_id = seed(crm, entity, TENANT_B.id)
    for method, suffix in [("GET", ""), ("PATCH", ""), ("POST", "/archive")]:
        response = client.request(
            method,
            url(entity, TENANT_A.id, f"/{foreign_id}{suffix}"),
            headers=auth("a_owner"),
            json=UPDATE_PAYLOAD[entity] if method == "PATCH" else None,
        )
        assert response.status_code == 404


@pytest.mark.parametrize("entity", ENTITIES)
def test_malformed_ids_are_404_not_500(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, _ = env
    for bad in ("not-a-uuid", "123", "%2e%2e", "%00", "x" * 200):
        assert client.get(url(entity, suffix=f"/{bad}"), headers=auth("a_owner")).status_code == 404


# ==== role matrix inside my tenant ====
@pytest.mark.parametrize("entity", ENTITIES)
@pytest.mark.parametrize("user", ROLES_A)
def test_role_matrix(env: tuple[TestClient, FakeCrmRepository], entity: str, user: str) -> None:
    client, crm = env
    h = auth(user)
    rid = seed(crm, entity)
    can_write = user in WRITERS[entity]
    can_archive = user in ADMIN_PLUS

    assert client.get(url(entity), headers=h).status_code == 200
    assert client.get(url(entity, suffix=f"/{rid}"), headers=h).status_code == 200

    created = client.post(url(entity), headers=h, json=create_payload(entity))
    assert created.status_code == (201 if can_write else 403), created.text
    updated = client.patch(url(entity, suffix=f"/{rid}"), headers=h, json=UPDATE_PAYLOAD[entity])
    assert updated.status_code == (200 if can_write else 403)
    archived = client.post(url(entity, suffix=f"/{rid}/archive"), headers=h)
    assert archived.status_code == (200 if can_archive else 403)
    if can_archive:
        restored = client.post(url(entity, suffix=f"/{rid}/restore"), headers=h)
        assert restored.status_code == 200
        assert restored.json()["archived_at"] is None


@pytest.mark.parametrize("entity", ENTITIES)
def test_a_403_never_touches_the_data_layer_for_writes(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    rid = seed(crm, entity)
    before = len(crm.calls)
    h = auth("a_viewer")
    client.post(url(entity), headers=h, json=create_payload(entity))
    client.patch(url(entity, suffix=f"/{rid}"), headers=h, json=UPDATE_PAYLOAD[entity])
    client.post(url(entity, suffix=f"/{rid}/archive"), headers=h)
    assert len(crm.calls) == before


# ==== request validation ====
@pytest.mark.parametrize("entity", ENTITIES)
@pytest.mark.parametrize(
    "field",
    [
        "created_by",
        "created_via",
        "closed_at",
        "tenant_id",
        "archived_at",
        "email_consent",
        "suppressed_at",
    ],
)
def test_server_owned_fields_are_rejected_on_create_and_update(
    env: tuple[TestClient, FakeCrmRepository], entity: str, field: str
) -> None:
    client, crm = env
    rid = seed(crm, entity)
    bad = client.post(
        url(entity), headers=auth("a_owner"), json={**create_payload(entity), field: "x"}
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "validation_error"
    assert "x" not in bad.json()["error"]["message"].split(":")[-1].replace(field, "")
    bad = client.patch(
        url(entity, suffix=f"/{rid}"),
        headers=auth("a_owner"),
        json={**UPDATE_PAYLOAD[entity], field: "x"},
    )
    assert bad.status_code == 422


def test_tenant_comes_from_the_path_and_a_body_tenant_is_refused(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    client, crm = env
    response = client.post(
        url("companies", TENANT_A.id),
        headers=auth("a_owner"),
        json={**create_payload("companies"), "tenant_id": str(TENANT_B.id)},
    )
    assert response.status_code == 422
    assert crm.calls == []


@pytest.mark.parametrize("entity", ENTITIES)
def test_create_requires_a_canonical_client_uuid(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, _ = env
    for bad in ("nope", "12345678123456781234567812345678", "", None):
        with_bad_id = {**create_payload(entity), "id": bad}
        assert (
            client.post(url(entity), headers=auth("a_owner"), json=with_bad_id).status_code == 422
        )
    without_id: dict[str, Any] = create_payload(entity)
    del without_id["id"]
    assert client.post(url(entity), headers=auth("a_owner"), json=without_id).status_code == 422


@pytest.mark.parametrize("entity", ENTITIES)
def test_empty_patch_is_rejected(env: tuple[TestClient, FakeCrmRepository], entity: str) -> None:
    client, crm = env
    rid = seed(crm, entity)
    response = client.patch(url(entity, suffix=f"/{rid}"), headers=auth("a_owner"), json={})
    assert response.status_code == 422


def test_validation_errors_name_fields_but_never_echo_values(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    client, _ = env
    canary = "canary.value.7731@example.test"
    response = client.post(
        url("contacts"),
        headers=auth("a_owner"),
        json={"id": str(uuid.uuid4()), "full_name": "x", "email": canary + " nope"},
    )
    assert response.status_code == 422
    assert canary not in response.text
    assert "email" in response.json()["error"]["message"]


def test_unknown_and_wrong_typed_json_are_422(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, _ = env
    h = auth("a_owner")
    bodies: tuple[Any, ...] = (
        [],
        "text",
        5,
        {"id": str(uuid.uuid4()), "name": ["a"]},
        {"id": str(uuid.uuid4()), "name": "x", "type": "bad"},
    )
    for body in bodies:
        assert client.post(url("companies"), headers=h, json=body).status_code == 422
    assert (
        client.post(
            url("companies"),
            headers={**h, "Content-Type": "application/json"},
            content=b"{not json",
        ).status_code
        == 422
    )


# ==== idempotency ====
@pytest.mark.parametrize("entity", ENTITIES)
def test_create_is_idempotent_by_client_uuid(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    h = auth("a_owner")
    payload = create_payload(entity)
    first = client.post(url(entity), headers=h, json=payload)
    second = client.post(url(entity), headers=h, json=payload)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json() == second.json()
    assert len(crm.rows[(entity, TENANT_A.id)]) == 1
    validate(first.json(), OUT_DEF[entity])

    changed = {
        **payload,
        **{
            "companies": {"name": "Different"},
            "contacts": {"full_name": "Different"},
            "products": {"name": "Different"},
            "leads": {"source": "Different"},
            "opportunities": {"title": "Different"},
        }[entity],
    }
    conflict = client.post(url(entity), headers=h, json=changed)
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "conflict"


@pytest.mark.parametrize("entity", ENTITIES)
def test_an_id_that_exists_in_another_tenant_gets_the_same_409_as_a_payload_mismatch(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    foreign_id = seed(crm, entity, TENANT_B.id)
    h = auth("a_owner")
    taken_elsewhere = client.post(url(entity), headers=h, json=create_payload(entity, foreign_id))

    own = create_payload(entity)
    assert client.post(url(entity), headers=h, json=own).status_code == 201
    mismatch = client.post(
        url(entity),
        headers=h,
        json={
            **own,
            **{
                "companies": {"name": "Other"},
                "contacts": {"full_name": "Other"},
                "products": {"name": "Other"},
                "leads": {"source": "Other"},
                "opportunities": {"title": "Other"},
            }[entity],
        },
    )
    assert taken_elsewhere.status_code == mismatch.status_code == 409
    assert taken_elsewhere.text == mismatch.text, "indistinguishable bodies"


# ==== archive rules ====
@pytest.mark.parametrize("entity", ENTITIES)
def test_archived_records_cannot_be_updated_until_restored(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    rid = seed(crm, entity)
    owner = auth("a_owner")
    assert client.post(url(entity, suffix=f"/{rid}/archive"), headers=owner).status_code == 200
    again = client.post(url(entity, suffix=f"/{rid}/archive"), headers=owner)
    assert again.status_code == 200 and again.json()["archived_at"] is not None  # idempotent
    blocked = client.patch(
        url(entity, suffix=f"/{rid}"), headers=owner, json=UPDATE_PAYLOAD[entity]
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "archived"
    # even an admin cannot edit it; a sales user cannot restore it
    assert (
        client.patch(
            url(entity, suffix=f"/{rid}"), headers=auth("a_admin"), json=UPDATE_PAYLOAD[entity]
        ).status_code
        == 409
    )
    assert (
        client.post(url(entity, suffix=f"/{rid}/restore"), headers=auth("a_sales")).status_code
        == 403
    )
    assert (
        client.post(url(entity, suffix=f"/{rid}/restore"), headers=auth("a_admin")).status_code
        == 200
    )
    assert client.patch(
        url(entity, suffix=f"/{rid}"), headers=owner, json=UPDATE_PAYLOAD[entity]
    ).status_code == (200)


def test_archived_rows_are_hidden_from_lists_unless_asked(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    client, crm = env
    keep, gone = seed(crm, "companies"), seed(crm, "companies")
    client.post(url("companies", suffix=f"/{gone}/archive"), headers=auth("a_owner"))
    default = client.get(url("companies"), headers=auth("a_viewer")).json()
    assert [r["id"] for r in default["items"]] == [keep]
    everything = client.get(
        url("companies") + "?include_archived=true", headers=auth("a_viewer")
    ).json()
    assert {r["id"] for r in everything["items"]} == {keep, gone}


# ==== pagination + filters ====
def test_keyset_pagination_walks_every_row_once(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, crm = env
    ids = {seed(crm, "companies") for _ in range(23)}
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        response = client.get(
            url("companies"),
            headers=auth("a_viewer"),
            params={"limit": 5, **({"cursor": cursor} if cursor else {})},
        )
        assert response.status_code == 200
        body = response.json()
        validate(body, PAGE_DEF["companies"])
        seen += [r["id"] for r in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert pages == 5
    assert len(seen) == len(set(seen)) == 23
    assert set(seen) == ids


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"limit": -1},
        {"limit": "x"},
        {"cursor": "garbage"},
        {"cursor": "x" * 400},
    ],
)
def test_bad_list_parameters_are_422(
    env: tuple[TestClient, FakeCrmRepository], params: dict[str, Any]
) -> None:
    client, _ = env
    assert client.get(url("companies"), headers=auth("a_owner"), params=params).status_code == 422


def test_default_and_maximum_page_size(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, crm = env
    for _ in range(120):
        seed(crm, "companies")
    assert len(client.get(url("companies"), headers=auth("a_owner")).json()["items"]) == 50
    assert (
        len(client.get(url("companies") + "?limit=100", headers=auth("a_owner")).json()["items"])
        == 100
    )


def test_only_companies_have_a_name_filter(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, crm = env
    crm.seed("companies", TENANT_A.id, uuid.uuid4(), name="Alpha Textiles")
    crm.seed("companies", TENANT_A.id, uuid.uuid4(), name="Beta Mills")
    names = [
        r["name"]
        for r in client.get(url("companies") + "?q=alpha", headers=auth("a_viewer")).json()["items"]
    ]
    assert names == ["Alpha Textiles"]
    seed(crm, "contacts")
    seed(crm, "contacts")
    assert (
        len(client.get(url("contacts") + "?q=zzz", headers=auth("a_viewer")).json()["items"]) == 2
    ), "q is ignored outside companies"


# ==== no deletes ====
@pytest.mark.parametrize("entity", ENTITIES)
def test_there_is_no_delete_endpoint(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    rid = seed(crm, entity)
    for path in (url(entity), url(entity, suffix=f"/{rid}")):
        assert client.delete(path, headers=auth("a_owner")).status_code == 405
    spec = client.get("/openapi.json").json()
    assert [p for p, ops in spec["paths"].items() if "delete" in ops] == []
    assert rid in {str(r.id) for r in crm.rows[(entity, TENANT_A.id)].values()}


# ==== consent ====
def test_consent_endpoints_roles_and_path_binding(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    client, crm = env
    cid = seed(crm, "contacts")
    grant = {
        "channel": "email",
        "status": "granted",
        "basis": "explicit_consent",
        "evidence_type": "web_form",
        "evidence_ref": "form:8841",
    }
    for user, code in (("a_viewer", 403), ("a_sales", 200), ("a_admin", 200), ("a_owner", 200)):
        assert (
            client.post(
                url("contacts", suffix=f"/{cid}/record-consent"), headers=auth(user), json=grant
            ).status_code
            == code
        ), user
    assert (
        client.post(
            url("contacts", suffix=f"/{cid}/suppress"),
            headers=auth("a_viewer"),
            json={"reason": "manual"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            url("contacts", suffix=f"/{cid}/suppress"),
            headers=auth("a_sales"),
            json={"reason": "opted_out"},
        ).status_code
        == 200
    )
    lift = {"evidence_type": "written", "evidence_ref": "letter:1"}
    assert (
        client.post(
            url("contacts", suffix=f"/{cid}/lift-suppression"), headers=auth("a_sales"), json=lift
        ).status_code
        == 403
    )
    assert (
        client.post(
            url("contacts", suffix=f"/{cid}/lift-suppression"), headers=auth("a_admin"), json=lift
        ).status_code
        == 200
    )
    # tenant and contact come from the PATH
    function, args = crm.last_rpc
    assert function == "lift_suppression"
    assert args["p_tenant_id"] == str(TENANT_A.id) and args["p_contact_id"] == cid


def test_consent_of_a_foreign_or_unknown_contact_is_404(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    client, crm = env
    foreign = seed(crm, "contacts", TENANT_B.id)
    body = {"channel": "email", "status": "withdrawn"}
    assert (
        client.post(
            url("contacts", TENANT_B.id, f"/{foreign}/record-consent"),
            headers=auth("a_owner"),
            json=body,
        ).status_code
        == 404
    )
    assert (
        client.post(
            url("contacts", TENANT_A.id, f"/{foreign}/record-consent"),
            headers=auth("a_owner"),
            json=body,
        ).status_code
        == 404
    )
    assert (
        client.post(
            url("contacts", TENANT_A.id, f"/{uuid.uuid4()}/record-consent"),
            headers=auth("a_owner"),
            json=body,
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "body",
    [
        {"channel": "email", "status": "granted"},
        {"channel": "sms", "status": "withdrawn"},
        {"channel": "email", "status": "unknown"},
        {"channel": "email", "status": "withdrawn", "tenant_id": str(TENANT_B.id)},
        {
            "channel": "email",
            "status": "granted",
            "basis": "explicit_consent",
            "evidence_type": "web_form",
            "evidence_ref": "no colon",
        },
        {"status": "withdrawn"},
        {},
    ],
)
def test_bad_consent_requests_are_422_and_call_nothing(
    env: tuple[TestClient, FakeCrmRepository], body: dict[str, Any]
) -> None:
    client, crm = env
    cid = seed(crm, "contacts")
    before = len(crm.calls)
    response = client.post(
        url("contacts", suffix=f"/{cid}/record-consent"), headers=auth("a_owner"), json=body
    )
    assert response.status_code == 422
    assert len(crm.calls) == before


def test_consent_result_matches_the_contract(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, crm = env
    cid = seed(crm, "contacts")
    response = client.post(
        url("contacts", suffix=f"/{cid}/record-consent"),
        headers=auth("a_owner"),
        json={"channel": "email", "status": "withdrawn"},
    )
    validate(response.json(), "ConsentResultOut")


# ==== the contract ====
@pytest.mark.parametrize("entity", ENTITIES)
def test_responses_match_the_generated_json_schema(
    env: tuple[TestClient, FakeCrmRepository], entity: str
) -> None:
    client, crm = env
    rid = seed(crm, entity)
    validate(
        client.get(url(entity, suffix=f"/{rid}"), headers=auth("a_viewer")).json(), OUT_DEF[entity]
    )
    validate(client.get(url(entity), headers=auth("a_viewer")).json(), PAGE_DEF[entity])


def test_only_the_callers_own_token_reaches_the_data_layer(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    client, crm = env
    h = auth("a_sales")
    client.get(url("companies"), headers=h)
    client.post(url("companies"), headers=h, json=create_payload("companies"))
    assert set(crm.tokens_seen) == {h["Authorization"].removeprefix("Bearer ")}


def test_openapi_documents_every_request_model(env: tuple[TestClient, FakeCrmRepository]) -> None:
    client, _ = env
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    for name in (
        "CompanyCreate",
        "ContactUpdate",
        "ProductCreate",
        "LeadUpdate",
        "OpportunityUpdate",
        "RecordConsentIn",
        "SuppressIn",
        "LiftSuppressionIn",
    ):
        assert name in schemas and schemas[name].get("additionalProperties") is False, name


def test_a_grant_for_a_suppressed_contact_is_a_stable_409(
    env: tuple[TestClient, FakeCrmRepository],
) -> None:
    from app.crm.repository import ContactSuppressedError, InvalidTransitionError

    client, crm = env
    cid = seed(crm, "contacts")
    grant = {
        "channel": "email",
        "status": "granted",
        "basis": "explicit_consent",
        "evidence_type": "web_form",
        "evidence_ref": "form:1",
    }
    crm.rpc_error = ContactSuppressedError("SM002")
    response = client.post(
        url("contacts", suffix=f"/{cid}/record-consent"), headers=auth("a_sales"), json=grant
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "contact_suppressed"
    crm.rpc_error = InvalidTransitionError("SM001")
    response = client.post(
        url("contacts", suffix=f"/{cid}/suppress"),
        headers=auth("a_sales"),
        json={"reason": "manual"},
    )
    assert (response.status_code, response.json()["error"]["code"]) == (409, "invalid_transition")
