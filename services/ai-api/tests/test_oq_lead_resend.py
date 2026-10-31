"""Lead e-mails received through Resend (leads.stack19.com, owner 30 Oct 2026): the Svix signature, the `email.received` event, the fetch of the mail with the LEADS key, and the hand-over to the same lead reader as every other forwarded mail.
Against fakes and httpx's mock transport: no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.lead_sources import resend_inbound as ri
from app.lead_sources.service import LeadSourcesService
from app.lead_sources.wiring import build_lead_sources
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"
KEY = b"0123456789abcdef0123456789abcdef"
SECRET = "whsec_" + base64.b64encode(KEY).decode()
EMAIL_ID = "56761188-7520-42d8-8898-ff6fc54ce618"
INDIAMART_BODY = "Buyer Name: Ravi Kumar\nMobile: +91-98765 43210\nEmail: ravi@example.test\nCity: Hyderabad\nRequirement: Need 40 sarees for a wedding\n"


def sign(raw: bytes, *, svix_id: str = "msg_1", at: float | None = None, key: bytes = KEY) -> dict[str, str]:
    ts = str(int(time.time() if at is None else at))
    digest = base64.b64encode(hmac.new(key, f"{svix_id}.{ts}.".encode() + raw, hashlib.sha256).digest()).decode()
    return {"svix-id": svix_id, "svix-timestamp": ts, "svix-signature": f"v1,{digest}", "content-type": "application/json"}


def event(email_id: str = EMAIL_ID, kind: str = "email.received") -> bytes:
    return json.dumps({"type": kind, "created_at": "2026-10-30T12:00:00Z", "data": {"email_id": email_id, "from": "x@y.test", "to": ["leads@leads.stack19.com"], "subject": "s", "message_id": "<m>"}}).encode()


def world(address: str | None = "+", **mail: Any) -> tuple[Any, FakeLeadSourcesRepository, ri.FakeMailFetcher, str]:
    repo = FakeLeadSourcesRepository()
    fetcher = ri.FakeMailFetcher()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.stack19.com", public_base_url="https://api.example.test", resend=ri.ResendInbound(SECRET, fetcher))
    client, _ = make_client(lead_sources=service)
    made = client.post(T + "/lead-sources", json={"source_id": str(uuid.uuid4()), "kind": "email_forward", "label": "Forwarded", "portal": "indiamart"}, headers=auth("a_owner")).json()
    to = made["secret"]["email_address"]
    fetcher.mails[EMAIL_ID] = ri.ReceivedMail(sender=mail.get("sender", "leads@indiamart.com"), to=(to,), subject=mail.get("subject", "Buyer Enquiry for Silk Sarees"), text=mail.get("text", INDIAMART_BODY), message_id="<abc@mail.test>")
    return client, repo, fetcher, to


def post(client: Any, raw: bytes, headers: dict[str, str] | None = None) -> Any:
    return client.post("/v1/lead-intake/resend", content=raw, headers=sign(raw) if headers is None else headers)


# ---- the signature
def test_a_correct_svix_signature_passes_and_each_wrong_one_does_not() -> None:
    raw = b'{"type":"email.received"}'
    h = sign(raw)
    assert ri.signature_ok(SECRET, h["svix-id"], h["svix-timestamp"], h["svix-signature"], raw)
    other = sign(raw, key=b"another-key-another-key-another-k")
    assert not ri.signature_ok(SECRET, other["svix-id"], other["svix-timestamp"], other["svix-signature"], raw)
    assert not ri.signature_ok(SECRET, h["svix-id"], h["svix-timestamp"], h["svix-signature"], raw + b" ")   # the body changed
    assert not ri.signature_ok(SECRET, "msg_2", h["svix-timestamp"], h["svix-signature"], raw)   # the id changed
    old = sign(raw, at=time.time() - 3600)
    assert not ri.signature_ok(SECRET, old["svix-id"], old["svix-timestamp"], old["svix-signature"], raw), "an hour old"
    assert not ri.signature_ok(SECRET, h["svix-id"], "soon", h["svix-signature"], raw)
    assert not ri.signature_ok(SECRET, h["svix-id"], h["svix-timestamp"], "v2," + h["svix-signature"].split(",")[1], raw), "only v1"
    assert not ri.signature_ok("", h["svix-id"], h["svix-timestamp"], h["svix-signature"], raw) and not ri.signature_ok("whsec_!!", h["svix-id"], h["svix-timestamp"], h["svix-signature"], raw)
    assert not ri.signature_ok(SECRET, None, None, None, raw)


def test_the_published_svix_example_verifies() -> None:
    """The example in Svix's own documentation (secret, id, timestamp, body and the signature it gives), so the check is not only tested against itself."""
    assert ri.signature_ok("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=", b'{"test": 2432232314}', now=1614265330)


