"""Phone calls, part 1: the gate. One test per rule, in the order the rules are checked; the first refusal wins (job-phone-calls.md, section 4)."""

# ruff: noqa: E501
from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.telephony import gate
from app.telephony.gate import (
    Allowed,
    Hours,
    InboundDecision,
    InboundFacts,
    OutboundFacts,
    Refused,
    Settings,
)

IST = ZoneInfo("Asia/Kolkata")
TUESDAY_11 = datetime(2026, 11, 3, 11, 0, tzinfo=IST)   # a Tuesday (isoweekday 2)
SANDBOX = Settings(mode="sandbox", sandbox_numbers=frozenset({"+919876543210"}))
LIVE = Settings(mode="live", live_confirmed=True)
OPENING = "Hello, this is the AI assistant of Sri Textiles. Is this a good time to talk?"


def facts(**kw: object) -> OutboundFacts:
    base = OutboundFacts(number="+919876543210", purpose="visit_reminder", now=TUESDAY_11, hours=Hours(days=[1, 2, 3, 4, 5, 6], from_minute=9 * 60, to_minute=20 * 60), approval="plan", approval_valid=True,
                         can_contact=True, dnd="no", opening_line=OPENING)
    return replace(base, **kw)  # type: ignore[arg-type]


def refused(s: Settings, f: OutboundFacts) -> str:
    out = gate.check_outbound(s, f)
    assert isinstance(out, Refused), f"expected a refusal, got {out}"
    return out.reason


def test_a_fully_approved_call_in_hours_goes_ahead() -> None:
    out = gate.check_outbound(SANDBOX, facts())
    assert out == Allowed(promotional=False)


def test_every_refusal_reason_is_a_known_closed_word() -> None:
    cases = [
        (Settings(mode="off"), facts()), (Settings(mode="live"), facts()), (SANDBOX, facts(number="12345")), (SANDBOX, facts(number="+919000000000")), (SANDBOX, facts(approval=None)),
        (SANDBOX, facts(approval_valid=False)), (SANDBOX, facts(workspace_paused=True)), (SANDBOX, facts(billing_ok=False)), (SANDBOX, facts(is_school=True, purpose="payment_reminder")),
        (SANDBOX, facts(allowed_purposes=["sales_followup"])), (SANDBOX, facts(now=datetime(2026, 11, 3, 22, 0, tzinfo=IST))), (SANDBOX, facts(holidays=["2026-11-03"])),
        (SANDBOX, facts(now=datetime(2026, 11, 8, 11, 0, tzinfo=IST))), (SANDBOX, facts(calls_to_contact_this_week=1)), (SANDBOX, facts(daily_cap=5, calls_today=5)),
        (SANDBOX, facts(minutes_cap=60.0, minutes_today=60.0)), (SANDBOX, facts(erased_or_archived=True)), (SANDBOX, facts(suppressed=True)), (SANDBOX, facts(can_contact=False)),
        (SANDBOX, facts(dnd="yes")), (SANDBOX, facts(purpose="sales_followup", dnd="unknown")), (SANDBOX, facts(opening_line="Hello, how are you?")),
        (SANDBOX, facts(active_calls_to_number=1)), (SANDBOX, facts(active_calls_total=2)),
    ]
    for settings, f in cases:
        assert refused(settings, f) in gate.REASONS


@pytest.mark.parametrize(
    ("settings", "change", "reason"),
    [
        (Settings(mode="off"), {}, "telephony_off"),
        (Settings(mode="live"), {}, "live_not_confirmed"),
        (SANDBOX, {"number": "12345"}, "bad_number"),
        (SANDBOX, {"number": "+919000000000"}, "not_on_sandbox_list"),
        (SANDBOX, {"approval": None}, "not_approved"),
        (SANDBOX, {"approval_valid": False}, "not_approved"),
        (SANDBOX, {"workspace_paused": True}, "workspace_paused"),
        (SANDBOX, {"billing_ok": False}, "billing_blocked"),
        (SANDBOX, {"is_school": True, "purpose": "payment_reminder"}, "school_rule"),
        (SANDBOX, {"is_school": True, "purpose": "sales_followup"}, "school_rule"),
        (SANDBOX, {"allowed_purposes": ["sales_followup"]}, "purpose_not_allowed"),
        (SANDBOX, {"now": datetime(2026, 11, 3, 8, 59, tzinfo=IST)}, "outside_window"),
        (SANDBOX, {"now": datetime(2026, 11, 3, 21, 0, tzinfo=IST)}, "outside_window"),
        (SANDBOX, {"holidays": ["2026-11-03"]}, "holiday"),
        (SANDBOX, {"now": datetime(2026, 11, 8, 11, 0, tzinfo=IST)}, "outside_hours"),   # a Sunday, the workspace calls Monday to Saturday
        (SANDBOX, {"now": datetime(2026, 11, 3, 20, 30, tzinfo=IST)}, "outside_hours"),   # inside the regulation's window, after the workspace's own closing time
        (SANDBOX, {"calls_to_contact_this_week": 1}, "weekly_limit"),
        (SANDBOX, {"daily_cap": 5, "calls_today": 5}, "daily_cap"),
        (SANDBOX, {"minutes_cap": 60.0, "minutes_today": 60.0}, "minutes_cap"),
        (SANDBOX, {"erased_or_archived": True}, "erased_or_archived"),
        (SANDBOX, {"suppressed": True}, "suppressed"),
        (SANDBOX, {"can_contact": False}, "no_consent"),
        (SANDBOX, {"dnd": "yes"}, "dnd"),
        (SANDBOX, {"dnd": "yes", "purpose": "payment_reminder"}, "dnd"),
        (SANDBOX, {"purpose": "sales_followup", "dnd": "unknown"}, "dnd_unknown"),
        (SANDBOX, {"opening_line": "Hello, this is Sri Textiles. Is this a good time?"}, "no_ai_disclosure"),
        (SANDBOX, {"active_calls_to_number": 1}, "already_calling"),
        (SANDBOX, {"active_calls_total": 2}, "too_many_calls"),
    ],
)
def test_each_rule_refuses_with_its_own_word(settings: Settings, change: dict[str, object], reason: str) -> None:
    assert refused(settings, facts(**change)) == reason


