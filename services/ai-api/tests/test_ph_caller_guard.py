"""Owner decision 11 Nov 2026: a call whose caller number is the shop's own mobile or our own line (a forward that hid the real number) never creates or updates a lead, and the call record says "caller number hidden by forwarding"."""

# ruff: noqa: E501

from __future__ import annotations

import inspect
from types import SimpleNamespace

from app.telephony import caller_guard, gate, inbound_store
from app.telephony.caller_guard import caller_for_lead, hidden_by_forwarding
from app.telephony.inbound_routes import caller_marks
from app.telephony.service import _who
from app.telephony.settings import gate_settings

SHOP = "+919000000002"      # invented
LINE = "+918000000001"      # invented: our Plivo number
REAL = "+917000000003"      # invented: a real caller


def test_the_shop_mobile_and_our_own_line_are_hidden_in_every_spelling_and_a_real_caller_is_not() -> None:
    for spelling in (SHOP, "9000000002", "09000000002", "91 90000 00002", "+91-9000000002"):
        assert hidden_by_forwarding(spelling, LINE, [SHOP]), spelling
    for spelling in (LINE, "8000000001", "918000000001"):
        assert hidden_by_forwarding(spelling, LINE, [SHOP]), spelling
    assert not hidden_by_forwarding(REAL, LINE, [SHOP])
    assert not hidden_by_forwarding(None, LINE, [SHOP]) and not hidden_by_forwarding("", LINE, [SHOP]), "no number is a different case (the gate decides), not 'hidden by forwarding'"
    assert not hidden_by_forwarding(SHOP, LINE, []), "without the shop's numbers configured only our own line can be recognised"


def test_a_lead_can_take_a_number_only_from_a_call_that_shows_the_real_caller() -> None:
    assert caller_for_lead(REAL, LINE, [SHOP]) == REAL
    assert caller_for_lead(SHOP, LINE, [SHOP]) is None
    assert caller_for_lead(LINE, LINE, [SHOP]) is None
    assert caller_for_lead("", LINE, [SHOP]) is None and caller_for_lead(None, LINE, [SHOP]) is None


def test_the_plan_of_a_forwarded_call_keeps_no_digits_and_is_marked_while_an_outbound_call_and_a_real_caller_are_untouched() -> None:
    cfg = gate_settings(SimpleNamespace(telephony_mode="sandbox", telephony_live_confirmed=False, telephony_sandbox_numbers="", telephony_shop_numbers=f"{SHOP}, not a number", telephony_max_concurrent=2))
    assert cfg.shop_numbers == frozenset({SHOP}), "a value that is not a number is ignored"
    assert caller_marks(cfg, SimpleNamespace(from_number=SHOP, to_number=LINE), None) == (None, True)
    assert caller_marks(cfg, SimpleNamespace(from_number=LINE, to_number=LINE), None) == (None, True)
    assert caller_marks(cfg, SimpleNamespace(from_number=REAL, to_number=LINE), None) == ("003", False)
    assert caller_marks(cfg, SimpleNamespace(from_number=LINE, to_number=REAL), object()) == ("001", False), "a call WE placed shows our line as From: not a forward"
    assert gate.Settings().shop_numbers == frozenset(), "unset: nothing is recognised except our own line"


def test_the_calls_list_says_the_number_was_hidden_unless_the_caller_gave_a_name() -> None:
    assert _who({"captured": {"caller_number": caller_guard.HIDDEN}}) == "Caller number hidden by forwarding"
    assert _who({"captured": {"caller_number": caller_guard.HIDDEN, "name": "Ramesh"}}) == "Ramesh"
    assert _who({"captured": {"caller_ending": "003"}}) == "Caller ending 003"


def test_an_inbound_call_row_is_begun_with_no_contact_so_nothing_links_a_lead_to_it() -> None:
    source = inspect.getsource(inbound_store.InboundStore.begin)
    assert "p_contact_id" not in source and "p_lead_id" not in source, "if an inbound call ever gets a contact or lead, it must take the number only through caller_for_lead"
