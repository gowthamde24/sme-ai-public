"""The Calls page words (13 Nov 2026): a closed `status` and one `outcome_sentence` made only from closed words; nothing a customer said or a model wrote."""

# ruff: noqa: E501

from __future__ import annotations

import pytest

from app.telephony import call_words
from app.telephony.service import shape

NOW = __import__("datetime").datetime(2026, 11, 13, 12, 0, tzinfo=__import__("datetime").UTC)


def row(**over: object) -> dict[str, object]:
    return {"id": "11111111-1111-4111-8111-111111111111", "direction": "inbound", "state": "completed", "created_at": "2026-11-13T09:00:00+00:00", "ended_at": "2026-11-13T09:02:00+00:00", "duration_s": 120, **over}


@pytest.mark.parametrize(
    ("over", "status", "sentence"),
    [
        ({"category": "visit_booked", "outcome": "positive"}, "completed", "Visit booked"),
        ({"category": "interested"}, "completed", "Interested; wants to know more"),
        ({"category": "do_not_call"}, "completed", "Asked us not to call again"),
        ({"outcome": "positive"}, "completed", "The call went well"),
        ({"outcome": "unclear"}, "completed", "No clear result"),
        ({}, "completed", "Call finished"),
        ({"end_reason": "handover", "category": "interested"}, "transferred", "A person took over"),
        ({"handled_at": "2026-11-13T10:00:00+00:00"}, "transferred", "A person took over"),
        ({"state": "no_answer"}, "no_answer", "No answer"),
        ({"state": "busy"}, "no_answer", "The line was busy"),
        ({"state": "voicemail"}, "no_answer", "Went to voicemail"),
        ({"state": "failed", "outcome": "failed"}, "no_answer", "The call did not connect"),
        ({"state": "refused", "refuse_reason": "blocked_caller"}, "spam", "Blocked caller"),
        ({"state": "refused", "refuse_reason": "outside_hours"}, "rejected", "Not called: outside calling hours"),
        ({"state": "refused", "refuse_reason": "something_new"}, "rejected", "The call was not placed"),
        ({"state": "cancelled"}, "rejected", "Cancelled before it was placed"),
    ],
)
def test_status_and_sentence(over: dict[str, object], status: str, sentence: str) -> None:
    r = row(**over)
    assert call_words.status_of(r, False) == status and call_words.sentence_of(r, False) == sentence


def test_a_live_call_is_live_and_talking_now_whatever_else_the_row_says() -> None:
    r = row(state="in_progress", category="visit_booked")
    assert call_words.status_of(r, True) == "live" and call_words.sentence_of(r, True) == "Talking now"


def test_the_sentence_never_carries_what_was_said_or_a_name_or_a_number() -> None:
    r = row(summary="Ravi Kumar +91 98765 43210 wants 12 sarees for Rs 48,000", captured={"name": "Ravi"}, category="interested")
    assert call_words.sentence_of(r, False) == "Interested; wants to know more"
    for words in (*call_words.CATEGORY_SENTENCE.values(), *call_words.OUTCOME_SENTENCE.values(), *call_words.STATE_SENTENCE.values(), *call_words.REFUSED_SENTENCE.values()):
        assert not any(ch.isdigit() for ch in words), words


def test_the_list_row_carries_both_new_fields() -> None:
    shaped = shape(row(category="visit_booked"), NOW)
    assert shaped["status"] == "completed" and shaped["outcome_sentence"] == "Visit booked"
