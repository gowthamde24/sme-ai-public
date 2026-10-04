"""API models for the CRM core. Mirrors packages/contracts/crm.schema.json.

Rules for every REQUEST model:
- `extra="forbid"`: a client can never send created_by, created_via, closed_at, tenant_id (the
  tenant comes from the URL path), archived_at (archive/restore have their own endpoints), or any
  consent / suppression column (only the consent endpoints change those). Unknown keys are a 422.
- ids are canonical UUID strings only (no URN / braces / compact forms).
- sizes mirror the database CHECK constraints; the database remains the authority.
RESPONSE models are `extra="forbid"` too, so a column added to the database cannot leak by accident.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Generic, TypeVar

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

# ----------------------------------------------------------------------------- primitives
_CANONICAL_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _canonical_uuid(value: Any) -> Any:
    """Accept only the canonical 8-4-4-4-12 form (uuid.UUID alone also takes urn:, braces, hex)."""
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str) or not _CANONICAL_UUID.fullmatch(value):
        raise ValueError("must be a canonical UUID")
    return value


ApiUuid = Annotated[uuid.UUID, BeforeValidator(_canonical_uuid)]


def parse_uuid(value: str) -> uuid.UUID | None:
    """For path parameters: canonical UUID or None (the route answers 404 for None)."""
    if not _CANONICAL_UUID.fullmatch(value):
        return None
    return uuid.UUID(value)


Name200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Text100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Text500 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=32)]

# Same shape as the database CHECK on consent_events.evidence_ref.
EVIDENCE_REF_PATTERN = r"^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$"
EvidenceRef = Annotated[str, StringConstraints(max_length=120, pattern=EVIDENCE_REF_PATTERN)]

MAX_ATTRIBUTES_BYTES = 4096


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------------- enums
class CompanyType(StrEnum):
    PROSPECT = "prospect"
    CUSTOMER = "customer"
    SUPPLIER = "supplier"
    OTHER = "other"


class LeadStatus(StrEnum):
    NEW = "new"
    IN_REVIEW = "in_review"
    QUALIFIED = "qualified"
    DISQUALIFIED = "disqualified"


class OpportunityStatus(StrEnum):
    OPEN = "open"
    WON = "won"
    LOST = "lost"


class RecordOrigin(StrEnum):
    MANUAL = "manual"
    IMPORT = "import"
    AGENT = "agent"


class ConsentStatus(StrEnum):
    UNKNOWN = "unknown"
    GRANTED = "granted"
    WITHDRAWN = "withdrawn"


class ConsentChannel(StrEnum):
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    PHONE = "phone"


class ConsentBasis(StrEnum):
    EXPLICIT_CONSENT = "explicit_consent"
    CONTRACTUAL = "contractual"
    LEGITIMATE_USE = "legitimate_use"
    OTHER = "other"


class EvidenceType(StrEnum):
    WEB_FORM = "web_form"
    EMAIL_REPLY = "email_reply"
    VERBAL = "verbal"
    WRITTEN = "written"
    IMPORTED = "imported"
    OTHER = "other"


class SuppressionReason(StrEnum):
    OPTED_OUT = "opted_out"
    BOUNCED = "bounced"
    COMPLAINED = "complained"
    LEGAL = "legal"
    MANUAL = "manual"


# ----------------------------------------------------------------------------- responses
class _Row(_Strict):
    id: uuid.UUID
    created_by: uuid.UUID | None
    created_via: RecordOrigin
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class CompanyOut(_Row):
    name: str
    type: CompanyType
    website: str | None
    country: str | None
    region: str | None
    city: str | None
    industry: str | None
    tags: list[str]


class ContactOut(_Row):
    company_id: uuid.UUID | None
    full_name: str
    email: str | None
    phone: str | None
    job_title: str | None
    email_consent: ConsentStatus
    whatsapp_consent: ConsentStatus
    phone_consent: ConsentStatus
    suppressed_at: datetime | None
    suppression_reason: SuppressionReason | None


class ProductOut(_Row):
    sku: str
    name: str
    description: str | None
    unit: str | None
    category: str | None
    attributes: dict[str, Any]
    active: bool


class LeadOut(_Row):
    company_id: uuid.UUID | None
    contact_id: uuid.UUID | None
    owner_user_id: uuid.UUID | None
    status: LeadStatus
    source: str | None
    disqualified_reason: str | None


class OpportunityOut(_Row):
    company_id: uuid.UUID
    contact_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    owner_user_id: uuid.UUID | None
    title: str
    status: OpportunityStatus
    lost_reason: str | None
    closed_at: datetime | None


class ConsentResultOut(_Strict):
    """`event_id` is the ledger row of the action (None: lifting a suppression that was not set)."""

    event_id: uuid.UUID | None
    contact: ContactOut


T = TypeVar("T", bound=BaseModel)


class Page(_Strict, Generic[T]):
    items: list[T]
    # Opaque; pass back as ?cursor= for the next page. None on the last page.
    next_cursor: str | None


# ----------------------------------------------------------------------------- requests
class CompanyCreate(_Strict):
    id: ApiUuid
    name: Name200
    type: CompanyType = CompanyType.PROSPECT
    website: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    country: Text100 | None = None
    region: Text100 | None = None
    city: Text100 | None = None
    industry: Text100 | None = None
    tags: Annotated[list[Tag], Field(max_length=20)] = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def _tags_total_size(cls, tags: list[str]) -> list[str]:
        if len(",".join(tags)) > 800:
            raise ValueError("tags are too long in total")
        return tags


class CompanyUpdate(_Strict):
    name: Name200 | None = None
    type: CompanyType | None = None
    website: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    country: Text100 | None = None
    region: Text100 | None = None
    city: Text100 | None = None
    industry: Text100 | None = None
    tags: Annotated[list[Tag], Field(max_length=20)] | None = None

    @field_validator("tags")
    @classmethod
    def _tags_total_size(cls, tags: list[str] | None) -> list[str] | None:
        if tags is not None and len(",".join(tags)) > 800:
            raise ValueError("tags are too long in total")
        return tags


class ContactCreate(_Strict):
    id: ApiUuid
    company_id: ApiUuid | None = None
    full_name: Name200
    email: Email | None = None
    phone: Phone | None = None
    job_title: Text100 | None = None


class ContactUpdate(_Strict):
    company_id: ApiUuid | None = None
    full_name: Name200 | None = None
    email: Email | None = None
    phone: Phone | None = None
    job_title: Text100 | None = None


def _attributes_ok(value: dict[str, Any]) -> dict[str, Any]:
    if (
        len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode())
        > MAX_ATTRIBUTES_BYTES
    ):
        raise ValueError("attributes are larger than 4 KB")
    return value


class ProductCreate(_Strict):
    id: ApiUuid
    sku: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    name: Name200
    description: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
        | None
    ) = None
    unit: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)] | None
    ) = None
    category: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] | None
    ) = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    active: bool = True

    @field_validator("attributes")
    @classmethod
    def _attrs(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _attributes_ok(v)


class ProductUpdate(_Strict):
    sku: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] | None
    ) = None
    name: Name200 | None = None
    description: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
        | None
    ) = None
    unit: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)] | None
    ) = None
    category: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] | None
    ) = None
    attributes: dict[str, Any] | None = None
    active: bool | None = None

    @field_validator("attributes")
    @classmethod
    def _attrs(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return None if v is None else _attributes_ok(v)


class LeadCreate(_Strict):
    """Leads always start as `new`: there is no status field on create."""

    id: ApiUuid
    company_id: ApiUuid | None = None
    contact_id: ApiUuid | None = None
    owner_user_id: ApiUuid | None = None
    source: Text100 | None = None

    @model_validator(mode="after")
    def _contact_needs_company(self) -> LeadCreate:
        if self.contact_id is not None and self.company_id is None:
            raise ValueError("a contact can only be linked together with its company")
        return self


class LeadUpdate(_Strict):
    company_id: ApiUuid | None = None
    contact_id: ApiUuid | None = None
    owner_user_id: ApiUuid | None = None
    status: LeadStatus | None = None
    source: Text100 | None = None
    disqualified_reason: Text500 | None = None


class OpportunityCreate(_Strict):
    """Opportunities always start `open`: there is no status field on create."""

    id: ApiUuid
    company_id: ApiUuid
    contact_id: ApiUuid | None = None
    lead_id: ApiUuid | None = None
    owner_user_id: ApiUuid | None = None
    title: Name200


class OpportunityUpdate(_Strict):
    company_id: ApiUuid | None = None
    contact_id: ApiUuid | None = None
    lead_id: ApiUuid | None = None
    owner_user_id: ApiUuid | None = None
    title: Name200 | None = None
    status: OpportunityStatus | None = None
    lost_reason: Text500 | None = None

    @model_validator(mode="after")
    def _lost_needs_reason(self) -> OpportunityUpdate:
        if self.status == OpportunityStatus.LOST and not self.lost_reason:
            raise ValueError("closing as lost requires lost_reason")
        return self


class RecordConsentIn(_Strict):
    channel: ConsentChannel
    status: ConsentStatus
    basis: ConsentBasis | None = None
    evidence_type: EvidenceType | None = None
    evidence_ref: EvidenceRef | None = None

    @model_validator(mode="after")
    def _shape(self) -> RecordConsentIn:
        if self.status == ConsentStatus.UNKNOWN:
            raise ValueError("status must be granted or withdrawn")
        if (self.evidence_type is None) != (self.evidence_ref is None):
            raise ValueError("evidence_type and evidence_ref go together")
        if self.status == ConsentStatus.GRANTED and (
            self.basis is None or self.evidence_ref is None
        ):
            raise ValueError("granting consent requires basis, evidence_type and evidence_ref")
        return self


class SuppressIn(_Strict):
    reason: SuppressionReason
    evidence_type: EvidenceType | None = None
    evidence_ref: EvidenceRef | None = None

    @model_validator(mode="after")
    def _pair(self) -> SuppressIn:
        if (self.evidence_type is None) != (self.evidence_ref is None):
            raise ValueError("evidence_type and evidence_ref go together")
        return self


class LiftSuppressionIn(_Strict):
    evidence_type: EvidenceType
    evidence_ref: EvidenceRef


# ----------------------------------------------------------------------------- cursors
class CursorError(ValueError):
    """The cursor is not one we issued (tampered, truncated, or from another list)."""


_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$")


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    raw = json.dumps({"c": created_at.isoformat(), "i": str(row_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, uuid.UUID]:
    """Return (created_at ISO string, id), strictly validated: nothing from the client reaches the
    data layer unless it is a well-formed timestamp and a canonical UUID."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        created_at, row_id = data["c"], data["i"]
        if not isinstance(created_at, str) or not _TS.fullmatch(created_at):
            raise CursorError("bad timestamp")
        datetime.fromisoformat(created_at)
        parsed = parse_uuid(row_id) if isinstance(row_id, str) else None
        if parsed is None:
            raise CursorError("bad id")
        return created_at, parsed
    except (binascii.Error, ValueError, KeyError, TypeError) as exc:
        raise CursorError("invalid cursor") from exc
