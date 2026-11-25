"""The server-side rules of the business KYC forms (app/business_kyc/rules.py; docs/contracts/business-kyc.md, "Field rules"): every field mandatory, a closed word per field, a value never echoed or logged. Made-up values only."""

# ruff: noqa: E501
from __future__ import annotations

import base64
import logging
from typing import Any

import pytest

from app.business_kyc import rules
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}/phone-kyc/business"
GOOD: dict[str, Any] = {"account_type": "business", "business_name": "Test Textiles", "full_name": "Test Person", "phone": "98765 43210", "billing_address": "12 Test Road, Test Town", "city": "Hyderabad",
                        "state": "telangana", "pincode": "500001", "accept_terms": True}
MADE_UP_PAN = "AAAAA9999A"
MADE_UP_GSTIN = "36AAAAA9999A1Z5"
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()


class Stub:
    """Stands for the service: remembers what reached it."""

    def __init__(self, account_type: str | None = "business") -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.account_type = account_type

    def _status(self) -> dict[str, Any]:
        return {"state": "in_progress", "account_type": self.account_type, "step": None, "steps": {}, "missing": [], "reason": None, "words": None}

    def status(self, token: str, tenant: Any) -> dict[str, Any]:
        return self._status()

    def details(self, token: str, tenant: Any, fields: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("details", (fields,)))
        return self._status()

    def pan(self, token: str, tenant: Any, number: str, holder: str) -> dict[str, Any]:
        self.calls.append(("pan", (number, holder)))
        return self._status()

    def gst(self, token: str, tenant: Any, number: str) -> dict[str, Any]:
        self.calls.append(("gst", (number,)))
        return self._status()

    def upload(self, token: str, tenant: Any, kind: str, content_type: str, content: str) -> dict[str, Any]:
        self.calls.append(("upload", (kind, content_type)))
        return self._status()


def world(account_type: str | None = "business") -> tuple[Any, Stub]:
    stub = Stub(account_type)
    client, _ = make_client(business_kyc=stub)
    return client, stub


# ------------------------------------------------------------------------------------------------ pure rules
@pytest.mark.parametrize(("typed", "expected"), [
    ("9876543210", "9876543210"), ("98765 43210", "9876543210"), ("+91 98765 43210", "9876543210"), ("+919876543210", "9876543210"), ("919876543210", "9876543210"), ("09876543210", "9876543210"), ("(987) 654-3210", "9876543210"),
    ("5876543210", None), ("987654321", None), ("98765432101", None), ("abcdefghij", None), ("", None), (None, None), ("+1 9876543210", None),
])
def test_an_indian_mobile_is_ten_digits_starting_with_6_to_9(typed: Any, expected: str | None) -> None:
    assert rules.national_mobile(typed) == expected


def test_good_details_are_cleaned_and_every_other_field_is_a_closed_word() -> None:
    clean, bad = rules.check_details(dict(GOOD))
    assert bad == {} and clean["phone"] == "9876543210" and clean["state"] == "Telangana" and clean["business_name"] == "Test Textiles"
    _, none = rules.check_details({})
    assert none == {"account_type": "account_type_required", "full_name": "name_required", "phone": "mobile_invalid", "billing_address": "address_required", "city": "city_required", "state": "state_invalid", "pincode": "pincode_invalid", "accept_terms": "terms_required"}
    for field, value, word in (("full_name", "A", "name_required"), ("phone", "12345", "mobile_invalid"), ("billing_address", "short", "address_required"), ("city", "  ", "city_required"), ("state", "Atlantis", "state_invalid"),
                               ("pincode", "012345", "pincode_invalid"), ("pincode", "50000", "pincode_invalid"), ("pincode", "5000011", "pincode_invalid"), ("accept_terms", False, "terms_required"), ("account_type", "company", "account_type_required"),
                               ("full_name", "<b>x</b>", "name_required")):
        _, bad = rules.check_details({**GOOD, field: value})
        assert bad == {field: word}, (field, value)
    assert rules.check_details({**GOOD, "business_name": ""})[1] == {"business_name": "business_name_required"}
    assert rules.check_details({**GOOD, "account_type": "individual", "business_name": ""})[1] == {}, "an individual needs no business name"


def test_every_state_and_territory_of_the_list_is_accepted() -> None:
    assert len(rules.INDIAN_STATES) == 36
    for name in rules.INDIAN_STATES:
        assert rules.check_details({**GOOD, "state": name.upper()})[1] == {}, name


@pytest.mark.parametrize(("pan", "ok"), [("AAAAA9999A", True), ("aaaaa9999a", True), (" AAAAA9999A ", True), ("AAAA99999A", False), ("AAAAA9999", False), ("AAAAA99999", False), ("1AAAA9999A", False), ("AAAAA9999AA", False), ("", False)])
def test_a_pan_is_five_letters_four_digits_one_letter(pan: str, ok: bool) -> None:
    value, holder, bad = rules.check_pan({"pan_number": pan, "holder_name": "Test Person"})
    assert (bad == {}) is ok and (not ok or value == "AAAAA9999A") and holder == "Test Person"


