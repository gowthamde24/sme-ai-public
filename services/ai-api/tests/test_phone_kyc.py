"""The in-app KYC of a business's phone number (owner decision 14 Nov 2026): one of three documents, the document passes through in memory, a dry run until the owner switches real filing on, the subaccount's token goes
to Secret Manager and nowhere else. Plivo and the database are fakes; the database's rules are pgTAP 208."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import uuid
from typing import Any

import pytest

from app.errors import ApiError
from app.phone_kyc.models import KycIn
from app.phone_kyc.service import PhoneKycService
from app.telephony.plivo_admin import ComplianceRefused
from app.telephony.plivo_api import PlivoError

TENANT = uuid.UUID(int=1)
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"
REQUIREMENTS = {"requirement_id": "r1", "document_types": [
    {"document_type_id": "dt-reg", "name": "Registration Certificate", "proof_required": True, "required_fields": [{"field_name": "business_name", "required": True}]},
    {"document_type_id": "dt-gst", "name": "GST certificate", "proof_required": True, "required_fields": []}]}


class FakePlivo:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.refuse: str | None = None
        self.unavailable = False
        self.info: tuple[str, str | None] = ("submitted", None)

    def requirements(self) -> dict[str, Any]:
        self.calls.append(("requirements", None))
        return REQUIREMENTS

    def create_subaccount(self, name: str, keep_token: Any) -> str:
        self.calls.append(("subaccount", name))
        keep_token("SECRET-SUBACCOUNT-TOKEN")
        return "SAABCDEF1234567890XY"

    def file_compliance(self, **kw: Any) -> str:
        self.calls.append(("file", {k: v for k, v in kw.items() if k != "content"} | {"size": len(kw["content"])}))
        if self.unavailable:
            raise PlivoError("unavailable")
        if self.refuse:
            raise ComplianceRefused(self.refuse)
        return "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    def compliance_info(self, compliance_id: str, *, subaccount_id: str | None = None) -> tuple[str, str | None]:
        self.calls.append(("info", compliance_id))
        return self.info


class FakeRepo:
    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, dict[str, Any]] = {}
        self.saves: list[tuple[str, str | None]] = []

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return max(self.rows.values(), key=lambda r: r["created_at"], default={"id": None})

    def save(self, token: str, tenant_id: uuid.UUID, kyc_id: uuid.UUID, doc_kind: str, subaccount: str | None, compliance_id: str | None, status: str, reason: str | None) -> dict[str, Any]:
        rank = {"preparing": 0, "submitted": 1}
        if kyc_id in self.rows and rank.get(self.rows[kyc_id]["status"], 2) > rank.get(status, 2):
            return dict(self.rows[kyc_id])   # the database never moves an application backwards
        row = self.rows.setdefault(kyc_id, {"id": str(kyc_id), "doc_kind": doc_kind, "created_at": "2026-11-14T10:00:00+00:00", "updated_at": "2026-11-14T10:00:00+00:00", "checked_at": None, "plivo_subaccount": None, "compliance_id": None})
        row.update(status=status, rejection_reason=reason)
        row["plivo_subaccount"] = subaccount or row["plivo_subaccount"]
        row["compliance_id"] = compliance_id or row["compliance_id"]
        self.saves.append((status, reason))
        return dict(row)


class Vault:
    def __init__(self) -> None:
        self.put_calls: list[str] = []

    def put(self, name: str, value: str) -> None:
        self.put_calls.append(name)


def form(kind: str = "gst", **over: Any) -> KycIn:
    numbers = {"gst": "29ABCDE1234F1Z5", "udyam": "UDYAM-KA-01-0123456", "coi": "U72200KA2020PTC123456"}
    body = {"kyc_id": str(uuid.uuid4()), "doc_kind": kind, "legal_name": "Neelambari Silks", "registration_number": numbers[kind], "email": "owner@neelambari.example", "address_line1": "12 Main Road", "city": "Dharmavaram",
            "state": "Andhra Pradesh", "postal_code": "515671", "document": {"name": "certificate.pdf", "content_type": "application/pdf", "data_base64": base64.b64encode(PDF).decode()}}
    body.update(over)
    return KycIn.model_validate(body)


def service(live: bool = True) -> tuple[PhoneKycService, FakePlivo, FakeRepo, Vault]:
    plivo, repo, vault = FakePlivo(), FakeRepo(), Vault()
    return PhoneKycService(repo, plivo, vault, live=live), plivo, repo, vault  # type: ignore[arg-type]


def test_any_one_of_the_three_documents_files_under_the_right_plivo_type() -> None:
    for kind, doc_type, fields in (("gst", "dt-gst", {}), ("udyam", "dt-reg", {"business_name": "Neelambari Silks"}), ("coi", "dt-reg", {"business_name": "Neelambari Silks"})):
        svc, plivo, repo, _ = service()
        out = svc.submit("tok", TENANT, form(kind))
        assert out.state == "submitted" and out.live and out.compliance_id == "a1b2c3d4-e5f6-7890-abcd-ef1234567890", kind
        filed = next(c[1] for c in plivo.calls if c[0] == "file")
        assert filed["document_type_id"] == doc_type and filed["data_fields"] == fields and filed["subaccount_id"] == "SAABCDEF1234567890XY" and filed["size"] == len(PDF), kind
        assert filed["end_user"]["registration_number"] and filed["end_user"]["country"] == "IN" and filed["end_user"]["type"] == "business"
        assert [s[0] for s in repo.saves] == ["preparing", "preparing", "submitted"], "begun, subaccount kept, filed"


def test_the_subaccount_token_goes_to_secret_manager_only() -> None:
    svc, _, repo, vault = service()
    svc.submit("tok", TENANT, form())
    assert vault.put_calls == [f"sme-ws-{TENANT}-plivo-token"]
    assert "SECRET-SUBACCOUNT-TOKEN" not in repr(repo.rows) and "SECRET-SUBACCOUNT-TOKEN" not in repr(vault.put_calls)


def test_nothing_is_sent_until_the_owner_switches_real_filing_on() -> None:
    svc, plivo, repo, vault = service(live=False)
    out = svc.submit("tok", TENANT, form("udyam"))
    assert out.state == "not_started" and out.live is False
    assert [c[0] for c in plivo.calls] == ["requirements"], "only the free read of Plivo's requirements"
    assert repo.rows == {} and vault.put_calls == []


def test_a_retry_with_the_same_id_files_once() -> None:
    svc, plivo, _, _ = service()
    body = form()
    svc.submit("tok", TENANT, body)
    again = svc.submit("tok", TENANT, body)
    assert again.state == "submitted" and sum(1 for c in plivo.calls if c[0] == "file") == 1 and sum(1 for c in plivo.calls if c[0] == "subaccount") == 1


def test_plivo_saying_no_is_told_to_the_owner_in_its_own_words() -> None:
    svc, plivo, repo, _ = service()
    plivo.refuse = "A GST certificate and a Registration Certificate are both required."
    with pytest.raises(ApiError) as e:
        svc.submit("tok", TENANT, form("udyam"))
    assert e.value.code == "kyc_not_accepted" and "both required" in str(e.value) and repo.saves[-1] == ("failed", "A GST certificate and a Registration Certificate are both required.")


def test_plivo_being_down_leaves_it_to_retry() -> None:
    svc, plivo, repo, _ = service()
    plivo.unavailable = True
    with pytest.raises(ApiError) as e:
        svc.submit("tok", TENANT, form())
    assert e.value.code == "kyc_provider_unavailable" and repo.saves[-1][0] == "preparing"


@pytest.mark.parametrize("kind,number", [("gst", "27AAPFU0939F1ZV"), ("udyam", "udyam-ap-12-0001234"), ("coi", "AAB-1234")])
def test_a_document_number_must_look_like_its_kind(kind: str, number: str) -> None:
    ok = form(kind, registration_number=number)
    assert ok.registration_number == number.upper()


@pytest.mark.parametrize("kind,number", [("gst", "UDYAM-KA-01-0123456"), ("udyam", "29ABCDE1234F1Z5"), ("coi", "12345"), ("gst", "short")])
def test_a_number_of_the_wrong_kind_is_refused(kind: str, number: str) -> None:
    with pytest.raises(ValueError):
        form(kind, registration_number=number)


def test_the_file_is_checked_before_anything_leaves() -> None:
    svc, plivo, _, _ = service()
    bad = [
        form(document={"name": "x.pdf", "content_type": "application/pdf", "data_base64": base64.b64encode(b"not a pdf at all").decode()}),
        form(document={"name": "x.png", "content_type": "image/png", "data_base64": base64.b64encode(PDF).decode()}),
        form(document={"name": "x.pdf", "content_type": "application/pdf", "data_base64": "@@@@"}),
    ]
    codes = []
    for body in bad:
        with pytest.raises(ApiError) as e:
            svc.submit("tok", TENANT, body)
        codes.append(e.value.code)
    assert codes == ["kyc_file_type", "kyc_file_type", "kyc_file_unreadable"]
    big = form(document={"name": "x.pdf", "content_type": "application/pdf", "data_base64": base64.b64encode(PDF + b"0" * 5_000_001).decode()})
    with pytest.raises(ApiError) as e:
        svc.submit("tok", TENANT, big)
    assert e.value.code == "kyc_file_too_large" and plivo.calls == []


def test_a_bad_form_is_refused() -> None:
    for over in ({"email": "nope"}, {"postal_code": "12345"}, {"legal_name": "x"}, {"doc_kind": "pan"}, {"extra": 1}):
        with pytest.raises(ValueError):
            form(**over)


def test_status_refreshes_a_submitted_application_from_plivo_for_the_owner() -> None:
    svc, plivo, repo, _ = service()
    out = svc.submit("tok", TENANT, form())
    row = repo.rows[out.kyc_id]  # type: ignore[index]
    plivo.info = ("accepted", None)
    assert svc.status("tok", TENANT, can_refresh=False).state == "submitted", "a read by someone else does not move it"
    shown = svc.status("tok", TENANT, can_refresh=True)
    assert shown.state == "accepted" and shown.can_choose_number is True and row["status"] == "accepted"
    plivo.info = ("rejected", "The name does not match")
    row["status"], row["checked_at"] = "submitted", None
    rejected = svc.status("tok", TENANT, can_refresh=True)
    assert rejected.state == "rejected" and rejected.reason == "The name does not match" and rejected.can_choose_number is False


def test_the_options_say_what_each_document_is_called() -> None:
    svc, *_ = service(live=False)
    o = svc.options()
    assert [d.kind for d in o.documents] == ["gst", "coi", "udyam"] and o.max_file_bytes == 5_000_000 and o.live is False and "not kept" in o.kept_note


def test_the_routes_and_who_may_use_them() -> None:
    from tests.fakes import TENANT_A, auth, make_client

    svc, plivo, repo, _ = service(live=True)
    client, _rt = make_client(phone_kyc=svc)
    base = f"/v1/tenants/{TENANT_A.id}/phone-kyc"
    body = form("gst").model_dump(mode="json")
    assert client.get(base, headers=auth("a_viewer")).json()["state"] == "not_started"
    assert client.get(f"{base}/options", headers=auth("a_owner")).json()["documents"][0]["kind"] == "gst"
    assert client.get(f"{base}/options", headers=auth("a_sales")).status_code == 403
    for who in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(base, json=body, headers=auth(who)).status_code == 403, who
    assert client.post(base, json=body, headers=auth("b_owner")).status_code == 404
    assert client.post(base, json={**body, "extra": 1}, headers=auth("a_owner")).status_code == 422
    filed = client.post(base, json=body, headers=auth("a_owner"))
    assert filed.status_code == 200 and filed.json()["state"] == "submitted" and filed.json()["doc_kind"] == "gst"
    assert "data_base64" not in filed.text and "SECRET" not in filed.text
    c2, _ = make_client()
    assert c2.get(base, headers=auth("a_owner")).json()["error"]["code"] == "kyc_unavailable"
    _ = (plivo, repo)
