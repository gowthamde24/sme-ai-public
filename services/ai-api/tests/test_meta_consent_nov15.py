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

    def recording_live(worker: str, hash_: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        sent.append(rows)
        return original(worker, hash_, rows)

    repo.live = recording_live  # type: ignore[assignment]
    payload = json.dumps({"entry": [{"changes": [{"field": "leadgen", "value": {"leadgen_id": "5551", "page_id": "1", "form_id": "77"}}]}]}).encode()
    sig = "sha256=" + hmac.new(b"meta-app-secret", payload, hashlib.sha256).hexdigest()
    assert client.post(f"/v1/lead-intake/meta/{token}", content=payload, headers={"X-Hub-Signature-256": sig, "content-type": "application/json"}).status_code == 200
    assert len(sent) == 1 and sent[0][0]["consent"] == consent and "_consent" not in sent[0][0], "one call: the lead and its consent evidence together"
    assert "meta_consent" not in repo.calls, "no second call after the arrival"


def test_a_testing_tool_lead_is_a_test_lead_and_its_placeholders_are_not_a_persons_answers() -> None:
    from app.lead_sources.meta import lead_of

    row = lead_of({"id": "1619877432569207", "field_data": [{"name": "full_name", "values": ["<test lead: dummy data for full_name>"]}, {"name": "email", "values": ["test@meta.com"]},
                                                              {"name": "phone_number", "values": ["<test lead: dummy data for phone_number>"]}, {"name": "city", "values": ["<test lead: dummy data for city>"]}]})
    assert row == {"email": "test@meta.com", "external_id": "1619877432569207", "is_test": True}, "no placeholder text becomes a name, a number or a city"


def test_a_lead_with_our_test_number_is_a_test_lead_and_a_real_one_is_not() -> None:
    from app.lead_sources.meta import lead_of

    assert lead_of(lead("1"))["is_test"] is True   # +00 99999 71236
    real = {"id": "9", "field_data": [{"name": "full_name", "values": ["Ravi Teja"]}, {"name": "phone_number", "values": ["+91 98480 12345"]}, {"name": "email", "values": ["ravi@example.com"]}]}
    assert "is_test" not in lead_of(real)


def test_a_new_lead_starts_the_outreach_step_at_once_and_a_replay_does_not() -> None:
    import threading

    from app.lead_sources import meta
    from tests.fakes import make_client
    from tests.test_dr_lead_sources import make_source

    ran: list[str] = []
    done = threading.Event()

    def after_arrival(token: str) -> None:
        ran.append(token)
        done.set()

    repo = FakeLeadSourcesRepository()
    fetcher = meta.FakeMetaFetcher({"5551": {"name": "Meena K", "phone": "+00 90000 04444", "external_id": "5551"}})
    service = LeadSourcesService(repo, receiver=Receiver(), meta=fetcher, meta_app_secret="meta-app-secret", public_base_url="https://api.example.test", after_arrival=after_arrival)
    service.FOLLOW_UP_S = (0.2, 0.4)   # (62 and 122 s in production)
    client, _ = make_client(lead_sources=service)
    token = make_source(client, "meta_lead_ads")["secret"]["meta_verify_token"]
    payload = json.dumps({"entry": [{"changes": [{"field": "leadgen", "value": {"leadgen_id": "5551", "page_id": "1", "form_id": "77"}}]}]}).encode()
    sig = "sha256=" + hmac.new(b"meta-app-secret", payload, hashlib.sha256).hexdigest()

    def post() -> Any:
        return client.post(f"/v1/lead-intake/meta/{token}", content=payload, headers={"X-Hub-Signature-256": sig, "content-type": "application/json"})

    assert post().status_code == 200 and done.wait(5), "the first arrival starts the step with the worker's token"
    import time

    deadline = time.time() + 5
    while len(ran) < 3 and time.time() < deadline:
        time.sleep(0.05)
    assert len(ran) == 3, "then two follow-up passes, for the rules that say 1 and 2 minutes"
    before = len(ran)
    assert post().status_code == 200
    time.sleep(1.0)
    assert len(ran) == before, "the same lead again starts nothing"


def test_a_rule_may_say_zero_minutes_but_not_more_than_120_or_less_than_zero() -> None:
    import uuid

    import pytest as _pytest
    from pydantic import ValidationError

    from app.outreach.models import RuleIn

    def rule(minutes: int) -> RuleIn:
        return RuleIn.model_validate({"rule_id": uuid.uuid4(), "source": "meta_lead_ads", "action": "call_within_minutes", "within_minutes": minutes, "goal": "callback", "channel": "call", "language": "en"})

    assert rule(0).within_minutes == 0
    for bad in (-1, 121):
        with _pytest.raises(ValidationError):
            rule(bad)