def test_the_regulation_window_holds_even_when_the_workspace_set_wider_hours() -> None:
    wide = Hours(days=[1, 2, 3, 4, 5, 6, 7], from_minute=0, to_minute=24 * 60)
    assert refused(SANDBOX, facts(hours=wide, now=datetime(2026, 11, 3, 7, 0, tzinfo=IST))) == "outside_window"
    assert refused(SANDBOX, facts(hours=wide, now=datetime(2026, 11, 3, 21, 30, tzinfo=IST))) == "outside_window"


def test_the_time_is_read_in_india_time_whatever_zone_it_arrives_in() -> None:
    utc_morning = datetime(2026, 11, 3, 2, 0, tzinfo=ZoneInfo("UTC"))   # 07:30 in India
    assert refused(SANDBOX, facts(now=utc_morning)) == "outside_window"
    utc_ok = datetime(2026, 11, 3, 6, 0, tzinfo=ZoneInfo("UTC"))   # 11:30 in India
    assert isinstance(gate.check_outbound(SANDBOX, facts(now=utc_ok)), Allowed)


def test_unknown_dnd_stops_a_sales_call_but_not_a_reminder_to_an_existing_customer() -> None:
    assert refused(SANDBOX, facts(purpose="sales_followup", dnd="unknown")) == "dnd_unknown"
    assert refused(SANDBOX, facts(purpose="admission_followup", dnd="unknown")) == "dnd_unknown"
    assert gate.check_outbound(SANDBOX, facts(purpose="payment_reminder", dnd="unknown")) == Allowed(promotional=False)
    assert gate.check_outbound(SANDBOX, facts(purpose="sales_followup", dnd="no")) == Allowed(promotional=True)


def test_a_purpose_nobody_listed_counts_as_promotional() -> None:
    assert gate.is_promotional("something_new") and not gate.is_promotional("visit_reminder")


def test_a_number_is_judged_in_any_spelling() -> None:
    assert isinstance(gate.check_outbound(SANDBOX, facts(number="098765 43210")), Allowed)
    assert isinstance(gate.check_outbound(SANDBOX, facts(number="+91-98765-43210")), Allowed)


def test_the_sandbox_list_is_the_only_door_in_sandbox_and_does_not_apply_live() -> None:
    assert refused(SANDBOX, facts(number="+919123456789")) == "not_on_sandbox_list"
    assert isinstance(gate.check_outbound(LIVE, facts(number="+919123456789")), Allowed)


def test_the_disclosure_is_recognised_in_every_language() -> None:
    for line in ("this is the AI assistant", "నేను AI assistant ని", "मैं एआई सहायक हूँ", "ನಾನು AI assistant", "நான் AI assistant", "ഞാൻ AI assistant"):
        assert gate.has_ai_disclosure(line), line
    assert not gate.has_ai_disclosure("Hello, this is Sri Textiles, are you available?")
    assert not gate.has_ai_disclosure("Please wait, say it again")   # "AI" inside other words does not count


# ---- inbound -----------------------------------------------------------------------------------------------------------------------------------


def inbound(**kw: object) -> InboundFacts:
    return replace(InboundFacts(to_number="+918000000000", now=TUESDAY_11, line_known=True, inbound_on=True, hours=Hours(days=[1, 2, 3, 4, 5, 6], from_minute=9 * 60, to_minute=20 * 60)), **kw)  # type: ignore[arg-type]


def test_an_inbound_call_in_hours_is_talked_to() -> None:
    assert gate.check_inbound(SANDBOX, inbound()) == InboundDecision(True)


@pytest.mark.parametrize(
    ("settings", "change", "reason"),
    [
        (Settings(mode="off"), {}, "telephony_off"),
        (Settings(mode="live"), {}, "live_not_confirmed"),
        (SANDBOX, {"line_known": False}, "no_such_line"),
        (SANDBOX, {"inbound_on": False}, "inbound_off"),
        (SANDBOX, {"blocked_caller": True}, "blocked_caller"),
        (SANDBOX, {"active_calls_total": 2}, "too_many_calls"),
    ],
)
def test_inbound_refusals(settings: Settings, change: dict[str, object], reason: str) -> None:
    out = gate.check_inbound(settings, inbound(**change))
    assert out == Refused(reason)


def test_after_hours_the_assistant_does_not_hold_a_conversation() -> None:
    late = datetime(2026, 11, 3, 22, 30, tzinfo=IST)
    assert gate.check_inbound(SANDBOX, inbound(now=late)) == InboundDecision(False, "outside_hours")
    sunday = datetime(2026, 11, 8, 11, 0, tzinfo=IST)
    assert gate.check_inbound(SANDBOX, inbound(now=sunday)) == InboundDecision(False, "outside_hours")
