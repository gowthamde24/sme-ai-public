"""Shapes of the business KYC routes (docs/contracts/business-kyc.md). Identity numbers go in, never come back out."""

# ruff: noqa: E501

from typing import Literal

from pydantic import BaseModel, ConfigDict


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
    """Lenient on purpose: every rule is checked by app/business_kyc/rules.py, which answers 422 `kyc_fields_invalid` with a closed word per field (`reasons`), never the value."""

    account_type: str | None = None
    business_name: str | None = None
    full_name: str | None = None
    phone: str | None = None
    billing_address: str | None = None
    state: str | None = None
    city: str | None = None
    pincode: str | None = None
    accept_terms: bool | None = None


class PanIn(_Strict):
    pan_number: str | None = None
    holder_name: str | None = None


class GstIn(_Strict):
    gst_number: str | None = None


class AadhaarOut(_Strict):
    redirect_url: str


class UploadIn(_Strict):
    document_type: str | None = None   # pan | aadhaar | gst (checked by rules.check_document)
    content_type: str | None = None    # image/jpeg | image/png | application/pdf
    content_base64: str
