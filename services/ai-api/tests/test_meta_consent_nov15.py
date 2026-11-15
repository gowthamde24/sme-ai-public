"""15 Nov: Meta lead form consent. The answer to the form's required checkbox and the wording the form showed travel beside the lead; ticked grants contact, anything else stays ask-first."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import httpx

from app.lead_sources.meta import GraphLeadFetcher, LeadgenRef, consent_of, disclaimer_text_of
from app.lead_sources.service import LeadSourcesService
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver

FORM = {"id": "2467686070301526", "legal_content": {"id": "9", "privacy_policy": {"url": "https://stack19.com/privacy"}, "custom_disclaimer": {
    "title": "Contact consent", "body": {"text": "We use your answers only to reply to your enquiry."},
    "checkboxes": [{"key": "contact_consent", "is_required": True, "text": "I agree that Stack19 may call or WhatsApp me about my enquiry."}]}}}


def lead(ticked: str | None, lead_id: str = "2974952262866279") -> dict[str, Any]:
    body: dict[str, Any] = {"id": lead_id, "form_id": "2467686070301526", "field_data": [{"name": "full_name", "values": ["Meta Consent Test"]}, {"name": "phone_number", "values": ["+00 99999 71236"]}, {"name": "email", "values": ["meta.consent@example.com"]}]}
    if ticked is not None:
        body["custom_disclaimer_responses"] = [{"checkbox_key": "contact_consent", "is_checked": ticked}]
    return body


def test_the_checkbox_answer_is_read_as_ticked_unticked_or_absent() -> None:
    assert consent_of(lead("1")) == {"checkbox_key": "contact_consent", "ticked": True}
    assert consent_of(lead("0")) == {"checkbox_key": "contact_consent", "ticked": False}
    assert consent_of(lead(None)) is None
    assert consent_of({"custom_disclaimer_responses": [{"checkbox_key": "a", "is_checked": "1"}, {"checkbox_key": "b", "is_checked": "0"}]}) == {"checkbox_key": "a", "ticked": False}, "with several boxes all must be ticked"
    assert consent_of("junk") is None and consent_of({"custom_disclaimer_responses": "junk"}) is None


def test_the_form_wording_is_the_title_the_text_and_the_checkbox_label_and_nothing_else() -> None:
    text = disclaimer_text_of(FORM)
    assert text == "Contact consent We use your answers only to reply to your enquiry. I agree that Stack19 may call or WhatsApp me about my enquiry."
    assert disclaimer_text_of({}) is None and disclaimer_text_of({"legal_content": {}}) is None


def test_the_fetcher_returns_the_consent_beside_the_lead_and_asks_for_the_form_wording_once_per_form() -> None:
    forms: list[str] = []

    def graph(request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[1]
        if path == "2467686070301526":
            forms.append(path)
            return httpx.Response(200, json=FORM)
        return httpx.Response(200, json=lead("1", path))

    fetcher = GraphLeadFetcher("page-token-for-tests", client=httpx.Client(transport=httpx.MockTransport(graph)))
    first = fetcher.fetch(LeadgenRef("111"))
    second = fetcher.fetch(LeadgenRef("222"))
    assert first["_consent"] == {"leadgen_id": "111", "form_id": "2467686070301526", "checkbox_key": "contact_consent", "ticked": True, "disclaimer": disclaimer_text_of(FORM)} and second["_consent"]["leadgen_id"] == "222"
    assert forms == ["2467686070301526"], "the wording is asked once per form"
    assert first["phone"] == "+00 99999 71236" and "custom_disclaimer_responses" not in first


def test_a_form_without_a_checkbox_has_no_answer_and_no_wording_request() -> None:
    asked: list[str] = []

    def graph(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        return httpx.Response(200, json=lead(None))

    row = GraphLeadFetcher("page-token-for-tests", client=httpx.Client(transport=httpx.MockTransport(graph))).fetch(LeadgenRef("333"))
    assert row["_consent"]["ticked"] is None and row["_consent"]["checkbox_key"] is None and row["_consent"]["disclaimer"] is None and len(asked) == 1


def test_a_signed_meta_arrival_carries_the_consent_inside_the_row_so_the_database_stores_it_with_the_lead() -> None:
    from app.lead_sources import meta
    from tests.fakes import make_client
    from tests.test_dr_lead_sources import make_source

    repo = FakeLeadSourcesRepository()
    consent = {"leadgen_id": "5551", "form_id": "77", "checkbox_key": "contact_consent", "ticked": True, "disclaimer": "Contact consent. I agree that Stack19 may call or WhatsApp me."}
    fetcher = meta.FakeMetaFetcher({"5551": {"name": "Meena K", "phone": "+00 90000 04444", "external_id": "5551", "_consent": dict(consent)}})
    service = LeadSourcesService(repo, receiver=Receiver(), meta=fetcher, meta_app_secret="meta-app-secret", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service)
    token = make_source(client, "meta_lead_ads")["secret"]["meta_verify_token"]
    sent: list[list[dict[str, Any]]] = []
    original = repo.live
    repo.live = lambda worker, hash_, rows: (sent.append(rows), original(worker, hash_, rows))[1]  # type: ignore[method-assign]
    payload = json.dumps({"entry": [{"changes": [{"field": "leadgen", "value": {"leadgen_id": "5551", "page_id": "1", "form_id": "77"}}]}]}).encode()
    sig = "sha256=" + hmac.new(b"meta-app-secret", payload, hashlib.sha256).hexdigest()
    assert client.post(f"/v1/lead-intake/meta/{token}", content=payload, headers={"X-Hub-Signature-256": sig, "content-type": "application/json"}).status_code == 200
    assert len(sent) == 1 and sent[0][0]["consent"] == consent and "_consent" not in sent[0][0], "one call: the lead and its consent evidence together"
    assert "meta_consent" not in repo.calls, "no second call after the arrival"
