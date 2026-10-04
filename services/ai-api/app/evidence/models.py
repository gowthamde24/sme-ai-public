"""API models for evidence (T004, ADR 0008). Mirrors packages/contracts/evidence.schema.json.

Evidence is UNTRUSTED CONTENT (CLAUDE.md #6): `url`, `reference` and `snippet` are data. They are
validated for shape and size here, stored verbatim, and returned verbatim. Nothing in this package
fetches, follows, renders or interprets them. The database CHECK constraints are the authority; the
checks below only fail early with a field-level 422.

Rules for the REQUEST model:
- `extra="forbid"`: a client can never send `provider` (the API sets it), `created_by`,
  `created_via`, `tenant_id` (from the URL path), `archived_at` (archive / restore have their own
  endpoints), or a link target (from the URL path).
- ids are canonical UUID strings only.
RESPONSE models are `extra="forbid"` as well, so a column added to the database cannot leak.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    StringConstraints,
    model_validator,
)

from app.crm.models import ApiUuid, EvidenceRef, RecordOrigin

# Same character set as app.text_is_clean in the database (supabase/migrations/..._text_hygiene):
# C0 controls except tab / LF / CR, DEL and C1 controls, zero-width space, line / paragraph
# separators, bidi embeddings / overrides / isolates, word joiner and invisible operators, BOM, and
# the Unicode tag characters. ZWNJ / ZWJ (U+200C / U+200D) and LRM / RLM stay legal.
_BLOCKED = re.compile(
    "[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e"
    "\u2060-\u2064\u2066-\u2069\ufeff\U000e0000-\U000e007f]"
)
# http(s) only; no userinfo; no whitespace, control, quote or angle characters (same as the CHECK).
_URL = re.compile(
    r"""^https?://[^/?#@\s\x00-\x1f\x7f<>"'\\]+([/?#][^\s\x00-\x1f\x7f<>"'\\]*)?$""", re.IGNORECASE
)

HUMAN_PROVIDER = "manual"


def text_is_clean(value: str) -> bool:
    return _BLOCKED.search(value) is None


def _clean(value: str) -> str:
    if not text_is_clean(value):
        raise ValueError("contains invisible or control characters")
    return value


def _http_url(value: str) -> str:
    if not _URL.fullmatch(value):
        raise ValueError("must be an http or https URL")
    return value


EvidenceUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=8, max_length=2048),
    AfterValidator(_http_url),
    AfterValidator(_clean),
]
EvidenceSnippet = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=1000),
    AfterValidator(_clean),
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------------- enums
class EvidenceKind(StrEnum):
    WEB_PAGE = "web_page"
    DOCUMENT = "document"
    EMAIL = "email"
    LISTING = "listing"
    REGISTRY = "registry"
    NOTE = "note"


class EvidenceStance(StrEnum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    CONTEXT = "context"


TargetKind = Literal["company", "lead"]


def derive_link_id(evidence_id: uuid.UUID, target_kind: str, target_id: uuid.UUID) -> uuid.UUID:
    """The id of the link created together with an evidence row. Derived, so a retry of the same
    request always targets the same link (idempotent create)."""
    return uuid.uuid5(evidence_id, f"{target_kind}:{target_id}")


# ----------------------------------------------------------------------------- responses
class EvidenceOut(_Strict):
    id: uuid.UUID
    kind: EvidenceKind
    provider: str
    url: str | None
    reference: str | None
    snippet: str | None
    retrieved_at: datetime
    published_at: datetime | None
    created_by: uuid.UUID | None
    created_via: RecordOrigin
    created_at: datetime
    archived_at: datetime | None


class EvidenceLinkOut(_Strict):
    """One evidence row attached to one target, with the evidence embedded. `archived_at` is the
    LINK's; the evidence carries its own."""

    id: uuid.UUID
    company_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    claim_id: uuid.UUID | None
    stance: EvidenceStance | None
    created_by: uuid.UUID | None
    created_via: RecordOrigin
    created_at: datetime
    archived_at: datetime | None
    evidence: EvidenceOut


# ----------------------------------------------------------------------------- requests
class EvidenceCreate(_Strict):
    """Create one evidence row and attach it to the company / lead in the URL.

    `provider` is not accepted: the API records human callers as `manual`. `retrieved_at` defaults
    to the server's now(); `published_at` is optional and stays NULL when unknown.
    """

    id: ApiUuid
    kind: EvidenceKind
    url: EvidenceUrl | None = None
    reference: EvidenceRef | None = None
    snippet: EvidenceSnippet | None = None
    retrieved_at: AwareDatetime | None = None
    published_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _shape(self) -> EvidenceCreate:
        if self.url is None and self.reference is None:
            raise ValueError("a source needs a url or a reference")
        if (
            self.retrieved_at is not None
            and self.published_at is not None
            and self.published_at > self.retrieved_at
        ):
            raise ValueError("published_at cannot be after retrieved_at")
        return self