def test_a_header_with_several_signatures_passes_when_one_is_right() -> None:
    raw = b"{}"
    h = sign(raw)
    assert ri.signature_ok(SECRET, h["svix-id"], h["svix-timestamp"], "v1,AAAA " + h["svix-signature"], raw)


# ---- the route
def test_a_lead_mail_arrives_is_fetched_with_the_event_s_id_and_becomes_a_lead() -> None:
    client, repo, fetcher, _ = world()
    r = post(client, event())
    assert r.status_code == 202 and r.json() == {"status": "received"}
    assert fetcher.fetched == [EMAIL_ID]
    contact = list(repo.contacts.values())[0]
    assert contact["name"] == "Ravi Kumar" and contact["phone"] == "+919876543210"


def test_an_unsigned_or_wrongly_signed_call_is_refused_before_anything_is_fetched() -> None:
    client, repo, fetcher, _ = world()
    raw = event()
    assert client.post("/v1/lead-intake/resend", content=raw).status_code == 401
    assert client.post("/v1/lead-intake/resend", content=raw, headers=sign(raw, key=b"x" * 32)).status_code == 401
    assert client.post("/v1/lead-intake/resend", content=b"not json", headers=sign(b"x")).status_code == 401
    assert fetcher.fetched == [] and repo.contacts == {}


def test_another_kind_of_event_is_acknowledged_and_ignored() -> None:
    client, repo, fetcher, _ = world()
    r = post(client, event(kind="email.delivered"))
    assert r.status_code == 202 and r.json() == {"status": "ignored"} and fetcher.fetched == []
    r = post(client, json.dumps({"type": "email.received", "data": {"email_id": "../../x"}}).encode())
    assert r.json() == {"status": "ignored"} and fetcher.fetched == [], "an id that is not a UUID is never put in a URL"
    assert post(client, b"not json").json() == {"status": "ignored"}


def test_a_mail_that_cannot_be_fetched_is_a_502_so_that_resend_tries_again() -> None:
    client, repo, fetcher, _ = world()
    r = post(client, event(email_id=str(uuid.uuid4())))
    assert r.status_code == 502 and repo.contacts == {}


def test_a_mail_to_an_unknown_or_rotated_address_is_acknowledged_and_nothing_is_stored() -> None:
    client, repo, fetcher, to = world()
    fetcher.mails[EMAIL_ID] = ri.ReceivedMail(sender="leads@indiamart.com", to=("leads+" + "a" * 24 + "@leads.stack19.com",), subject="Buyer Enquiry", text=INDIAMART_BODY)
    assert post(client, event()).json() == {"status": "unrecognised"} and repo.contacts == {}
    fetcher.mails[EMAIL_ID] = ri.ReceivedMail(sender="a@b.test", to=("someone@leads.stack19.com",), text="hi")
    assert post(client, event()).json() == {"status": "unrecognised"}


def test_a_mail_that_is_not_a_lead_is_kept_for_the_owner_to_look_at() -> None:
    client, repo, _, _ = world(sender="friend@gmail.test", subject="hello", text="call me back")
    assert post(client, event()).json() == {"status": "unrecognised"}
    assert repo.contacts == {} and len(repo.unparsed_) == 1


