"""Portal leads say which portal they came from, arrive by themselves, and are honest about what each portal allows (owner, 25 Nov 2026: "forwarded e-mail is not a good idea, it should be automatic").
The mail's portal is the lead's tag (migration 20261231992410); IndiaMART's Push API body is understood by a web-address source (switch INDIAMART_PUSH, off by default) and answered with the HTTP 200 IndiaMART asks for; every other portal
is listed with its state and the message the owner can send its team (data/portals.json)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from typing import Any, get_args

import pytest

from app.lead_sources import guides, portal_connections, portals
from app.lead_sources.models import Portal, SourceTag
from app.lead_sources.service import GMAIL_GUIDE, MAIL_STEPS, LeadSourcesService
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dr_lead_sources import MAILS

T = f"/v1/tenants/{TENANT_A.id}"
PUSH = {"CODE": 200, "STATUS": "SUCCESS", "RESPONSE": {"UNIQUE_QUERY_ID": "2026112500001", "QUERY_TYPE": "W", "QUERY_TIME": "2026-11-25 10:15:00", "SENDER_NAME": "Invented Buyer", "SENDER_MOBILE": "+00-9999900001",
                                                    "SENDER_EMAIL": "buyer@example.test", "SENDER_CITY": "Guntur", "SENDER_COUNTRY_ISO": "IN", "SUBJECT": "Requirement", "QUERY_PRODUCT_NAME": "Silk saree", "QUERY_MESSAGE": "Need 30 pieces"}}
TRADEINDIA = ("inquiry@tradeindia.com", "New TradeIndia inquiry for Cotton fabric", "Buyer Name: Invented Trader\nMobile: 9000000020\nEmail: trader@example.test\nCity: Surat\nProduct: Cotton fabric 40s\nInquiry Details: 500 metres, delivery to Surat\n")


def world(*, push: bool = False, kind: str = "email_forward") -> tuple[Any, FakeLeadSourcesRepository, str]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url="https://api.example.test", indiamart_push=push)
    client, _ = make_client(lead_sources=service)
    made = client.post(f"{T}/lead-sources", json={"source_id": str(uuid.uuid4()), "kind": kind, "label": "Portal"}, headers=auth("a_owner")).json()
    return client, repo, made["secret"]["url"].rsplit("/", 1)[1]


def test_tradeindia_mail_is_read_and_every_portal_is_a_known_tag() -> None:
    parsed = portals.parse_mail(*TRADEINDIA)
    assert parsed is not None and parsed.portal == "tradeindia"
    assert parsed.row["name"] == "Invented Trader" and parsed.row["phone"] == "9000000020" and parsed.row["message"] == "Cotton fabric 40s"
    assert portals.TAGS == {"indiamart", "justdial", "sulekha", "tradeindia", "99acres", "magicbricks", "housing"}
    assert portals.TAGS <= set(get_args(SourceTag)) and portals.TAGS <= set(get_args(Portal))


@pytest.mark.parametrize("portal", ["justdial", "sulekha", "99acres", "magicbricks", "housing", "indiamart"])
def test_a_lead_mail_is_stored_under_its_portals_tag_not_forwarded_email(portal: str) -> None:
    from app.lead_sources.models import MailIn

    client, repo, token = world(kind="email_forward")
    service: LeadSourcesService = client.app.state.runtime.lead_sources
    sender, subject, body = MAILS[portal]
    mail = MailIn.model_validate({"from": sender, "subject": subject, "text": body, "message_id": f"<{portal}@mail.example.test>"})
    assert service.receive_mail(token, mail) == "received"
    assert repo.live_tags[-1] == portal and repo.sent[-1]["tag"] == portal


def test_a_mail_no_portal_can_be_named_from_keeps_the_sources_own_tag() -> None:
    from app.lead_sources.models import MailIn

    client, repo, token = world(kind="email_forward")
    service: LeadSourcesService = client.app.state.runtime.lead_sources
    mail = MailIn.model_validate({"from": "someone@gmail.test", "subject": "Enquiry", "text": "Name: Invented\nPhone: 9000000030\nMessage: hello\n", "message_id": "<x@mail.example.test>"})
    assert service.receive_mail(token, mail) == "received"
    assert repo.live_tags[-1] == "email_forward" and "tag" not in repo.sent[-1]


def test_a_tag_a_sender_puts_in_a_form_is_not_taken() -> None:
    client, repo, token = world(kind="webhook")
    assert client.post("/v1/lead-intake/" + token, json={"name": "Invented", "phone": "9000000031", "tag": "justdial"}).status_code == 202
    assert repo.live_tags[-1] == "webhook" and "tag" not in repo.sent[-1]


def test_the_mail_steps_say_set_the_address_in_the_portal_first_and_make_the_gmail_rule_second() -> None:
    assert "set the e-mail address that receives your leads to the address below" in MAIL_STEPS[0] and "Nothing to send on by hand" in MAIL_STEPS[0]
    assert "Gmail rule once" in MAIL_STEPS[1]
    text = " ".join(MAIL_STEPS + GMAIL_GUIDE)
    assert "forward your" not in text.lower() and "forward each" not in text.lower() and "by hand" in text
    assert [s for s in GMAIL_GUIDE if "Filter messages like this" in s] and [s for s in GMAIL_GUIDE if "Create filter" in s] and [s for s in GMAIL_GUIDE if "Add forwarding address" in s]


# ----- IndiaMART's Push API
def test_indiamart_push_is_a_lead_tagged_indiamart_and_answered_with_a_200() -> None:
    client, repo, token = world(push=True, kind="webhook")
    got = client.post("/v1/lead-intake/" + token, json=PUSH)
    assert got.status_code == 200, "IndiaMART counts only an HTTP 200 as received"
    row = repo.sent[-1]
    assert row["external_id"] == "2026112500001" and row["name"] == "Invented Buyer" and row["tag"] == "indiamart" and "Need 30 pieces" in row["message"] and "Guntur" in row["message"]
    assert repo.live_tags[-1] == "indiamart"
    again = client.post("/v1/lead-intake/" + token, json=PUSH)   # IndiaMART retries until it gets a 200: the same lead is not a second one
    assert again.status_code == 200 and len(repo.items) == 1


@pytest.mark.parametrize("shape", ["wrapped", "wrapped_text", "list"])
def test_the_other_shapes_of_a_push_are_read_too(shape: str) -> None:
    client, repo, token = world(push=True, kind="webhook")
    body: Any = {"method": "POST", "headers": {"Content-Type": "application/json"}, "body": PUSH} if shape == "wrapped" else {"body": json.dumps(PUSH)} if shape == "wrapped_text" else {"CODE": 200, "RESPONSE": [PUSH["RESPONSE"]]}
    assert client.post("/v1/lead-intake/" + token, json=body).status_code == 200 and repo.sent[-1]["tag"] == "indiamart"


def test_a_push_with_no_usable_lead_is_answered_200_and_stores_nothing() -> None:
    client, repo, token = world(push=True, kind="webhook")
    assert client.post("/v1/lead-intake/" + token, json={"CODE": 200, "RESPONSE": {"UNIQUE_QUERY_ID": "x", "SENDER_NAME": "No contact"}}).status_code == 200 and repo.sent == []


def test_with_the_switch_off_a_push_is_just_an_unreadable_form() -> None:
    client, repo, token = world(push=False, kind="webhook")
    got = client.post("/v1/lead-intake/" + token, json=PUSH)
    assert got.status_code == 202 and not repo.live_tags[-1:] == ["indiamart"]


def test_a_push_to_a_wrong_address_is_refused_like_any_other_post() -> None:
    client, _repo, _token = world(push=True, kind="webhook")
    assert client.post("/v1/lead-intake/" + "a" * 24, json=PUSH).status_code == 404


def test_the_switches_are_off_by_default() -> None:
    from app.config import Settings

    s = Settings(_env_file=None, api_env="development")   # type: ignore[call-arg]
    assert s.indiamart_push == "off" and s.indiamart_pull == "off"


# ----- what each portal allows
def test_only_indiamart_is_automatic_and_every_other_portal_says_so_honestly() -> None:
    listing = portal_connections.listing()
    by_id = {p["id"]: p for p in listing["portals"]}
    assert set(by_id) == portals.TAGS and by_id["indiamart"]["how"] == "automatic"
    for pid, p in by_id.items():
        assert p["tag"] == pid and p["ways"] and all(isinstance(w, str) and w for w in p["ways"])
        assert all(d.startswith("https://") for d in p["docs"])
        if pid != "indiamart":
            assert p["how"] == "account_manager" and p["state"] == "Available through your portal account manager"
            assert p["name"] in p["ask_text"] and "lead e-mail" in p["ways"][0] and "(your web address" in p["ask_text"]
    assert by_id["indiamart"]["ask_text"] is None and len(by_id["indiamart"]["steps"]) == 4
    assert all("help.indiamart.com" in d for d in by_id["indiamart"]["docs"])


def test_the_message_to_the_portal_carries_the_addresses_when_the_page_has_them_and_no_secret_otherwise() -> None:
    listing = portal_connections.listing("https://api.example.test/v1/lead-intake/TOKEN", "leads+TOKEN@leads.example.test")
    text = next(p for p in listing["portals"] if p["id"] == "sulekha")["ask_text"]
    assert "https://api.example.test/v1/lead-intake/TOKEN" in text and "leads+TOKEN@leads.example.test" in text and text.startswith("Hello Sulekha team")
    raw = portal_connections.PATH.read_text(encoding="utf-8")
    assert not re.search(r"(?i)api[_-]?key=|bearer |token=|s19_(live|test)_", raw)


def test_the_route_lists_the_portals_for_the_owner_and_admin_only() -> None:
    client, _repo, _token = world()
    got = client.get(f"{T}/lead-sources/portals", headers=auth("a_owner")).json()
    assert [p["id"] for p in got["portals"]][0] == "indiamart" and len(got["portals"]) == 7
    assert got["mail"]["steps"][0].startswith("In your portal's account settings") and any("Create filter" in x for x in got["mail"]["gmail_rule"])
    assert client.get(f"{T}/lead-sources/portals", headers=auth("a_sales")).status_code == 403


def test_the_guides_data_still_lists_the_twelve_tools() -> None:
    assert len(guides.listing()) == 12
