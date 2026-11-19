# ruff: noqa: E501
"""The words for a business whose own number of free call minutes (Customer Zero's 500 a month; migration 20261231986200) is used up (owner decision, 19 Nov 2026).

An INCOMING call is not refused with words: it rings the shop's own phone (plivo_routes, `forward_to`). An OUTGOING call stops with ONE plain sentence for the Owner, sent as the API error `free_minutes_used_up` with its two
facts as closed extras (`minutes`, `restarts_on`: an India date, the first of next month), so the web can say it in the Owner's language; the English sentence below is what the server sends today.
The database decides everything (the number, the month, whether it is used up); this module only turns its answer into words."""

from __future__ import annotations

from datetime import date
from typing import Any

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def free_minutes_used_up(free: Any) -> tuple[str, int, str] | None:
    """(the sentence, the minutes of the allowance, the ISO date the calls restart) from the line lookup's `free_minutes` ({minutes, restarts_on}), or None when the business has no number of its own or the answer is unreadable."""
    if not isinstance(free, dict):
        return None
    minutes, restarts = free.get("minutes"), free.get("restarts_on")
    if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes < 0 or not isinstance(restarts, str):
        return None
    try:
        day = date.fromisoformat(restarts)
    except ValueError:
        return None
    return f"Your {minutes} free minutes this month are used up. Calls restart on {day.day} {MONTHS[day.month - 1]}.", minutes, day.isoformat()
