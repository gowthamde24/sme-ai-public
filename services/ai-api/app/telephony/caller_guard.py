"""A forwarded call can arrive showing the wrong caller number (owner decision 11 Nov 2026). The shop's mobile forwards to our Plivo number when nobody answers; some operators then replace the caller's number with the SHOP's own number (or with our line). Such a call has no usable caller number: it must never be taken for a lead's number, so it never creates or updates a lead, and the record says so.

`hidden_by_forwarding(caller, our_line, shop_numbers)` is the one test. `caller_for_lead(...)` is the ONLY way any code may take a number from an inbound call for a lead (today no inbound path creates or links a lead; the call row carries no contact): it gives None for such a call.
Numbers are compared on their last ten digits, so +91..., 0..., and 91... forms of one number are the same number. `shop_numbers` come from TELEPHONY_SHOP_NUMBERS (the shop's own mobile numbers, comma separated; a Secret Manager value, never in the repository)."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Iterable

HIDDEN = "hidden_by_forwarding"   # the value of `captured["caller_number"]` in the call record
LABEL = "Caller number hidden by forwarding"   # what the Calls list shows in place of "Caller ending ..."


def tail(number: object) -> str:
    digits = "".join(c for c in str(number or "") if c.isdigit())
    return digits[-10:] if len(digits) >= 6 else ""


def hidden_by_forwarding(caller: object, our_line: object, shop_numbers: Iterable[str] = ()) -> bool:
    """True when the caller number is the shop's own mobile, or our own line (the call is our dialled leg coming back, or a forward that replaced the number)."""
    who = tail(caller)
    if not who:
        return False
    return who == tail(our_line) or who in {tail(n) for n in shop_numbers}


def caller_for_lead(caller: object, our_line: object, shop_numbers: Iterable[str] = ()) -> str | None:
    """The caller's number for a lead, or None when the call shows the shop's own or our number. Nothing else may create or update a lead from an inbound call."""
    if not tail(caller) or hidden_by_forwarding(caller, our_line, shop_numbers):
        return None
    return str(caller)
