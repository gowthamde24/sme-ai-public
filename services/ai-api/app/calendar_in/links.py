"""The owner's booking page address, and the one fact the assistant may say about it.

Only an https address on the vendor's own host is kept (Calendly: calendly.com; Cal.com: cal.com or a *.cal.com name), never a link the owner did not save, and it is said only when the owner turned
"share my booking link" on (default off; the database function `scheduler_calendar_booking_link` answers nothing otherwise)."""

# ruff: noqa: E501

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from urllib.parse import urlsplit

HOSTS = {"calendly": ("calendly.com",), "calcom": ("cal.com",)}


def clean_link(kind: str, raw: str | None) -> str | None:
    """The address as it is stored, or None when it is not an https page on the vendor's host (the caller answers 422)."""
    text = (raw or "").strip()
    if not text:
        return None
    if len(text) > 255 or not text.isascii() or not text.isprintable() or " " in text:
        return None
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    ok = any(host == h or host.endswith("." + h) for h in HOSTS.get(kind, ()))
    if parts.scheme != "https" or not ok or parts.username or parts.password or port not in (None, 443) or parts.fragment or not re.fullmatch(r"[a-z0-9.-]+", host):
        return None
    return text


# set by create_app when CALENDAR_IN=on: tenant id -> the booking-link fact (or None). The phone's fact pack asks it once per workspace per read.
PROVIDER: Callable[[uuid.UUID], dict[str, str] | None] | None = None


def booking_link_fact(url: str, kind: str = "calendly") -> dict[str, str]:
    """A fact for the fact pack (kind 'booking'): the sentence the assistant may use. The address is the owner's own, said exactly as saved."""
    name = "Calendly" if kind == "calendly" else "Cal.com"
    return {"kind": "booking", "text": f"Customers can book a time themselves on the business's own {name} page: {url} . Say this address only when the caller asks how to book; never change it."}
