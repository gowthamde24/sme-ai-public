"""Shapes of the business KYC routes (docs/contracts/business-kyc.md). Identity numbers go in, never come back out."""

# ruff: noqa: E501

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StatusOut(_Strict):
    state: Literal["not_started", "created", "in_progress", "submitted", "verified", "stuck"]
    account_type: Literal["individual", "business"] | None
    step: str | None
    steps: dict[str, bool]
    missing: list[str]
    reason: str | None
    words: str | None


class DetailsIn(_Strict):
    account_type: Literal["individual", "business"]
    business_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)] | None = None
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    phone: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9 ()-]{10,16}$")]
    billing_address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=300)]
    state: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None
    city: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None
    pincode: Annotated[str, StringConstraints(pattern=r"^[0-9]{6}$")] | None = None
    accept_terms: Literal[True]


class PanIn(_Strict):
    pan_number: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z]{5}[0-9]{4}[A-Za-z]$")]
    holder_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]


class GstIn(_Strict):
    gst_number: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{2}[A-Za-z0-9]{10}[0-9][A-Za-z0-9]{2}$")]


class AadhaarOut(_Strict):
    redirect_url: str


class UploadIn(_Strict):
    document_type: Literal["pan", "aadhaar", "gst"]
    content_type: Literal["image/jpeg", "image/png", "application/pdf"]
    content_base64: str


def details_fields(body: DetailsIn) -> dict[str, Any]:
    out: dict[str, Any] = {"account_type": body.account_type, "full_name": body.full_name, "phone": body.phone, "billing_address": body.billing_address}
    for key in ("business_name", "state", "city", "pincode"):
        value = getattr(body, key)
        if value:
            out[key] = value
    return out
