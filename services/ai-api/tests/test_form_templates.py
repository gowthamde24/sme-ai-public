"""The lead-form templates (app/lead_sources/form_templates.py, data/form_templates.json): every sample a template shows is posted, in the vendor's own shape, to the REAL inbound lead route with a fake sender (no
network), and must be accepted as a lead WITH its consent evidence; the same payload without the consent question is still a lead, with no consent (ask first). The switch (LEAD_FORM_TEMPLATES) is proved both ways.
Nothing here holds a secret; numbers and addresses are invented (numbers that start 9000, the reserved domain example.test)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.lead_sources import form_templates as ft
from app.lead_sources.service import LeadSourcesService
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"
ADDRESS = "https://api.example.test/v1/lead-intake/YOUR-ADDRESS"
WORDING = "I agree that Sree Silks may call or WhatsApp me about my enquiry"
ALL = ft.listing()
POSTED = [i["id"] for i in ALL if i["channel"] in ("json", "multipart")]


@pytest.fixture(autouse=True)
def _switch_back() -> Any:
    yield
    ft.ENABLED = False


def world(on: bool = True, kind: str = "webhook") -> tuple[Any, FakeLeadSourcesRepository, str]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service)
    made = client.post(f"{T}/lead-sources", json={"source_id": str(uuid.uuid4()), "kind": kind, "label": "Templates"}, headers=auth("a_owner")).json()
    ft.ENABLED = on   # after make_client: building the app sets the flag from the settings (off)
    return client, repo, made["secret"]["url"].rsplit("/", 1)[1]


def card(template_id: str, now: datetime | None = None) -> dict[str, Any]:
    t = ft.template(template_id, ADDRESS, now=now)
    assert t is not None
    return t


def send(client: Any, token: str, t: dict[str, Any], body: dict[str, Any] | None = None) -> Any:
    kind, wire = ft.wire_body({**t, "sample": body if body is not None else t["sample"]})
    if kind == "multipart":
        return client.post(f"/v1/lead-intake/{token}/jotform", files={k: (None, v) for k, v in wire.items()})
    return client.post(f"/v1/lead-intake/{token}", json=wire)


def strip_consent(node: Any) -> Any:
    """The same payload without its consent question: a key, or a list entry, that mentions 'consent' anywhere is dropped."""
    if isinstance(node, dict):
        return {k: strip_consent(v) for k, v in node.items() if "consent" not in str(k).lower()}
    if isinstance(node, list):
        return [strip_consent(v) for v in node if "consent" not in json.dumps(v).lower()]
    return node


def test_the_templates_the_brief_names_are_all_there() -> None:
    assert {i["id"] for i in ALL} == {"google_ads", "typeform", "tally", "jotform", "linkedin_lead_gen", "webflow", "tradeindia"}
    for i in ALL:
        t = card(i["id"])
        assert len(t["steps"]) >= 3 and t["docs"] and t["verify"] and t["consent"] and t["mapping"], i["id"]
        assert "{ADDRESS}" not in json.dumps(t) and "{NOW}" not in json.dumps(t)


@pytest.mark.parametrize("template_id", POSTED)
def test_every_sample_is_accepted_as_a_lead_with_its_consent(template_id: str) -> None:
    client, repo, token = world()
    r = send(client, token, card(template_id))
    assert r.status_code == 202, r.text
    assert len(repo.sent) == 1, f"{template_id}: no lead was sent on"
    row = repo.sent[0]
    assert row.get("phone") and row.get("name"), f"{template_id}: no number or name was understood: {row}"
    assert row.get("external_id"), f"{template_id}: no id to tell a second delivery by"
    consent = row.get("consent")
    assert consent and consent["ticked"] is True and WORDING in consent["disclaimer"], f"{template_id}: the consent evidence is missing or not the wording the person saw: {consent}"
    assert "given_at" in consent
    assert len(repo.contacts) == 1


@pytest.mark.parametrize("template_id", POSTED)
def test_the_same_payload_without_the_consent_question_is_a_lead_but_nobody_may_be_called(template_id: str) -> None:
    client, repo, token = world()
    t = card(template_id)
    r = send(client, token, t, strip_consent(t["sample"]))
    assert r.status_code == 202, r.text
    assert len(repo.sent) == 1 and repo.sent[0].get("phone")
    assert "consent" not in repo.sent[0], f"{template_id}: a consent was stored without its question"
    assert [c["consent"] for c in repo.contacts.values()] == [None]   # ask first


def test_a_consent_older_than_thirty_days_is_not_believed() -> None:
    client, repo, token = world()
    old = datetime.now(UTC) - timedelta(days=45)
    t = card("typeform", now=old)
    assert send(client, token, t).status_code == 202
    assert len(repo.sent) == 1 and "consent" not in repo.sent[0]


def test_the_consent_must_be_ticked_and_a_no_is_not_a_yes() -> None:
    client, repo, token = world()
    t = card("typeform")
    t["sample"]["form_response"]["answers"][-1]["boolean"] = False
    assert send(client, token, t).status_code == 202
    assert "consent" not in repo.sent[0]


def test_the_same_delivery_twice_is_one_lead() -> None:
    client, repo, token = world()
    t = card("tally")
    assert send(client, token, t).status_code == 202 and send(client, token, t).status_code == 202
    assert len(repo.contacts) == 1


def test_with_the_switch_off_the_vendor_envelopes_are_not_read() -> None:
    client, repo, token = world(on=False)
    for template_id in ("typeform", "tally", "webflow"):
        assert send(client, token, card(template_id)).status_code == 202
    assert all(not r.get("phone") and not r.get("email") for r in repo.sent) and repo.contacts == {}   # nothing was understood: an empty row, not a lead
    assert ft.flatten({"x": 1}) == {"x": 1}
    sample = card("typeform")["sample"]
    assert ft.flatten(sample) is sample


def test_with_the_switch_on_other_bodies_are_left_alone() -> None:
    ft.ENABLED = True
    for body in ({"name": "Asha", "phone": "9000011111"}, {"form_response": "x"}, {"event_type": "form_response"}, {"eventType": "FORM_RESPONSE", "data": []}, {"triggerType": "other", "payload": {"data": {}}}, {"lead_id": "a", "user_column_data": "no"}):
        assert ft.flatten(dict(body)) == body


def test_google_ads_reads_first_and_last_name_and_marks_a_test_lead() -> None:
    ft.ENABLED = True
    out = ft.flatten({"lead_id": "L1", "is_test": True, "google_key": "k", "user_column_data": [{"column_id": "FIRST_NAME", "string_value": "Asha"}, {"column_id": "LAST_NAME", "string_value": "Rao"}, {"column_id": "PHONE_NUMBER", "string_value": "+919000011101"}]})
    assert out["name"] == "Asha Rao" and out["phone"] == "+919000011101" and out["external_id"] == "L1" and out["message"] == "Test lead from Google Ads"
    assert "google_key" not in json.dumps(out)


def test_linkedin_first_and_last_name_are_joined_but_a_given_name_wins() -> None:
    ft.ENABLED = True
    assert ft.flatten({"first_name": "Divya", "last_name": "Menon", "phone": "9000011105"})["name"] == "Divya Menon"
    body = {"name": "D M", "first_name": "Divya", "last_name": "Menon"}
    assert ft.flatten(body) is body


def test_jotform_phone_and_checkbox_shapes_are_read_both_ways() -> None:
    ft.ENABLED = True
    out = ft.flatten({"rawRequest": json.dumps({"q4_phone": {"area": "90000", "phone": "11104"}, "q5_email": "k@example.test", "q3_name": {"first": "K", "last": "R"}, "q7_consent": "Yes"}), "submissionID": "S1"})
    assert out["phone"] == "90000 11104" and out["name"] == "K R" and out["external_id"] == "S1" and out["consent"] == "yes"
    assert ft.flatten({"rawRequest": "{not json"}) == {"rawRequest": "{not json"}


def test_a_multipart_body_is_read_by_name_and_files_are_ignored() -> None:
    boundary = "XyZ"
    raw = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"rawRequest\"\r\n\r\n{{\"q1_name\":\"A\"}}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\nContent-Type: text/plain\r\n\r\nzzz\r\n--{boundary}--\r\n").encode()
    assert ft.parse_multipart(f"multipart/form-data; boundary={boundary}", raw) == {"rawRequest": '{"q1_name":"A"}'}
    assert ft.parse_multipart("application/json", raw) is None and ft.parse_multipart("multipart/form-data", raw) is None


def test_the_jotform_door_refuses_what_is_not_a_multipart_form_and_hides_while_off() -> None:
    client, repo, token = world()
    assert client.post(f"/v1/lead-intake/{token}/jotform", json={"rawRequest": "{}"}).status_code == 422
    assert client.post(f"/v1/lead-intake/{'z' * 32}/jotform", files={"rawRequest": (None, json.dumps({"q1_name": "A", "q2_phone": "9000011111"}))}).status_code == 404
    ft.ENABLED = False
    assert client.post(f"/v1/lead-intake/{token}/jotform", files={"rawRequest": (None, "{}")}).status_code == 404
    assert repo.sent == []


def test_the_cards_are_for_owner_and_admin_and_hidden_while_off() -> None:
    client, _repo, _token = world()
    listed = client.get(f"{T}/lead-sources/form-templates", headers=auth("a_owner"))
    assert listed.status_code == 200 and len(listed.json()["templates"]) == 7 and listed.json()["note"]
    one = client.get(f"{T}/lead-sources/form-templates/typeform", headers=auth("a_admin")).json()
    assert one["id"] == "typeform" and "YOUR-ADDRESS" in json.dumps(one) and "{ADDRESS}" not in json.dumps(one)
    assert client.get(f"{T}/lead-sources/form-templates/nope", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{T}/lead-sources/form-templates", headers=auth("a_sales")).status_code == 403
    ft.ENABLED = False
    assert client.get(f"{T}/lead-sources/form-templates", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{T}/lead-sources/form-templates/typeform", headers=auth("a_owner")).status_code == 404


def test_a_sample_time_is_fresh_every_time_it_is_asked_for() -> None:
    a = card("typeform", now=datetime(2026, 1, 1, tzinfo=UTC))
    assert a["sample"]["form_response"]["submitted_at"].startswith("2026-01-01")
    assert re.match(r"\d{4}-\d\d-\d\dT", card("tally")["sample"]["data"]["createdAt"])


# ============================================================================ TradeIndia
def test_a_tradeindia_mail_becomes_a_lead_with_no_consent() -> None:
    s = card("tradeindia")["sample"]
    client, repo, token = world(kind="email_forward")
    r = client.post(f"/v1/lead-intake/{token}/email", json={"from": s["sender"], "subject": s["subject"], "text": s["text"], "message_id": "<ti-1@tradeindia.example.test>"})
    assert r.status_code == 202 and r.json() == {"status": "received"}
    assert len(repo.sent) == 1 and repo.sent[0]["name"] == "Anil Sharma" and repo.sent[0]["phone"] and "Silk saree" in repo.sent[0]["message"]
    assert "consent" not in repo.sent[0]   # a portal mail carries none: ask first


def test_a_tradeindia_label_the_portal_reader_does_not_know_is_read_and_only_while_on() -> None:
    text = "Buyer Email: buyer@example.test\nProduct Requirement: Cotton thread, 200 kg\n"
    client, repo, token = world(kind="email_forward")
    path = f"/v1/lead-intake/{token}/email"
    assert client.post(path, json={"from": "inquiry@tradeindia.com", "subject": "New inquiry", "text": text}).json() == {"status": "received"}
    assert repo.sent[0]["email"] == "buyer@example.test" and "Cotton thread" in repo.sent[0]["message"]
    ft.ENABLED = False
    assert client.post(path, json={"from": "inquiry@tradeindia.com", "subject": "New inquiry", "text": text}).json() == {"status": "unrecognised"}


def test_the_tradeindia_reader_wants_a_tradeindia_mail_and_a_number_or_an_address() -> None:
    ft.ENABLED = True
    assert ft.tradeindia_mail("a@example.test", "hello", "Mobile No: 9000011107") is None
    assert ft.tradeindia_mail("inquiry@tradeindia.com", "New inquiry", "Buyer Name: A\nProduct: Rice") is None
    got = ft.tradeindia_mail("inquiry@tradeindia.com", "New inquiry", "> Mobile No: 9000011107\n> Product: Rice")
    assert got is not None and got.row["phone"] == "9000011107" and got.row["message"] == "Rice" and got.portal == "tradeindia"
    ft.ENABLED = False
    assert ft.tradeindia_mail("inquiry@tradeindia.com", "New inquiry", "Mobile No: 9000011107") is None
