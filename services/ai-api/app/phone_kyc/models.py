"""The in-app KYC of a business's phone number (owner decision 14 Nov 2026). The document passes through our server in memory only; these are the shapes."""

# ruff: noqa: E501

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    StringConstraints,
    field_validator,
    model_validator,
)

DocKind = Literal["gst", "coi", "udyam"]
Status = Literal["not_started", "preparing", "submitted", "accepted", "rejected", "suspended", "expired", "failed"]
MAX_FILE_BYTES = 5_000_000   # Plivo's own limit per file
FILE_TYPES = ("application/pdf", "image/jpeg", "image/png")

# the number printed on each document (checked in shape only: Plivo and the registry decide whether it is real)
NUMBER_SHAPE: dict[str, re.Pattern[str]] = {
    "gst": re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"),
    "udyam": re.compile(r"^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$"),
    "coi": re.compile(r"^([LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}|[A-Z]{3}-[0-9]{4})$"),   # a company's CIN, or an LLP's LLPIN
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentIn(_Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=99)]
    content_type: Literal["application/pdf", "image/jpeg", "image/png"]
    data_base64: Annotated[str, StringConstraints(min_length=4, max_length=7_200_000)]   # 5 MB as base64


class KycIn(_Strict):
    """File the application. `kyc_id` is the caller's (a retry files once). ONE of the three documents is enough; the document's own number goes in `registration_number`."""

    kyc_id: uuid.UUID
    doc_kind: DocKind
    legal_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]   # the business's legal name exactly as on the document
    registration_number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=30)]   # GSTIN, Udyam number or CIN/LLPIN
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=120)]
    address_line1: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    address_line2: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    city: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]
    state: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]
    postal_code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[1-9][0-9]{5}$")]
    document: DocumentIn

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,120}\.[A-Za-z]{2,}", v):
            raise ValueError("not an e-mail address")
        return v

    @model_validator(mode="after")
    def _number_matches_the_document(self) -> KycIn:
        self.registration_number = self.registration_number.upper().replace(" ", "")
        if not NUMBER_SHAPE[self.doc_kind].fullmatch(self.registration_number):
            raise ValueError("the number does not look like that document's number")
        return self


class KycOut(_Strict):
    state: Status
    kyc_id: uuid.UUID | None = None
    doc_kind: DocKind | None = None
    compliance_id: str | None = None
    # Plivo's own words for a rejection (Owner and Admin only)
    reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    checked_at: datetime | None = None
    # false while the owner has not switched real filing on: a submit is checked and answered but nothing is sent to Plivo
    live: bool = False
    # true once Plivo accepted it: a number can be chosen next (renting one still needs the owner's OK)
    can_choose_number: bool = False


class DocOptionOut(_Strict):
    kind: DocKind
    number_label: str          # what the number is called: "GSTIN", "Udyam registration number", "CIN / LLPIN"
    number_example: str
    plivo_document: str        # the Plivo document type this goes under (for the support view)


class OptionsOut(_Strict):
    live: bool
    documents: list[DocOptionOut]
    max_file_bytes: int
    file_types: list[str]
    kept_note: str = "The document is sent to Plivo and not kept by Stack19."
