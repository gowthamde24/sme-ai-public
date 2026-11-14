"""The in-app KYC (owner decision 14 Nov 2026): the Owner of a business files its OWN compliance application for its phone number. "Reseller" at Plivo = one subaccount per business + that business's own application
(ONE of GST certificate, Certificate of Incorporation, Udyam: Plivo support, 13 Nov, ticket #37858). We create the subaccount (its Auth Token goes straight into Secret Manager, never shown), pass the document through to
Plivo's Compliance API (`data.subaccount`, main-account credentials) IN MEMORY, and keep only the application's id and Plivo's status words. Nothing here rents a number or spends money.

`PLIVO_KYC_LIVE` (off until the owner says so): off, the form is checked end to end and Plivo's requirements are read (free), but nothing is filed and no subaccount is made."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import binascii
import logging
import uuid
from typing import Any, Protocol

from app.errors import ApiError
from app.phone_kyc.models import FILE_TYPES, MAX_FILE_BYTES, DocOptionOut, KycIn, KycOut, OptionsOut
from app.telephony.plivo_admin import ComplianceRefused, PlivoCompliance
from app.telephony.plivo_api import PlivoError
from app.telephony.plivo_onboarding import vault_key

logger = logging.getLogger("app.phone_kyc")

# which of Plivo's document types a kind goes under: GST certificate -> "GST certificate"; Certificate of Incorporation and Udyam -> "Registration Certificate" (the business's registration), with the number in `end_user.registration_number`
PLIVO_DOCUMENT = {"gst": "GST certificate", "coi": "Registration Certificate", "udyam": "Registration Certificate"}
OPTIONS: tuple[DocOptionOut, ...] = (
    DocOptionOut(kind="gst", number_label="GSTIN", number_example="29ABCDE1234F1Z5", plivo_document=PLIVO_DOCUMENT["gst"]),
    DocOptionOut(kind="coi", number_label="CIN / LLPIN", number_example="U72200KA2020PTC123456", plivo_document=PLIVO_DOCUMENT["coi"]),
    DocOptionOut(kind="udyam", number_label="Udyam registration number", number_example="UDYAM-KA-01-0123456", plivo_document=PLIVO_DOCUMENT["udyam"]),
)
_MAGIC = {"application/pdf": b"%PDF-", "image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}
REFRESH_AFTER_S = 30


class KycRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save(self, token: str, tenant_id: uuid.UUID, kyc_id: uuid.UUID, doc_kind: str, subaccount: str | None, compliance_id: str | None, status: str, reason: str | None) -> dict[str, Any]: ...


class SecretPut(Protocol):
    def put(self, name: str, value: str) -> None: ...


def _out(row: dict[str, Any], *, live: bool) -> KycOut:
    if not row.get("id"):
        return KycOut(state="not_started", live=live)
    status = str(row["status"])
    return KycOut.model_validate({
        "state": status, "kyc_id": row["id"], "doc_kind": row["doc_kind"], "compliance_id": row.get("compliance_id"), "reason": row.get("rejection_reason"), "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"), "checked_at": row.get("checked_at"), "live": live, "can_choose_number": status == "accepted"})


def _document_bytes(body: KycIn) -> bytes:
    try:
        raw = base64.b64decode(body.document.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "kyc_file_unreadable", "That file could not be read. Choose the PDF or photo again.") from None
    if not raw:
        raise ApiError(422, "kyc_file_unreadable", "That file is empty.")
    if len(raw) > MAX_FILE_BYTES:
        raise ApiError(413, "kyc_file_too_large", "That file is over 5 MB. Choose a smaller PDF or photo.")
    if body.document.content_type not in FILE_TYPES or not raw.startswith(_MAGIC[body.document.content_type]):
        raise ApiError(415, "kyc_file_type", "That does not look like a PDF, JPG or PNG file.")
    return raw


class PhoneKycService:
    def __init__(self, repository: KycRepository, plivo: PlivoCompliance | None, secrets: SecretPut | None, *, live: bool) -> None:
        self._repo, self._plivo, self._secrets, self._live = repository, plivo, secrets, live

    def options(self) -> OptionsOut:
        return OptionsOut(live=self._live, documents=list(OPTIONS), max_file_bytes=MAX_FILE_BYTES, file_types=list(FILE_TYPES))

    def status(self, token: str, tenant_id: uuid.UUID, *, can_refresh: bool) -> KycOut:
        row = self._repo.get(token, tenant_id)
        if can_refresh and self._live and self._plivo is not None and row.get("id") and row.get("status") == "submitted" and row.get("compliance_id"):
            row = self._refresh(token, tenant_id, row)
        return _out(row, live=self._live)

    def _refresh(self, token: str, tenant_id: uuid.UUID, row: dict[str, Any]) -> dict[str, Any]:
        from datetime import UTC, datetime

        checked = row.get("checked_at")
        if isinstance(checked, str):
            try:
                if (datetime.now(UTC) - datetime.fromisoformat(checked.replace("Z", "+00:00"))).total_seconds() < REFRESH_AFTER_S:
                    return row
            except ValueError:
                pass
        assert self._plivo is not None  # noqa: S101
        try:
            status, reason = self._plivo.compliance_info(str(row["compliance_id"]), subaccount_id=row.get("plivo_subaccount"))
        except PlivoError as exc:
            logger.warning("kyc status not read: %s", exc.reason)   # the stored words stay
            return row
        if status == row["status"]:
            return row
        return self._repo.save(token, tenant_id, uuid.UUID(str(row["id"])), str(row["doc_kind"]), None, None, status, reason)

    def submit(self, token: str, tenant_id: uuid.UUID, body: KycIn) -> KycOut:
        content = _document_bytes(body)
        if self._plivo is None:
            raise ApiError(503, "kyc_unavailable", "Phone number registration is not available right now.")
        document_type_id, data_fields = self._plan(body)
        if not self._live:
            # checked end to end, nothing sent: the owner switches real filing on
            return KycOut(state="not_started", live=False)
        row = self._repo.save(token, tenant_id, body.kyc_id, body.doc_kind, None, None, "preparing", None)
        if row.get("status") != "preparing" or row.get("compliance_id"):
            return _out(row, live=True)   # a retry of something already filed: the answer as it stands
        subaccount = row.get("plivo_subaccount")
        try:
            if not subaccount:
                if self._secrets is None:
                    raise ApiError(503, "kyc_unavailable", "Phone number registration is not available right now.")
                name = f"s19-{str(tenant_id)[:8]}"
                subaccount = self._plivo.create_subaccount(name, lambda secret: self._secrets.put(vault_key(tenant_id), secret))   # type: ignore[union-attr]
                row = self._repo.save(token, tenant_id, body.kyc_id, body.doc_kind, subaccount, None, "preparing", None)
            compliance_id = self._plivo.file_compliance(
                subaccount_id=str(subaccount), alias=f"s19-{str(tenant_id)[:8]}-{body.doc_kind}", end_user=self._end_user(body), document_type_id=document_type_id, data_fields=data_fields,
                filename=body.document.name, content_type=body.document.content_type, content=content)
        except ComplianceRefused as exc:
            row = self._repo.save(token, tenant_id, body.kyc_id, body.doc_kind, None, None, "failed", exc.detail or None)
            raise ApiError(422, "kyc_not_accepted", "Plivo did not accept this filing. " + (exc.detail or "Check the document and the details, then try again."), extra={"reason": exc.detail or None}) from None
        except PlivoError as exc:
            self._repo.save(token, tenant_id, body.kyc_id, body.doc_kind, None, None, "preparing", None)   # it can be retried with the same id
            raise ApiError(502, "kyc_provider_unavailable", "The phone provider did not answer. Try again in a minute.") from exc
        row = self._repo.save(token, tenant_id, body.kyc_id, body.doc_kind, None, compliance_id, "submitted", None)
        logger.info("phone kyc filed: kind=%s", body.doc_kind)
        return _out(row, live=True)

    # ------------------------------------------------------------------------------------------------------------------------------
    def _plan(self, body: KycIn) -> tuple[str, dict[str, str]]:
        """Which of Plivo's document types this is (read live: the ids are not ours) and the fields it wants."""
        assert self._plivo is not None  # noqa: S101
        try:
            requirements = self._plivo.requirements()
        except PlivoError as exc:
            raise ApiError(502, "kyc_provider_unavailable", "The phone provider did not answer. Try again in a minute.") from exc
        wanted = PLIVO_DOCUMENT[body.doc_kind].lower()
        match = next((d for d in requirements["document_types"] if isinstance(d, dict) and wanted in str(d.get("name", "")).lower()), None)
        if match is None or not match.get("document_type_id"):
            raise ApiError(409, "kyc_document_not_offered", "Plivo does not take that document right now. We have asked Plivo; their support said any one of GST, Certificate of Incorporation or Udyam is accepted.")
        fields: dict[str, str] = {}
        for f in match.get("required_fields") or []:
            name = str(f.get("field_name", ""))
            if name == "business_name":
                fields[name] = body.legal_name
            elif f.get("required"):
                raise ApiError(409, "kyc_field_not_supported", "Plivo asks for a detail we do not collect yet.")
        return str(match["document_type_id"]), fields

    @staticmethod
    def _end_user(body: KycIn) -> dict[str, str]:
        return {"type": "business", "name": body.legal_name, "email": body.email, "address_line1": body.address_line1, **({"address_line2": body.address_line2} if body.address_line2 else {}),
                "city": body.city, "state": body.state, "postal_code": body.postal_code, "country": "IN", "registration_number": body.registration_number}
