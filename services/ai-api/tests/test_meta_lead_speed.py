"""Speed to lead on Meta (planner, 18 Nov 2026): the form's wording is read AT THE SAME TIME as the lead, kept per form for an hour, and read once per form."""

# ruff: noqa: E501

from __future__ import annotations

import threading
from typing import Any

import httpx

from app.lead_sources import meta

FORM = {"legal_content": {"custom_disclaimer": {"title": "Consent", "body": {"text": "We may call you."}, "checkboxes": [{"key": "c1", "text": "I agree"}]}}}


def lead(lead_id: str) -> dict[str, Any]:
    return {"id": lead_id, "form_id": "555", "created_time": "2026-11-18T10:00:00+0000", "field_data": [{"name": "full_name", "values": ["A B"]}, {"name": "phone_number", "values": ["+919800000001"]}],
            "custom_disclaimer_responses": [{"checkbox_key": "c1", "is_checked": "1"}]}


def test_the_forms_wording_is_asked_beside_the_lead_not_after_it_and_only_once_per_form() -> None:
    form_asked = threading.Event()
    form_calls: list[str] = []
    overlapped: list[bool] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/555"):
            form_calls.append("form")
            form_asked.set()
            return httpx.Response(200, json=FORM)
        overlapped.append(form_asked.wait(timeout=2.0))   # serial code never has the form asked yet when the lead is answered: it waits here and times out
        return httpx.Response(200, json=lead(request.url.path.split("/")[-1]))

    fetcher = meta.GraphLeadFetcher("t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    row = fetcher.fetch(meta.LeadgenRef(leadgen_id="901", form_id="555"))
    assert overlapped == [True], "the form's wording was asked while the lead was being read"
    assert row["_consent"]["disclaimer"] and "We may call you." in row["_consent"]["disclaimer"] and row["_consent"]["ticked"] is True
    fetcher.fetch(meta.LeadgenRef(leadgen_id="902", form_id="555"))
    fetcher.fetch(meta.LeadgenRef(leadgen_id="903", form_id="555"))
    assert form_calls == ["form"], "the second and third lead of the form used what was kept"


def test_a_kept_wording_is_asked_again_after_an_hour(monkeypatch: Any) -> None:
    clock = [1000.0]
    monkeypatch.setattr("app.lead_sources.meta.time.monotonic", lambda: clock[0])
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/555"):
            calls.append("form")
            return httpx.Response(200, json=FORM)
        return httpx.Response(200, json=lead(request.url.path.split("/")[-1]))

    fetcher = meta.GraphLeadFetcher("t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    fetcher.fetch(meta.LeadgenRef(leadgen_id="901", form_id="555"))
    clock[0] += 3500
    fetcher.fetch(meta.LeadgenRef(leadgen_id="902", form_id="555"))
    assert calls == ["form"]
    clock[0] += 200
    fetcher.fetch(meta.LeadgenRef(leadgen_id="903", form_id="555"))
    assert calls == ["form", "form"], "an edited form shows within the hour"


def test_a_lead_without_a_form_hint_still_gets_the_wording_after_the_lead() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=FORM) if request.url.path.endswith("/555") else httpx.Response(200, json=lead(request.url.path.split("/")[-1]))

    row = meta.GraphLeadFetcher("t", client=httpx.Client(transport=httpx.MockTransport(handler))).fetch(meta.LeadgenRef(leadgen_id="901"))
    assert "We may call you." in row["_consent"]["disclaimer"]