def test_the_route_answers_503_until_both_secrets_are_set() -> None:
    repo = FakeLeadSourcesRepository()
    client, _ = make_client(lead_sources=LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.stack19.com"))
    raw = event()
    assert client.post("/v1/lead-intake/resend", content=raw, headers=sign(raw)).status_code == 503


# ---- the fetch
def test_the_mail_is_fetched_from_resend_with_the_leads_key_and_read() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"] = str(request.url), request.headers.get("authorization")
        return httpx.Response(200, json={"from": "IndiaMART <leads@indiamart.com>", "to": ["Leads <leads+" + "a" * 24 + "@leads.stack19.com>"], "subject": "  Buyer\nEnquiry ", "text": None, "html": "<p>Buyer Name: Ravi</p><p>Mobile: 98765 43210</p>", "message_id": "<x@y>", "received_for": ["leads+" + "b" * 24 + "@leads.stack19.com"]})

    got = ri.ResendMailFetcher("re_leads_key", client=httpx.Client(transport=httpx.MockTransport(handler))).fetch(EMAIL_ID)
    assert seen["url"] == f"https://api.resend.com/emails/receiving/{EMAIL_ID}" and seen["auth"] == "Bearer re_leads_key"
    assert got.sender == "leads@indiamart.com" and got.to == ("leads+" + "a" * 24 + "@leads.stack19.com", "leads+" + "b" * 24 + "@leads.stack19.com")
    assert got.subject == "Buyer Enquiry" and "Buyer Name: Ravi" in got.text and "Mobile: 98765 43210" in got.text and "<p>" not in got.text and got.message_id == "<x@y>"


@pytest.mark.parametrize("response", [httpx.Response(401, json={"message": "no"}), httpx.Response(200, json=["x"]), httpx.Response(500, text="oops")])
def test_a_refusal_or_a_strange_answer_from_resend_is_a_fetch_error_that_leaks_nothing(response: httpx.Response) -> None:
    fetcher = ri.ResendMailFetcher("re_secret_key_value", client=httpx.Client(transport=httpx.MockTransport(lambda _: response)))
    with pytest.raises(ri.ResendError) as err:
        fetcher.fetch(EMAIL_ID)
    assert "re_secret_key_value" not in str(err.value) and "re_secret_key_value" not in repr(fetcher)


# ---- the wiring
def settings(**kw: Any) -> Settings:
    return Settings(api_env="development", **kw)


def test_the_two_secrets_come_together_or_not_at_all() -> None:
    args = ("http://rest", "http://auth", "anon", None)
    assert build_lead_sources(settings(), *args).resend is None
    both = build_lead_sources(settings(lead_resend_api_key=SecretStr("re_x"), lead_resend_webhook_secret=SecretStr(SECRET)), *args)
    assert both.resend is not None and both.resend.webhook_secret == SECRET and "re_x" not in repr(both.resend.fetcher)
    for one in ({"lead_resend_api_key": SecretStr("re_x")}, {"lead_resend_webhook_secret": SecretStr(SECRET)}):
        with pytest.raises(ConfigurationError, match="together"):
            build_lead_sources(settings(**one), *args)


def test_the_deploy_script_mounts_the_leads_key_not_the_sending_key() -> None:
    from pathlib import Path

    text = (Path(__file__).resolve().parents[3] / "deploy" / "staging.sh").read_text(encoding="utf-8")
    assert "LEAD_RESEND_API_KEY=sme-resend-leads-api-key:latest" in text and "LEAD_RESEND_WEBHOOK_SECRET=sme-resend-webhook-secret:latest" in text
    assert "RESEND_API_KEY=sme-resend-leads-api-key" not in text.replace("LEAD_RESEND_API_KEY=sme-resend-leads-api-key", "") and "LEAD_RESEND_API_KEY=sme-resend-api-key" not in text
