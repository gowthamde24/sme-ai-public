"""Business KYC per VoiceLink client (Model B; migration 20261231991200; docs/contracts/business-kyc.md): the steps in plain words, identity numbers never echoed or logged, documents forwarded and dropped, the picker's `kyc_required`. VoiceLink is a fake transport; the database a fake repository."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import uuid
from typing import Any

import httpx
import pytest

from app.business_kyc.service import BusinessKycService
from app.numbers.buyer import BuyerSettings
from app.numbers.service import NumberService, PickerBlocked
from app.telephony.voicelink_api import VoicelinkApi
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}/phone-kyc/business"
PAN = "ABCDE1234F"


class Repo:
    def __init__(self) -> None:
        self.row: dict[str, Any] | None = None

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        return dict(self.row) if self.row else None

    def put(self, token: str, tenant_id: uuid.UUID, client_id: int, account_type: str | None, state: str, reason: str | None) -> dict[str, Any]:
        self.row = {"client_id": client_id, "account_type": account_type or (self.row or {}).get("account_type"), "state": state, "reason": reason}
        return dict(self.row)


class FakeVoiceLink:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any]] = []
        self.status_doc: dict[str, Any] = {"documents": {}, "current_step": "details", "kyc_status": 0}
        self.fail: dict[str, tuple[int, dict[str, Any]]] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.replace("/api/v1", "")
        if path == "/auth/login":
            return httpx.Response(200, json={"data": {"access_token": "t"}})
        body: Any = None
        if request.headers.get("content-type", "").startswith("application/json") and request.content:
            body = json.loads(request.content)
        elif request.method == "POST":
            body = {"multipart": True, "size": len(request.content)}
        self.calls.append((request.method, path, body))
        if path in self.fail:
            status, data = self.fail[path]
            return httpx.Response(status, json={"status": False, "data": data, "message": "x"})
        if path == "/reseller/client/create":
            return httpx.Response(200, json={"status": True, "data": {"client_id": 101}})
        if path == "/reseller/kyc/status":
            return httpx.Response(200, json={"status": True, "data": self.status_doc})
        if path == "/reseller/kyc/step-3-aadhaar-init":
            return httpx.Response(200, json={"status": True, "data": {"redirect_url": "https://digilocker.example/x"}})
        return httpx.Response(200, json={"status": True, "data": {"kyc_status": 0, "current_step": "pan"}})


def world() -> tuple[Any, Repo, FakeVoiceLink, BusinessKycService]:
    repo, vl = Repo(), FakeVoiceLink()
    api = VoicelinkApi("u", "p", base_url="https://vl.test/api/v1", client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(vl.handler)))
    service = BusinessKycService(repo, api, return_url="https://stack19.test/kyc/done")
    client, _ = make_client(business_kyc=service)
    return client, repo, vl, service


def test_it_is_off_without_the_service() -> None:
    client, _ = make_client()
    assert client.get(T, headers=auth("a_owner")).status_code == 404


def test_roles() -> None:
    client, *_ = world()
    assert client.get(T, headers=auth("a_sales")).status_code == 403
    assert client.get(T, headers=auth("a_admin")).status_code == 200
    assert client.post(f"{T}/start", headers=auth("a_admin")).status_code == 403
    assert client.post(f"{T}/pan", json={"pan_number": PAN, "holder_name": "A B"}, headers=auth("a_admin")).status_code == 403


def test_the_state_before_anything_is_started() -> None:
    client, *_ = world()
    out = client.get(T, headers=auth("a_owner")).json()
    assert out["state"] == "not_started" and out["steps"] == {}
    r = client.post(f"{T}/pan", json={"pan_number": PAN, "holder_name": "A B"}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["reason"] == "not_started"


def test_start_makes_one_client_with_our_wallet_and_never_twice() -> None:
    client, repo, vl, _ = world()
    r = client.post(f"{T}/start", headers=auth("a_owner"))
    assert r.status_code == 201 and r.json()["state"] == "created"
    created = [c for c in vl.calls if c[1] == "/reseller/client/create"]
    assert len(created) == 1
    body = created[0][2]
    assert body["wallet_bypass"] == 1 and body["channel_count"] == 1 and body["negative_threshold"] == 0 and body["username"].startswith("s19-")
    assert repo.row is not None and repo.row["client_id"] == 101
    client.post(f"{T}/start", headers=auth("a_owner"))
    assert len([c for c in vl.calls if c[1] == "/reseller/client/create"]) == 1


def test_the_steps_forward_the_numbers_and_never_echo_them(caplog: pytest.LogCaptureFixture) -> None:
    client, repo, vl, _ = world()
    client.post(f"{T}/start", headers=auth("a_owner"))
    d = client.post(f"{T}/details", json={"account_type": "business", "business_name": "Padma Silks", "full_name": "Padma Devi", "phone": "9848012345", "billing_address": "12 Main Road, Guntur", "accept_terms": True}, headers=auth("a_owner"))
    assert d.status_code == 200 and repo.row["state"] == "in_progress" and repo.row["account_type"] == "business"
    p = client.post(f"{T}/pan", json={"pan_number": PAN.lower(), "holder_name": "Padma Devi"}, headers=auth("a_owner"))
    g = client.post(f"{T}/gst", json={"gst_number": "37AAAAA0000A1Z5"}, headers=auth("a_owner"))
    assert p.status_code == 200 and g.status_code == 200
    sent = {c[1]: c[2] for c in vl.calls}
    assert sent["/reseller/kyc/step-2-pan-verify"]["pan_number"] == PAN and sent["/reseller/kyc/step-2-pan-verify"]["client_id"] == 101
    assert sent["/reseller/kyc/step-1-register-details"]["term_and_condition"] is True
    for out in (d.text, p.text, g.text):
        assert PAN not in out and "37AAAAA0000A1Z5" not in out and "9848012345" not in out
    assert PAN not in caplog.text and "37AAAAA0000A1Z5" not in caplog.text


def test_a_pan_mismatch_is_said_in_words() -> None:
    client, _, vl, _ = world()
    client.post(f"{T}/start", headers=auth("a_owner"))
    vl.fail["/reseller/kyc/step-2-pan-verify"] = (422, {"pan_match_status": 2})
    r = client.post(f"{T}/pan", json={"pan_number": PAN, "holder_name": "Wrong Name"}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["reason"] == "pan_mismatch" and "exactly as on the card" in r.json()["error"]["message"]


def test_aadhaar_gives_only_the_address_to_open() -> None:
    client, _, vl, _ = world()
    client.post(f"{T}/start", headers=auth("a_owner"))
    r = client.post(f"{T}/aadhaar", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"redirect_url": "https://digilocker.example/x"}
    assert [c[2] for c in vl.calls if c[1].endswith("aadhaar-init")][0]["redirect_url"] == "https://stack19.test/kyc/done"


def test_a_document_is_checked_forwarded_as_multipart_and_dropped() -> None:
    client, _, vl, _ = world()
    client.post(f"{T}/start", headers=auth("a_owner"))
    pdf = base64.b64encode(b"%PDF-1.4 hello").decode()
    ok = client.post(f"{T}/documents", json={"document_type": "pan", "content_type": "application/pdf", "content_base64": pdf}, headers=auth("a_owner"))
    assert ok.status_code == 200
    up = [c for c in vl.calls if c[1] == "/reseller/kyc/upload-document"]
    assert up and up[0][2]["multipart"] is True
    for bad in (base64.b64encode(b"not a pdf").decode(), "!!!not base64!!!", ""):
        r = client.post(f"{T}/documents", json={"document_type": "pan", "content_type": "application/pdf", "content_base64": bad}, headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["reason"] == "file_unreadable"
    assert client.post(f"{T}/documents", json={"document_type": "pan", "content_type": "text/html", "content_base64": pdf}, headers=auth("a_owner")).status_code == 422
    assert len([c for c in vl.calls if c[1] == "/reseller/kyc/upload-document"]) == 1


def test_submit_lists_what_is_missing_and_a_strange_refusal_tells_the_team() -> None:
    told: list[str] = []
    client, repo, vl, service = world()
    service._alert = told.append
    client.post(f"{T}/start", headers=auth("a_owner"))
    vl.fail["/reseller/kyc/final-submit"] = (422, {"missing_documents": ["PAN Card", "Aadhaar"]})
    r = client.post(f"{T}/submit", headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["missing"] == ["PAN Card", "Aadhaar"] and not told
    vl.fail["/reseller/kyc/final-submit"] = (422, {})
    r = client.post(f"{T}/submit", headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["reason"] == "stuck" and repo.row["state"] == "stuck" and len(told) == 1
    del vl.fail["/reseller/kyc/final-submit"]
    ok = client.post(f"{T}/submit", headers=auth("a_owner"))
    assert ok.status_code == 200 and repo.row["state"] == "submitted"


def test_voicelink_down_is_a_plain_503() -> None:
    client, _, vl, _ = world()
    vl.fail["/reseller/client/create"] = (500, {})
    r = client.post(f"{T}/start", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "kyc_unavailable"


def test_a_complete_kyc_is_noticed_and_only_then_a_client_for_buying() -> None:
    client, repo, vl, service = world()
    assert service.client_for("t", TENANT_A.id) is None
    client.post(f"{T}/start", headers=auth("a_owner"))
    assert service.client_for("t", TENANT_A.id) is None
    vl.status_doc = {"documents": {"pan": {"uploaded": True}}, "current_step": "gst", "kyc_status": 0}
    assert client.get(T, headers=auth("a_owner")).json()["steps"] == {"pan": True}
    vl.status_doc = {"documents": {"pan": {"uploaded": True}, "aadhaar": {"uploaded": True}}, "kyc_status": 1, "is_complete": True}
    assert service.client_for("t", TENANT_A.id) == 101 and repo.row["state"] == "verified"
    assert client.get(T, headers=auth("a_owner")).json()["state"] == "verified"


def test_the_picker_wants_a_verified_business_and_buys_under_its_own_client() -> None:
    class Numbers:
        begun = 0

        def check(self, *a: Any) -> None:
            return None

        def begin(self, *a: Any) -> uuid.UUID:
            Numbers.begun += 1
            return uuid.uuid4()

        def finish(self, *a: Any, **k: Any) -> None:
            return None

        def attach(self, *a: Any) -> dict[str, Any]:
            return {}

        def listing(self, *a: Any) -> list[dict[str, Any]]:
            return []

    bought: list[int] = []

    def fake_buy(api: Any, settings: BuyerSettings, number: str, kind: str) -> Any:
        bought.append(settings.client_id)
        from app.numbers.buyer import Bought

        return Bought(number=number, did_id=1, order_number="o", stage="routed", cost_inr=300.0)

    import app.numbers.service as svc

    original = svc.buy
    svc.buy = fake_buy  # type: ignore[assignment]
    try:
        clients = {"none": None}
        service = NumberService(Numbers(), None, BuyerSettings(client_id=5879, bot_id=1), client_for=lambda token, tenant: clients.get("c"))  # type: ignore[arg-type]
        with pytest.raises(PickerBlocked) as err:
            service.claim("t", TENANT_A.id, "+919876543210", "mobile")
        assert err.value.reason == "kyc_required" and Numbers.begun == 0   # nothing was reserved
        clients["c"] = 101  # type: ignore[assignment]
        service.claim("t", TENANT_A.id, "+919876543210", "mobile")
        assert bought == [101]
    finally:
        svc.buy = original
