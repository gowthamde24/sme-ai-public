"""Request/response models: what a client can and cannot say."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.crm import models as m

UID = str(uuid.uuid4())
COMPANY = str(uuid.uuid4())

CREATE_MODELS: dict[str, tuple[type[BaseModel], dict[str, Any]]] = {
    "company": (m.CompanyCreate, {"id": UID, "name": "Acme"}),
    "contact": (m.ContactCreate, {"id": UID, "full_name": "Pat"}),
    "product": (m.ProductCreate, {"id": UID, "sku": "S-1", "name": "Saree"}),
    "lead": (m.LeadCreate, {"id": UID}),
    "opportunity": (m.OpportunityCreate, {"id": UID, "company_id": COMPANY, "title": "Deal"}),
}
UPDATE_MODELS: dict[str, tuple[type[BaseModel], dict[str, Any]]] = {
    "company": (m.CompanyUpdate, {"name": "Acme"}),
    "contact": (m.ContactUpdate, {"full_name": "Pat"}),
    "product": (m.ProductUpdate, {"name": "Saree"}),
    "lead": (m.LeadUpdate, {"source": "fair"}),
    "opportunity": (m.OpportunityUpdate, {"title": "Deal"}),
}
# Fields a client must never be able to send, on ANY request model.
SERVER_OWNED = [
    "created_by",
    "created_via",
    "created_at",
    "updated_at",
    "closed_at",
    "tenant_id",
    "archived_at",
    "email_consent",
    "whatsapp_consent",
    "phone_consent",
    "suppressed_at",
    "suppression_reason",
]


@pytest.mark.parametrize("name", list(CREATE_MODELS))
def test_valid_create_payloads_are_accepted(name: str) -> None:
    model, payload = CREATE_MODELS[name]
    assert model.model_validate(payload)


@pytest.mark.parametrize("field", SERVER_OWNED)
@pytest.mark.parametrize("name", list(CREATE_MODELS))
def test_create_models_reject_server_owned_fields(name: str, field: str) -> None:
    model, payload = CREATE_MODELS[name]
    with pytest.raises(ValidationError) as info:
        model.model_validate({**payload, field: "x"})
    assert info.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("field", SERVER_OWNED)
@pytest.mark.parametrize("name", list(UPDATE_MODELS))
def test_update_models_reject_server_owned_fields(name: str, field: str) -> None:
    model, payload = UPDATE_MODELS[name]
    with pytest.raises(ValidationError):
        model.model_validate({**payload, field: "x"})


@pytest.mark.parametrize("model", [m.RecordConsentIn, m.SuppressIn, m.LiftSuppressionIn])
@pytest.mark.parametrize("field", ["tenant_id", "contact_id", "p_tenant_id", "created_by"])
def test_consent_requests_cannot_name_a_tenant_or_contact(
    model: type[BaseModel], field: str
) -> None:
    base: dict[str, Any] = {
        m.RecordConsentIn: {"channel": "email", "status": "withdrawn"},
        m.SuppressIn: {"reason": "manual"},
        m.LiftSuppressionIn: {"evidence_type": "written", "evidence_ref": "letter:1"},
    }[model]
    with pytest.raises(ValidationError):
        model.model_validate({**base, field: UID})


@pytest.mark.parametrize(
    "bad_id",
    [
        "not-a-uuid",
        "",
        "12345678123456781234567812345678",  # compact hex: uuid.UUID() would accept it
        "urn:uuid:12345678-1234-5678-1234-567812345678",
        "{12345678-1234-5678-1234-567812345678}",
        "12345678-1234-5678-1234-56781234567",  # one short
        "12345678-1234-5678-1234-5678123456789",  # one long
        " 12345678-1234-5678-1234-567812345678",
        12345,
        None,
    ],
)
def test_ids_must_be_canonical_uuids(bad_id: Any) -> None:
    with pytest.raises(ValidationError):
        m.CompanyCreate.model_validate({"id": bad_id, "name": "Acme"})
    if bad_id is not None:  # None is a legal "no company"
        with pytest.raises(ValidationError):
            m.ContactCreate.model_validate({"id": UID, "full_name": "x", "company_id": bad_id})


def test_uppercase_canonical_uuid_is_accepted() -> None:
    assert m.CompanyCreate.model_validate({"id": UID.upper(), "name": "Acme"}).id == uuid.UUID(UID)


def test_parse_uuid_for_paths() -> None:
    assert m.parse_uuid(UID) == uuid.UUID(UID)
    for bad in ("x", "", UID.replace("-", ""), "urn:uuid:" + UID):
        assert m.parse_uuid(bad) is None


def test_leads_and_opportunities_have_no_status_on_create() -> None:
    with pytest.raises(ValidationError):
        m.LeadCreate.model_validate({"id": UID, "status": "qualified"})
    with pytest.raises(ValidationError):
        m.OpportunityCreate.model_validate(
            {"id": UID, "company_id": COMPANY, "title": "x", "status": "won"}
        )


def test_lead_contact_needs_its_company() -> None:
    with pytest.raises(ValidationError):
        m.LeadCreate.model_validate({"id": UID, "contact_id": COMPANY})
    assert m.LeadCreate.model_validate({"id": UID, "contact_id": COMPANY, "company_id": COMPANY})


def test_lost_requires_a_reason() -> None:
    with pytest.raises(ValidationError):
        m.OpportunityUpdate.model_validate({"status": "lost"})
    with pytest.raises(ValidationError):
        m.OpportunityUpdate.model_validate({"status": "lost", "lost_reason": ""})
    assert m.OpportunityUpdate.model_validate({"status": "lost", "lost_reason": "price"})
    assert m.OpportunityUpdate.model_validate({"status": "won"})


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (m.CompanyCreate, {"id": UID, "name": ""}),
        (m.CompanyCreate, {"id": UID, "name": "x" * 201}),
        (m.CompanyCreate, {"id": UID, "name": "x", "type": "investor"}),
        (m.CompanyCreate, {"id": UID, "name": "x", "tags": ["t"] * 21}),
        (m.CompanyCreate, {"id": UID, "name": "x", "tags": ["x" * 41]}),
        (m.CompanyCreate, {"id": UID, "name": "x", "tags": [""]}),
        (m.CompanyCreate, {"id": UID, "name": "x", "tags": ["y" * 40] * 20}),
        (m.ContactCreate, {"id": UID, "full_name": "x", "email": "nope"}),
        (m.ContactCreate, {"id": UID, "full_name": "x", "email": "a b@example.test"}),
        (m.ContactCreate, {"id": UID, "full_name": "x", "phone": "1"}),
        (m.ProductCreate, {"id": UID, "sku": "", "name": "x"}),
        (m.ProductCreate, {"id": UID, "sku": "s", "name": "x", "attributes": {"k": "v" * 5000}}),
        (m.ProductCreate, {"id": UID, "sku": "s", "name": "x", "attributes": [1, 2]}),
        (m.RecordConsentIn, {"channel": "sms", "status": "withdrawn"}),
        (m.RecordConsentIn, {"channel": "email", "status": "unknown"}),
        (m.RecordConsentIn, {"channel": "email", "status": "granted"}),
        (
            m.RecordConsentIn,
            {
                "channel": "email",
                "status": "granted",
                "basis": "explicit_consent",
                "evidence_type": "web_form",
            },
        ),
        (m.RecordConsentIn, {"channel": "email", "status": "withdrawn", "evidence_type": "verbal"}),
        (m.SuppressIn, {"reason": "because"}),
        (m.LiftSuppressionIn, {"evidence_type": "written"}),
    ],
)
def test_invalid_values_are_rejected(model: type[BaseModel], payload: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(
    "ref",
    ["form-123", "Form:1", "f:1", "form:", ":1", "form:a b", "form:a@b.c", "x" * 130, "form:1:2"],
)
def test_evidence_reference_must_be_typed_and_opaque(ref: str) -> None:
    with pytest.raises(ValidationError):
        m.LiftSuppressionIn.model_validate({"evidence_type": "written", "evidence_ref": ref})


@pytest.mark.parametrize("ref", ["form:8841", "ticket:2201", "erased:1", "my_kind-2:A.b_c#d/e-9"])
def test_valid_evidence_references(ref: str) -> None:
    assert m.LiftSuppressionIn.model_validate({"evidence_type": "written", "evidence_ref": ref})


def test_responses_forbid_unknown_columns() -> None:
    row: dict[str, Any] = {
        "id": UID,
        "created_by": None,
        "created_via": "manual",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "archived_at": None,
        "name": "A",
        "type": "prospect",
        "website": None,
        "country": None,
        "region": None,
        "city": None,
        "industry": None,
        "tags": [],
    }
    assert m.CompanyOut.model_validate(row)
    with pytest.raises(ValidationError):
        m.CompanyOut.model_validate({**row, "tenant_id": UID})
    with pytest.raises(ValidationError):
        m.CompanyOut.model_validate({**row, "some_new_column": 1})


# ------------------------------------------------------------------------------ cursors
def test_cursor_roundtrip() -> None:
    import datetime as dt

    when = dt.datetime(2026, 10, 5, 12, 30, 45, 123456, tzinfo=dt.UTC)
    rid = uuid.uuid4()
    created_at, row_id = m.decode_cursor(m.encode_cursor(when, rid))
    assert dt.datetime.fromisoformat(created_at) == when
    assert row_id == rid


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "!!!",
        "e30",  # {}
        "bm90LWpzb24",  # not json
        "eyJjIjoiMjAyNi0xMC0wNSIsImkiOiJ4In0",  # bad id/timestamp
    ],
)
def test_malformed_cursors_are_rejected(bad: str) -> None:
    with pytest.raises(m.CursorError):
        m.decode_cursor(bad)


@pytest.mark.parametrize(
    "created_at",
    [
        "2026-10-05T12:00:00+00:00)),id.eq.1,or(id.neq.0",  # filter injection
        "2026-10-05 12:00:00",
        "yesterday",
        "2026-10-05T12:00:00+00:00,x",
        "2026-13-45T99:99:99+00:00",
    ],
)
def test_cursor_timestamp_cannot_smuggle_filter_syntax(created_at: str) -> None:
    import base64
    import json

    raw = (
        base64.urlsafe_b64encode(json.dumps({"c": created_at, "i": UID}).encode())
        .decode()
        .rstrip("=")
    )
    with pytest.raises(m.CursorError):
        m.decode_cursor(raw)
