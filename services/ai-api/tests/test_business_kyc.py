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


def _numbers_world(kyc: Any, vl_buy: Any = None) -> tuple[Any, list[Any], list[int]]:
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
            return [{"number": "+919876543210", "kind": "mobile", "state": "calls_off", "label": None}]

    import app.numbers.service as svc
    from app.numbers.buyer import Bought

    bought: list[int] = []

    def fake_buy(api: Any, settings: BuyerSettings, number: str, kind: str) -> Any:
        bought.append(settings.client_id)
        if vl_buy is not None:
            return vl_buy(settings, number)
        return Bought(number=number, did_id=1, order_number="o", stage="routed", cost_inr=300.0)

    original = svc.buy
    svc.buy = fake_buy  # type: ignore[assignment]
    service = NumberService(Numbers(), None, BuyerSettings(client_id=5879, bot_id=1), kyc=kyc)  # type: ignore[arg-type]
    return service, [original], bought


def test_buy_first_verify_after_the_number_is_bought_for_the_businesses_own_client_and_is_kyc_pending() -> None:
    client, repo, vl, kyc = world()
    service, restore, bought = _numbers_world(kyc)
    import app.numbers.service as svc

    try:
        out = service.claim("t", TENANT_A.id, "+919876543210", "mobile", email="owner@example.test", name="Padma Silks")
        assert out.state == "kyc_pending" and bought == [101]   # the client was made now (with the owner's e-mail) and the number bought for it
        assert [c for c in vl.calls if c[1] == "/reseller/client/create"][0][2]["email"] == "owner@example.test"
        assert service.numbers("t", TENANT_A.id)[0]["state"] == "kyc_pending"
        vl.status_doc = {"documents": {}, "kyc_status": 1, "is_complete": True}
        assert service.numbers("t", TENANT_A.id)[0]["state"] == "calls_off" and repo.row is not None and repo.row["state"] == "verified"
        assert service.claim("t", TENANT_A.id, "+919876543211", "mobile").state == "ready"
        assert len([c for c in vl.calls if c[1] == "/reseller/client/create"]) == 1, "one client per business"
    finally:
        svc.buy = restore[0]


def test_voicelink_refusing_for_an_unverified_client_falls_back_to_kyc_required_or_keeps_the_paid_number() -> None:
    import app.numbers.service as svc
    from app.numbers.buyer import Bought, PickerRefused

    client, repo, vl, kyc = world()

    def refuse(settings: BuyerSettings, number: str) -> Any:
        raise PickerRefused("kyc_required")

    service, restore, _ = _numbers_world(kyc, refuse)
    try:
        with pytest.raises(PickerBlocked) as err:
            service.claim("t", TENANT_A.id, "+919876543210", "mobile", email="o@example.test", name="X")
        assert err.value.reason == "kyc_required"
    finally:
        svc.buy = restore[0]
    told: list[str] = []
    service, restore, _ = _numbers_world(kyc, lambda s, n: Bought(number=n, did_id=1, order_number="o", stage="bought", cost_inr=300.0, kyc_refused=True))
    service._alert = told.append
    try:
        out = service.claim("t", TENANT_A.id, "+919876543212", "mobile", email="o@example.test", name="X")
        assert out.state == "kyc_pending" and len(told) == 1
    finally:
        svc.buy = restore[0]


def test_a_voicelink_client_that_cannot_be_made_is_kyc_required() -> None:
    import app.numbers.service as svc

    client, repo, vl, kyc = world()
    vl.fail["/reseller/client/create"] = (422, {})
    service, restore, bought = _numbers_world(kyc)
    try:
        with pytest.raises(PickerBlocked) as err:
            service.claim("t", TENANT_A.id, "+919876543210", "mobile", email="o@example.test", name="X")
        assert err.value.reason == "kyc_required" and bought == []
    finally:
        svc.buy = restore[0]


def test_the_worker_marks_the_businesses_voicelink_has_approved() -> None:
    client, repo, vl, kyc = world()
    client.post(f"{T}/start", headers=auth("a_owner"))

    class Rpc:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, Any]]] = []

        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            self.calls.append((function, args))
            return [{"tenant_id": str(TENANT_A.id), "client_id": 101}] if function == "business_client_pending" else None

    rpc = Rpc()
    assert kyc.refresh_pending("sys", rpc) == 0 and [c[0] for c in rpc.calls] == ["business_client_pending"]
    vl.status_doc = {"documents": {}, "kyc_status": 1, "is_complete": True}
    assert kyc.refresh_pending("sys", rpc) == 1 and rpc.calls[-1] == ("business_client_mark_verified", {"p_tenant_id": str(TENANT_A.id)})
