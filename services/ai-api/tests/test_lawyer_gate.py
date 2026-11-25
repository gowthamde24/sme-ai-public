"""The lawyer's written opinion (25 Nov 2026) in the call gate: the 10:00 window, the global kill switch, the workspace's own verified number and accepted usage statement, the enquiry age (7 days; 3 months for an
application; none for a registered consent) and the complaint pause at 5. Sandbox behaviour is unchanged."""

# ruff: noqa: E501
from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.telephony import gate
from app.telephony.gate import Allowed, Hours, OutboundFacts, Refused, Settings

IST = ZoneInfo("Asia/Kolkata")
TUESDAY = datetime(2026, 11, 3, 11, 0, tzinfo=IST)
NUMBER = "+919876543210"
OPENING = "Hello, this is the AI assistant of Sri Textiles. Is this a good time to talk?"
SANDBOX = Settings(mode="sandbox", sandbox_numbers=frozenset({NUMBER}))
REAL = Settings(mode="live", live_confirmed=True, outbound_real=True)


def facts(**kw: object) -> OutboundFacts:
    base = OutboundFacts(number=NUMBER, purpose="sales_followup", now=TUESDAY, hours=Hours(days=[1, 2, 3, 4, 5, 6], from_minute=10 * 60, to_minute=20 * 60), approval="plan", approval_valid=True,
                         can_contact=True, dnd="no", opening_line=OPENING, own_number_verified=True, usage_ack=True, enquiry_age_days=2.0)
    return replace(base, **kw)  # type: ignore[arg-type]


def reason(s: Settings, f: OutboundFacts) -> str:
    out = gate.check_outbound(s, f)
    assert isinstance(out, Refused), out
    return out.reason


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, 3, hour, minute, tzinfo=IST)


def test_the_window_opens_at_ten_not_nine() -> None:
    assert gate.WINDOW_FROM_MINUTE == 600 and gate.WINDOW_TO_MINUTE == 1260
    wide = Hours(days=[1, 2, 3, 4, 5, 6, 7], from_minute=9 * 60, to_minute=21 * 60)
    assert reason(REAL, facts(now=at(9, 30), hours=wide)) == "outside_window"
    assert reason(REAL, facts(now=at(9, 59), hours=wide)) == "outside_window"
    assert isinstance(gate.check_outbound(REAL, facts(now=at(10, 0), hours=wide)), Allowed)
    assert isinstance(gate.check_outbound(REAL, facts(now=at(20, 59), hours=wide)), Allowed)
    assert reason(REAL, facts(now=at(21, 0), hours=wide)) == "outside_window"


def test_the_sandbox_bypass_is_unchanged() -> None:
    sandbox_free = replace(SANDBOX, sandbox_ignores_hours=True)
    assert reason(SANDBOX, facts(now=at(9, 30))) == "outside_window"
    assert isinstance(gate.check_outbound(sandbox_free, facts(now=at(9, 30))), Allowed)
    assert gate.hours_bypassed(REAL) is False


def test_a_real_call_needs_the_global_switch_first() -> None:
    assert reason(replace(REAL, outbound_real=False), facts()) == "outbound_not_real"
    assert isinstance(gate.check_outbound(REAL, facts()), Allowed)
    assert isinstance(gate.check_outbound(SANDBOX, facts(own_number_verified=False, usage_ack=False, enquiry_age_days=None)), Allowed)   # a sandbox call never meets these rules


def test_a_real_call_needs_the_workspaces_own_verified_number_and_the_accepted_statement() -> None:
    assert reason(REAL, facts(own_number_verified=False)) == "no_own_number"
    assert reason(REAL, facts(usage_ack=False)) == "usage_not_accepted"
    assert reason(REAL, facts(own_number_verified=False, usage_ack=False)) == "no_own_number"


@pytest.mark.parametrize(("age", "purpose", "expected"), [
    (0.5, "sales_followup", None), (7.0, "sales_followup", None), (7.5, "sales_followup", "enquiry_too_old"), (30.0, "sales_followup", "enquiry_too_old"),
    (30.0, "admission_followup", None), (92.0, "admission_followup", None), (93.0, "admission_followup", "enquiry_too_old"),
    (None, "sales_followup", "no_proof_of_request"), (None, "admission_followup", "no_proof_of_request"),
])
def test_an_enquiry_supports_a_call_for_seven_days_an_application_for_three_months(age: float | None, purpose: str, expected: str | None) -> None:
    out = gate.check_outbound(REAL, facts(enquiry_age_days=age, purpose=purpose))
    if expected is None:
        assert isinstance(out, Allowed)
    else:
        assert out == Refused(expected)


def test_a_registered_consent_has_no_age_and_a_business_statement_alone_never_unlocks_a_real_call() -> None:
    assert isinstance(gate.check_outbound(REAL, facts(enquiry_age_days=None, registered_consent=True)), Allowed)
    assert isinstance(gate.check_outbound(REAL, facts(enquiry_age_days=400.0, registered_consent=True)), Allowed)
    # the person is on the list as consenting (can_contact) but no enquiry and no registrar id: refused
    assert reason(REAL, facts(enquiry_age_days=None, registered_consent=False, can_contact=True)) == "no_proof_of_request"


def test_the_databases_own_seven_day_proof_still_counts_for_a_caller_that_carries_no_age() -> None:
    assert isinstance(gate.check_outbound(REAL, facts(enquiry_age_days=None, proof_of_request=True)), Allowed)


def test_five_logged_complaints_in_ten_days_pause_the_workspace() -> None:
    assert isinstance(gate.check_outbound(REAL, facts(logged_complaints=4)), Allowed)
    assert reason(REAL, facts(logged_complaints=5)) == "complaints_pause"
    assert reason(SANDBOX, facts(logged_complaints=5)) == "complaints_pause"


def test_every_new_reason_is_a_known_closed_word_with_plain_words() -> None:
    from app.telephony.call_words import REFUSED_SENTENCE

    for word in ("enquiry_too_old", "outbound_not_real", "no_own_number", "usage_not_accepted"):
        assert word in gate.REASONS and word in REFUSED_SENTENCE and REFUSED_SENTENCE[word].startswith("Not called")
