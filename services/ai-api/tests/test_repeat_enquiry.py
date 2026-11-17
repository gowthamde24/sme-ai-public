"""A repeat enquiry is a new enquiry (migration 20261231980500, 17 Nov 2026): the intake tells the API when a known customer enquired AGAIN so the standing rule runs now, and it logs why a row was not stored. The
database's own rules (arrival kinds, reopening, the 10-minute duplicate, the rule scan, Today) are proved in supabase/tests/database/229_repeat_enquiry.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import threading
from typing import Any

import pytest

from app.lead_sources.service import LeadSourcesService
from app.today.models import NeedsYouItem
from app.today.service import _summary
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver

SECRET = "a" * 32


class Repo(FakeLeadSourcesRepository):
    def __init__(self, answer: dict[str, Any]) -> None:
        super().__init__()
        self.answer = answer

    def live(self, worker_token: str, token_hash: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self.answer


def service(answer: dict[str, Any], ran: list[str], done: threading.Event) -> LeadSourcesService:
    def after_arrival(token: str) -> None:
        ran.append(token)
        done.set()

    svc = LeadSourcesService(Repo(answer), receiver=Receiver(), after_arrival=after_arrival)
    svc.FOLLOW_UP_S = (0.0, 0.0)
    return svc


ROW = [{"name": "Kiran", "phone": "+919833300001", "message": "price?"}]


def test_a_known_customer_enquiring_again_runs_the_standing_rule_now() -> None:
    ran: list[str] = []
    done = threading.Event()
    svc = service({"status": "received", "counts": {"ready": 0, "duplicates_merged": 1}, "again": 1, "problems": []}, ran, done)
    assert svc._live(SECRET, ROW) == "received"
    assert done.wait(2) and ran, "the outreach step runs at once, not at the worker's next tick"


def test_a_new_lead_still_runs_it_and_a_double_submit_does_not() -> None:
    ran: list[str] = []
    done = threading.Event()
    svc = service({"status": "received", "counts": {"ready": 1}, "again": 0, "problems": []}, ran, done)
    svc._live(SECRET, ROW)
    assert done.wait(2)

    ran2: list[str] = []
    done2 = threading.Event()
    svc2 = service({"status": "received", "counts": {"ready": 0, "duplicates_merged": 0, "already_imported": 1}, "again": 0, "problems": [{"row": 1, "reason": "duplicate_within_10_min"}]}, ran2, done2)
    svc2._live(SECRET, ROW)
    assert not done2.wait(0.3) and not ran2, "a double submit starts nothing"


def test_why_a_row_was_not_stored_is_logged_as_a_closed_word(caplog: pytest.LogCaptureFixture) -> None:
    svc = service({"status": "received", "counts": {"already_imported": 1}, "again": 0, "problems": [{"row": 1, "reason": "duplicate_within_10_min"}, {"row": 2, "reason": "Not A Closed Word!"}]}, [], threading.Event())
    with caplog.at_level(logging.INFO, logger="app.lead_sources"):
        svc._live(SECRET, ROW)
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "row 1 not stored: duplicate_within_10_min" in text
    assert "Not A Closed Word" not in text, "only closed words are logged"


def test_today_knows_the_enquired_again_kind() -> None:
    assert "enquired_again" in NeedsYouItem.model_fields["kind"].annotation.__args__  # type: ignore[union-attr]


def test_the_enquired_again_sentence_is_plain_and_has_no_customer_words() -> None:
    text = _summary("enquired_again", "website_form", None)
    assert "enquired again" in text and "website_form" not in text
