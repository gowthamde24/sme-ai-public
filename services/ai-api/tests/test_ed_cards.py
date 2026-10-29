"""Job EB part B: the Sources page. The seven cards in plain words, the forwarding address that can be shown again (and rotated), the Gmail confirmation code surfaced to the owner, and the Cloudflare mail door that
accepts only a signed mail (or, for older callers, the shared secret)."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.lead_sources import cards
from app.lead_sources.service import LeadSourcesService
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"
SECRET = "fake-inbound-secret-for-tests"
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)


def world(**kw: Any) -> tuple[Any, FakeLeadSourcesRepository, LeadSourcesService]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain=kw.pop("inbound_domain", "leads.example.test"), inbound_secret=SECRET, public_base_url="https://api.example.test", **kw)
    client, _ = make_client(lead_sources=service)
    return client, repo, service


def signed(raw: bytes, *, secret: str = SECRET, when: float | None = None) -> dict[str, str]:
    ts = str(int(when if when is not None else time.time()))
    return {"X-Timestamp": ts, "X-Signature": "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest(), "Content-Type": "application/json"}


def mail(to: str, subject: str = "New lead", text: str = "Name: Ravi\nMobile: 98765 43210\nRequirement: 3BHK", sender: str = "alerts@justdial.com") -> bytes:
    return json.dumps({"from": sender, "to": to, "subject": subject, "text": text}).encode()


# ============================================================================ the cards (pure)
ALL_ON = cards.Available(meta=True, indiamart=True, email_forward=True, website=True)


def by_kind(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {c["kind"]: c for c in items}


def test_there_are_seven_cards_in_one_fixed_order_and_a_new_workspace_is_all_not_connected_or_coming_soon() -> None:
    items = cards.build_cards([], {}, ALL_ON, now=NOW)
    assert [c["kind"] for c in items] == ["meta", "indiamart", "email_forward", "website", "files", "whatsapp", "missed_calls"]
    got = by_kind(items)
    assert got["missed_calls"]["status"] == "coming_soon" and got["missed_calls"]["available"] is False
    assert got["files"]["status"] == "not_connected" and got["files"]["action"]["type"] == "upload"
    assert got["email_forward"]["action"] == {"type": "copy_address", "label": "Copy your address"} and got["website"]["action"]["type"] == "copy_snippet"
    off = by_kind(cards.build_cards([], {}, cards.Available(), now=NOW))
    assert off["meta"]["status"] == "coming_soon" and off["meta"]["available"] is False and off["email_forward"]["headline"] == "Coming soon"


def test_a_connected_source_says_how_many_leads_this_week_and_a_quiet_one_says_so_without_calling_it_an_error() -> None:
    src = [{"kind": "website_form", "status": "active"}]
    busy = by_kind(cards.build_cards(src, {"by_tag": {"website_form": {"received_7d": 12, "last_at": NOW.isoformat()}}}, ALL_ON, now=NOW))["website"]
    assert busy["status"] == "connected" and busy["headline"] == "Connected" and busy["detail"] == "12 leads this week" and busy["received_7d"] == 12 and busy["problem"] is None
    one = by_kind(cards.build_cards(src, {"by_tag": {"webhook": {"received_7d": 1, "last_at": NOW.isoformat()}}}, ALL_ON, now=NOW))["website"]
    assert one["detail"] == "1 lead this week"
    old = (NOW - timedelta(days=10)).isoformat()
    quiet = by_kind(cards.build_cards(src, {"by_tag": {"website_form": {"received_7d": 0, "last_at": old}}}, ALL_ON, now=NOW))["website"]
    assert quiet["status"] == "connected" and quiet["detail"] == "Nothing received for 7 days" and quiet["problem"] is None
    fresh = by_kind(cards.build_cards(src, {}, ALL_ON, now=NOW))["website"]
    assert fresh["detail"] == "Waiting for the first lead"


def test_a_paused_source_needs_attention_with_one_tap_to_fix() -> None:
    got = by_kind(cards.build_cards([{"kind": "email_forward", "status": "paused"}], {}, ALL_ON, now=NOW))["email_forward"]
    assert got["status"] == "needs_attention" and got["headline"] == "Paused" and got["problem"]["code"] == "source_paused" and got["problem"]["fix"]["type"] == "resume"


def test_files_and_sheets_and_whatsapp_read_from_the_stats() -> None:
    stats = {"by_tag": {"excel_upload": {"received_7d": 5, "last_at": NOW.isoformat()}, "whatsapp": {"received_7d": 3, "last_at": NOW.isoformat()}},
             "sheets": {"total": 1, "needs_attention": 0}, "imports": {"received_7d": 20, "last_at": NOW.isoformat()}, "whatsapp": {"status": "active"}}
    got = by_kind(cards.build_cards([], stats, ALL_ON, now=NOW))
    assert got["files"]["status"] == "connected" and got["files"]["received_7d"] == 20
    assert got["whatsapp"]["status"] == "connected" and got["whatsapp"]["detail"] == "3 new chats this week"
    sheet = by_kind(cards.build_cards([], {"sheets": {"total": 2, "needs_attention": 1}}, ALL_ON, now=NOW))["files"]
    assert sheet["status"] == "needs_attention" and sheet["problem"]["code"] == "sheet_needs_attention" and sheet["problem"]["fix"]["label"] == "Open my sheets"
    pending = by_kind(cards.build_cards([], {"whatsapp": {"status": "pending"}}, ALL_ON, now=NOW))["whatsapp"]
    assert pending["status"] == "not_connected" and pending["headline"] == "Connecting"


def test_card_words_are_plain() -> None:
    blob = json.dumps(cards.build_cards([{"kind": "meta_lead_ads", "status": "paused"}], {"sheets": {"total": 1, "needs_attention": 1}}, ALL_ON, now=NOW), default=str).lower()
    for banned in ("http", "api", "token", "403", "500", "webhook", "oauth2", "null pointer"):
        assert banned not in blob.replace('"oauth"', ""), banned


# ============================================================================ the cards over HTTP
def test_the_owner_and_admin_read_the_cards_and_nobody_else() -> None:
    client, repo, _ = world()
    repo.stats = {"by_tag": {"website_form": {"received_7d": 4, "last_at": NOW.isoformat()}}}
    r = client.get(f"{T}/lead-sources/cards", headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [c["kind"] for c in items][:3] == ["meta", "indiamart", "email_forward"] and len(items) == 7
    assert client.get(f"{T}/lead-sources/cards", headers=auth("a_admin")).status_code == 200
    for user in ("a_sales", "a_viewer"):
        assert client.get(f"{T}/lead-sources/cards", headers=auth(user)).status_code == 403
    web = {c["kind"]: c for c in items}["website"]
    assert web["status"] == "not_connected" and web["available"] is True, "the form is offered; nothing is connected until the owner makes one"


# ============================================================================ the forwarding address
def test_the_address_is_made_once_shown_again_and_rotating_stops_the_old_one() -> None:
    client, repo, _ = world()
    first = client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner"))
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["address"].startswith("leads+") and body["address"].endswith("@leads.example.test") and len(body["address"].split("+")[1].split("@")[0]) == 24
    assert len(body["gmail_filter_guide"]) == 5 and body["gmail_filter_guide"][0]["step"] == 1 and "JustDial" in body["sample_portals"] and body["gmail_confirmation"] is None
    assert client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner")).json()["address"] == body["address"], "shown again, not remade"
    assert sum(1 for s in repo.sources_.values() if s["kind"] == "email_forward") == 1

    raw = mail(body["address"])
    assert client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw)).status_code == 202

    rotated = client.post(f"{T}/lead-sources/email-address/rotate", headers=auth("a_owner")).json()
    assert rotated["address"] != body["address"] and sum(1 for s in repo.sources_.values() if s["kind"] == "email_forward") == 1, "the same source, a new address"
    old = client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw))
    assert old.status_code in (202, 404) and (old.status_code == 404 or old.json()["status"] == "unrecognised"), "the old address no longer reaches the workspace"
    new_raw = mail(rotated["address"])
    assert client.post("/v1/lead-intake/mail", content=new_raw, headers=signed(new_raw)).json()["status"] in ("received", "kept")
    assert client.get(f"{T}/lead-sources/email-address", headers=auth("a_sales")).status_code == 403


def test_without_a_mail_domain_the_address_says_it_is_not_switched_on() -> None:
    client, _, _ = world(inbound_domain=" ")
    r = client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner"))
    assert r.status_code == 503 and "switch" in r.json()["error"]["message"].lower()


def test_the_code_gmail_sends_to_the_new_address_is_shown_to_the_owner() -> None:
    client, _, _ = world()
    address = client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner")).json()["address"]
    raw = mail(address, subject="(#987654321) Gmail Forwarding Confirmation - Receive Mail from owner@example.test", text="owner@example.test has requested to forward mail to you. Confirmation code: 987654321", sender="forwarding-noreply@google.com")
    assert client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw)).status_code == 202
    shown = client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner")).json()["gmail_confirmation"]
    assert shown is not None and shown["code"] == "987654321"


# ============================================================================ the signed door
def test_a_mail_must_be_signed_fresh_and_untouched_or_carry_the_shared_secret() -> None:
    client, _, _ = world()
    address = client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner")).json()["address"]
    raw = mail(address)
    assert client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw)).status_code == 202
    assert client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw, secret="wrong")).status_code == 401
    assert client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw, when=time.time() - 400)).status_code == 401, "an old signature is not replayable"
    assert client.post("/v1/lead-intake/mail", content=raw, headers=signed(raw, when=time.time() + 400)).status_code == 401
    tampered = mail(address, subject="Different")
    assert client.post("/v1/lead-intake/mail", content=tampered, headers=signed(raw)).status_code == 401, "the signature covers the body"
    assert client.post("/v1/lead-intake/mail", content=raw, headers={"Content-Type": "application/json"}).status_code == 401
    assert client.post("/v1/lead-intake/mail", content=raw, headers={"X-Inbound-Secret": SECRET, "Content-Type": "application/json"}).status_code == 202, "the older shared-secret way still works"
    assert uuid.uuid4() is not None


# ============================================================================ the raw mail the Cloudflare worker sends
def raw_mail(subject: str = "New lead", text: str = "Name: Ravi\nMobile: 98765 43210\nRequirement: 3BHK", html: str | None = None, sender: str = "JD <alerts@justdial.com>") -> str:
    import base64
    from email.message import EmailMessage

    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Message-ID"] = sender, "x@example.test", subject, "<abc123@justdial.com>"
    m.set_content(text)
    if html is not None:
        m.add_alternative(html, subtype="html")
    return base64.b64encode(m.as_bytes()).decode()


def test_the_raw_mail_is_read_by_a_real_parser_plain_html_and_in_any_language() -> None:
    from app.lead_sources import mime

    plain = mime.read(raw_mail())
    assert plain["sender"] == "alerts@justdial.com" and plain["subject"] == "New lead" and str(plain["text"]).startswith("Name: Ravi") and plain["message_id"] == "<abc123@justdial.com>"
    telugu = mime.read(raw_mail(subject="కొత్త లీడ్ — రవి", text="పేరు: రవి\nఫోన్: 98765 43210"))
    assert telugu["subject"] == "కొత్త లీడ్ — రవి" and "పేరు: రవి" in str(telugu["text"])
    only_html = mime.read(raw_mail(text="", html="<html><style>p{color:red}</style><body><p>Name: <b>Ravi</b></p><p>Mobile: 98765&nbsp;43210</p><script>alert(1)</script></body></html>"))
    assert "alert" not in str(only_html["text"]) and "color" not in str(only_html["text"])
    prefers_plain = mime.read(raw_mail(text="Plain wins", html="<p>Html loses</p>"))
    assert prefers_plain["text"] == "Plain wins"


def test_a_raw_mail_that_cannot_be_read_is_refused_and_a_huge_one_too() -> None:
    import base64

    from app.lead_sources import mime

    for bad in ("not base64!!", "", base64.b64encode(b"x" * (mime.MAX_RAW + 1)).decode()):
        try:
            mime.read(bad)
        except mime.Unreadable:
            continue
        raise AssertionError("should have been refused")


def test_the_door_reads_the_raw_mail_and_the_portal_parser_makes_the_lead() -> None:
    client, repo, _ = world()
    address = client.get(f"{T}/lead-sources/email-address", headers=auth("a_owner")).json()["address"]
    body = json.dumps({"from": "ignored@example.test", "to": address, "subject": "", "text": "", "raw_base64": raw_mail()}).encode()
    r = client.post("/v1/lead-intake/mail", content=body, headers=signed(body))
    assert r.status_code == 202 and r.json()["status"] == "received"
    assert any(row.get("name") == "Ravi" for row in repo.sent), "the lead was made from the mail's own text"
    bad = json.dumps({"from": "x@example.test", "to": address, "raw_base64": "###"}).encode()
    assert client.post("/v1/lead-intake/mail", content=bad, headers=signed(bad)).status_code == 422
