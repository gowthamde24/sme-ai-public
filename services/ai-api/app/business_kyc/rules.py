"""The rules of the business KYC forms, checked on the server (the web checks the same ones first; docs/contracts/business-kyc.md, "Field rules").

Pure: no network, no database. A refusal is a closed word per field (`reasons`), never the value: a PAN, a GSTIN, a phone number or an address is never echoed back and never logged here."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Any

from app.errors import ApiError

# the 28 states and 8 union territories (2026); the form's state is one of these, matched without regard to case or extra spaces
INDIAN_STATES: tuple[str, ...] = (
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
)
_STATE_BY_KEY = {re.sub(r"\s+", " ", s).casefold(): s for s in INDIAN_STATES}
MOBILE = re.compile(r"^[6-9][0-9]{9}$")
PINCODE = re.compile(r"^[1-9][0-9]{5}$")
PAN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
GSTIN = re.compile(r"^(0[1-9]|[12][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
DOCUMENT_TYPES = ("pan", "aadhaar", "gst")
FILE_TYPES = ("image/jpeg", "image/png", "application/pdf")
CLEAN = re.compile(r"^[^<>{}\\|\x00-\x1f]*$")   # no markup or control characters in a free-text field

# the closed words, with the sentence the screen may show
REASONS: dict[str, str] = {
    "account_type_required": "Choose whether this is for an individual or a business.",
    "business_name_required": "Enter the business name.",
    "name_required": "Enter the full name (2 to 120 characters).",
    "mobile_invalid": "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.",
    "address_required": "Enter the billing address (at least 8 characters).",
    "city_required": "Enter the city.",
    "state_invalid": "Choose the state from the list.",
    "pincode_invalid": "Enter the 6-digit PIN code.",
    "terms_required": "Please accept the terms to continue.",
    "pan_invalid": "A PAN has 5 letters, 4 digits and 1 letter, like AAAAA9999A.",
    "gstin_invalid": "A GSTIN has 15 characters, like 22AAAAA0000A1Z5.",
    "gstin_business_only": "A GSTIN is only for a business account.",
    "document_type_invalid": "Choose PAN, Aadhaar or GST.",
    "file_type_invalid": "Upload a JPG, PNG or PDF file.",
}


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", value).strip() if isinstance(value, str) else ""


def refuse(reasons: dict[str, str]) -> ApiError:
    """422 `kyc_fields_invalid`: `fields` (the names) and `reasons` (the closed word of each); never a value."""
    return ApiError(422, "kyc_fields_invalid", "Please correct the marked fields.", extra={"fields": sorted(reasons), "reasons": reasons})


def national_mobile(value: Any) -> str | None:
    """The 10 digits of an Indian mobile typed as `98765 43210`, `+91 98765 43210`, `091-98765-43210` or `919876543210`; None when it is not one."""
    digits = re.sub(r"[\s().-]", "", _text(value))
    if digits.startswith("+"):
        digits = digits[1:]
    elif re.fullmatch(r"0[0-9]{10}", digits):
        digits = digits[1:]
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits if MOBILE.fullmatch(digits) else None


def check_details(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """(the cleaned fields to send, the refusals by field). Every field the owner listed is mandatory; the business name is mandatory for a business."""
    bad: dict[str, str] = {}
    account_type = raw.get("account_type")
    if account_type not in ("individual", "business"):
        bad["account_type"] = "account_type_required"
    full_name = _text(raw.get("full_name"))
    if not 2 <= len(full_name) <= 120 or not CLEAN.match(full_name):
        bad["full_name"] = "name_required"
    business_name = _text(raw.get("business_name"))
    if account_type == "business" and (not 2 <= len(business_name) <= 120 or not CLEAN.match(business_name)):
        bad["business_name"] = "business_name_required"
    phone = national_mobile(raw.get("phone"))
    if phone is None:
        bad["phone"] = "mobile_invalid"
    address = _text(raw.get("billing_address"))
    if not 8 <= len(address) <= 300 or not CLEAN.match(address):
        bad["billing_address"] = "address_required"
    city = _text(raw.get("city"))
    if not 1 <= len(city) <= 60 or not CLEAN.match(city):
        bad["city"] = "city_required"
    state = _STATE_BY_KEY.get(re.sub(r"\s+", " ", _text(raw.get("state"))).casefold())
    if state is None:
        bad["state"] = "state_invalid"
    pincode = _text(raw.get("pincode"))
    if not PINCODE.fullmatch(pincode):
        bad["pincode"] = "pincode_invalid"
    if raw.get("accept_terms") is not True:
        bad["accept_terms"] = "terms_required"
    clean: dict[str, Any] = {"account_type": account_type, "full_name": full_name, "phone": phone, "billing_address": address, "city": city, "state": state, "pincode": pincode}
    if account_type == "business":
        clean["business_name"] = business_name
    return clean, bad


def check_pan(raw: dict[str, Any]) -> tuple[str, str, dict[str, str]]:
    bad: dict[str, str] = {}
    pan = _text(raw.get("pan_number")).upper()
    if not PAN.fullmatch(pan):
        bad["pan_number"] = "pan_invalid"
    holder = _text(raw.get("holder_name"))
    if not 2 <= len(holder) <= 120 or not CLEAN.match(holder):
        bad["holder_name"] = "name_required"
    return pan, holder, bad


def check_gstin(raw: dict[str, Any], account_type: str | None) -> tuple[str, dict[str, str]]:
    gstin = _text(raw.get("gst_number")).upper()
    if account_type == "individual":
        return gstin, {"gst_number": "gstin_business_only"}
    return gstin, ({} if GSTIN.fullmatch(gstin) else {"gst_number": "gstin_invalid"})


def check_document(raw: dict[str, Any]) -> dict[str, str]:
    bad: dict[str, str] = {}
    if raw.get("document_type") not in DOCUMENT_TYPES:
        bad["document_type"] = "document_type_invalid"
    if raw.get("content_type") not in FILE_TYPES:
        bad["content_type"] = "file_type_invalid"
    return bad