@pytest.mark.parametrize(("gstin", "ok"), [("36AAAAA9999A1Z5", True), ("36aaaaa9999a1z5", True), ("00AAAAA9999A1Z5", False), ("39AAAAA9999A1Z5", False), ("36AAAAA9999A1X5", False), ("36AAAAA9999A0Z5", False), ("36AAAAA9999A1Z", False), ("", False)])
def test_a_gstin_is_fifteen_characters_with_a_state_code(gstin: str, ok: bool) -> None:
    assert (rules.check_gstin({"gst_number": gstin}, "business")[1] == {}) is ok
    assert rules.check_gstin({"gst_number": MADE_UP_GSTIN}, "individual")[1] == {"gst_number": "gstin_business_only"}


# ------------------------------------------------------------------------------------------------ the routes
def test_details_with_missing_fields_is_a_422_with_a_word_per_field_and_the_service_is_never_reached() -> None:
    client, stub = world()
    sent = {"account_type": "business", "full_name": "T", "phone": "5876543210", "billing_address": "x", "state": "Nowhere", "pincode": "1", "accept_terms": False}
    got = client.post(f"{T}/details", json=sent, headers=auth("a_owner"))
    assert got.status_code == 422 and got.json()["error"]["code"] == "kyc_fields_invalid"
    assert got.json()["error"]["reasons"] == {"full_name": "name_required", "business_name": "business_name_required", "phone": "mobile_invalid", "billing_address": "address_required", "city": "city_required", "state": "state_invalid", "pincode": "pincode_invalid", "accept_terms": "terms_required"}
    assert got.json()["error"]["fields"] == sorted(got.json()["error"]["reasons"]) and stub.calls == []
    for value in ("5876543210", "Nowhere"):
        assert value not in got.text, "no value is ever echoed"


def test_good_details_reach_the_service_cleaned() -> None:
    client, stub = world()
    assert client.post(f"{T}/details", json=GOOD, headers=auth("a_owner")).status_code == 200
    fields = stub.calls[0][1][0]
    assert fields["phone"] == "9876543210" and fields["state"] == "Telangana" and fields["pincode"] == "500001" and "accept_terms" not in fields
    assert client.post(f"{T}/details", json={**GOOD, "unexpected": 1}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{T}/details", json=GOOD, headers=auth("a_sales")).status_code == 403


def test_pan_gstin_and_document_rules_on_the_routes_and_no_identity_number_comes_back_or_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    client, stub = world()
    with caplog.at_level(logging.DEBUG):
        bad_pan = client.post(f"{T}/pan", json={"pan_number": "AAAA99999A", "holder_name": "Test Person"}, headers=auth("a_owner"))
        assert bad_pan.status_code == 422 and bad_pan.json()["error"]["reasons"] == {"pan_number": "pan_invalid"} and "AAAA99999A" not in bad_pan.text
        no_name = client.post(f"{T}/pan", json={"pan_number": MADE_UP_PAN, "holder_name": ""}, headers=auth("a_owner"))
        assert no_name.json()["error"]["reasons"] == {"holder_name": "name_required"} and MADE_UP_PAN not in no_name.text
        ok = client.post(f"{T}/pan", json={"pan_number": "aaaaa9999a", "holder_name": "Test Person"}, headers=auth("a_owner"))
        assert ok.status_code == 200 and stub.calls[-1] == ("pan", (MADE_UP_PAN, "Test Person")) and MADE_UP_PAN not in ok.text
        bad_gst = client.post(f"{T}/gst", json={"gst_number": "36AAAAA9999A1X5"}, headers=auth("a_owner"))
        assert bad_gst.json()["error"]["reasons"] == {"gst_number": "gstin_invalid"} and "36AAAAA9999A1X5" not in bad_gst.text
        assert client.post(f"{T}/gst", json={"gst_number": MADE_UP_GSTIN}, headers=auth("a_owner")).status_code == 200 and list(stub.calls)[-1] == ("gst", (MADE_UP_GSTIN,))
    assert MADE_UP_PAN not in caplog.text and MADE_UP_GSTIN not in caplog.text
    individual, _ = world("individual")
    refused = individual.post(f"{T}/gst", json={"gst_number": MADE_UP_GSTIN}, headers=auth("a_owner"))
    assert refused.status_code == 422 and refused.json()["error"]["reasons"] == {"gst_number": "gstin_business_only"}
    wrong = client.post(f"{T}/documents", json={"document_type": "passport", "content_type": "image/gif", "content_base64": PNG}, headers=auth("a_owner"))
    assert wrong.json()["error"]["reasons"] == {"document_type": "document_type_invalid", "content_type": "file_type_invalid"}
    assert client.post(f"{T}/documents", json={"document_type": "pan", "content_type": "image/png", "content_base64": PNG}, headers=auth("a_owner")).status_code == 200
    assert stub.calls[-1] == ("upload", ("pan", "image/png"))


def test_every_closed_word_has_a_plain_sentence() -> None:
    for word in ("account_type_required", "business_name_required", "name_required", "mobile_invalid", "address_required", "city_required", "state_invalid", "pincode_invalid", "terms_required", "pan_invalid", "gstin_invalid", "gstin_business_only", "document_type_invalid", "file_type_invalid"):
        assert rules.REASONS[word].endswith((".", "?")) and word in rules.REASONS
