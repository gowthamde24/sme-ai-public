"""15 Nov: the application's warnings reach Cloud Logging with a severity, and a refused Meta lead says why in numbers and closed words only (never what Meta wrote, never an answer)."""

# ruff: noqa: E501

from __future__ import annotations

import contextlib
import json
import logging

import httpx
import pytest

from app.hardening.observe import JsonFormatter
from app.lead_sources.meta import GraphLeadFetcher, LeadgenRef, MetaError


def _record(level: int, text: str) -> logging.LogRecord:
    return logging.LogRecord("app.lead_sources", level, __file__, 1, text, None, None)


@pytest.mark.parametrize("level, word", [(logging.INFO, "INFO"), (logging.WARNING, "WARNING"), (logging.ERROR, "ERROR")])
def test_a_json_log_line_carries_the_severity_cloud_logging_reads(level: int, word: str) -> None:
    doc = json.loads(JsonFormatter().format(_record(level, "something happened")))
    assert doc["severity"] == word and doc["level"] == word.lower() and doc["msg"] == "something happened", "msg and level stay: the latency report reads msg"


def test_a_log_line_masks_an_email_and_a_phone_number() -> None:
    doc = json.loads(JsonFormatter().format(_record(logging.WARNING, "lead ravi@example.com rang +91 98765 43210")))
    assert "ravi@example.com" not in doc["msg"] and "98765" not in doc["msg"]


def test_a_refused_lead_fetch_logs_the_status_and_meta_error_numbers_never_the_message(caplog: pytest.LogCaptureFixture) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "Object 444 for ravi@example.com does not exist", "type": "GraphMethodException", "code": 100, "error_subcode": 33}})

    fetcher = GraphLeadFetcher("page-token-for-tests", client=httpx.Client(transport=httpx.MockTransport(refuse)))
    with caplog.at_level(logging.WARNING, logger="app.lead_sources.meta"), pytest.raises(MetaError) as seen:
        fetcher.fetch(LeadgenRef("444444444444"))
    assert seen.value.reason == "refused" and seen.value.detail == "http=400 code=100 error_subcode=33"
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "http=400" in text and "code=100" in text and "ravi@example.com" not in text and "page-token-for-tests" not in text and "GraphMethodException" not in text


def test_a_live_arrival_logs_its_outcome_as_numbers_and_closed_words_only(caplog: pytest.LogCaptureFixture) -> None:
    from tests.fakes import TENANT_A, auth
    from tests.test_ed_cards import T, world

    client, _repo, _service = world()
    url = client.post(f"{T}/lead-sources/cards/missed_calls/connect", headers=auth("a_owner")).json()["connect"]["fields"][0]["value"]
    with caplog.at_level(logging.INFO, logger="app.lead_sources"):
        assert client.post(f"/v1/lead-intake/{url.rsplit('/', 1)[1]}", json={"From": "+919848012345", "CallUUID": "abc-123"}).status_code in (200, 201, 202)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("lead intake:")]
    assert lines and "status=" in lines[0] and "rows=1" in lines[0] and "9848012345" not in lines[0] and TENANT_A.name not in lines[0]


def test_the_lead_id_is_its_own_json_field_and_is_never_masked_while_a_phone_number_in_the_message_is() -> None:
    record = logging.LogRecord("app.lead_sources", logging.WARNING, __file__, 1, "rang +91 98765 43210", None, None)
    record.fields = {"lead_id": "444444444444"}
    doc = json.loads(JsonFormatter().format(record))
    assert doc["lead_id"] == "444444444444" and "98765" not in doc["msg"]


def test_a_refused_meta_lead_logs_its_id_as_a_field_and_a_fetched_one_too(caplog: pytest.LogCaptureFixture) -> None:
    import hashlib
    import hmac

    from app.lead_sources.service import LeadSourcesService
    from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver

    class Refuses:
        def fetch(self, ref: LeadgenRef) -> dict[str, object]:
            raise MetaError("refused", "http=400 code=100")

    class Gives:
        def fetch(self, ref: LeadgenRef) -> dict[str, object]:
            return {"name": "Meta Test Lead", "phone": "+00 99999 71235"}

    token = "a" * 24
    payload = {"entry": [{"changes": [{"field": "leadgen", "value": {"leadgen_id": "1988501795151700", "page_id": "1", "form_id": "2"}}]}]}
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(b"app-secret-for-tests", raw, hashlib.sha256).hexdigest()
    for fetcher in (Refuses(), Gives()):
        service = LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), meta=fetcher, meta_app_secret="app-secret-for-tests")
        with caplog.at_level(logging.INFO, logger="app.lead_sources"):
            with contextlib.suppress(Exception):   # the fake repository may refuse the arrival: only the log matters here
                service.meta_receive(token, raw, sig, payload)
    fields = [getattr(r, "fields", {}) for r in caplog.records if getattr(r, "fields", None)]
    assert [f["lead_id"] for f in fields] == ["1988501795151700", "1988501795151700"] and "1988501795151700" not in " ".join(r.getMessage() for r in caplog.records)


def test_a_parsed_mail_logs_its_outcome_and_portal_but_never_the_sender_the_subject_or_a_word_of_the_body(caplog: pytest.LogCaptureFixture) -> None:
    from tests.fakes import auth
    from tests.test_ed_cards import T, world

    class Mail:
        sender, subject, message_id, to = "alerts@justdial.com", "JD Lead for Ravi Kumar", "msg-1", ""
        text = "Name\nRavi Kumar\nMobile\n+00 99999 71238\nLooking for: 2BHK flat\n"

    class Unreadable(Mail):
        text = "hello there, please call me back about the flat"
        subject = "Call me Ravi"

    client, _repo, service = world()
    address = client.post(f"{T}/lead-sources/cards/email_forward/connect", headers=auth("a_owner")).json()["connect"]["fields"][0]["value"]
    token = address.split("+", 1)[1].split("@", 1)[0]
    with caplog.at_level(logging.INFO, logger="app.lead_sources"):
        assert service.receive_mail(token, Mail()) == "received"
        assert service.receive_mail(token, Unreadable()) == "unrecognised"
        with contextlib.suppress(Exception):
            service.receive_mail("d" * 24, Mail())
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("mail:")]
    assert len(lines) == 3 and "outcome=parsed portal=justdial" in lines[0] and "outcome=unparsed" in lines[1] and "outcome=dropped reason=unknown_address" in lines[2]
    assert all("Ravi" not in x and "justdial.com" not in x and "2BHK" not in x and "99999" not in x and "flat" not in x for x in lines)
