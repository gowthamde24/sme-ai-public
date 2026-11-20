"""How a customer or a lead is NAMED on screen and in messages (owner, 30 Oct 2026): the person's name, else their phone number, else "New enquiry". An internal id is never a name.

The WhatsApp and enquiry ingestion make a generic company for a customer who has not given a name ("WhatsApp customer 84407a", "Enquiry 8a297f": the last six characters of an id), and a WhatsApp contact without a
profile name is "WhatsApp 4407" (the last four digits). Those are placeholders, not names: `real_name` says so, and every place that shows a customer uses `lead_title` / `real_name`.
Pure text in, text out; every pattern is bounded."""

# ruff: noqa: E501

from __future__ import annotations

import re

NO_NAME = "New enquiry"
_PLACEHOLDER = re.compile(
    r"^(?:(?:whatsapp\s{1,3}customer|enquiry|inquiry|lead|customer|contact|new\s{1,3}lead)\s{1,3}[0-9a-f]{4,12}|whatsapp\s{1,3}\d{3,4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,40})$",
    re.IGNORECASE,
)


# The demo and test data carry a marker after the name ("Anitha R (demo)", "Ravi (synthetic)"): it is data for us, never part of the name a person sees (planner, 20 Nov 2026: "Anitha (." must not appear)
_MARKER = re.compile(r"\s*\((?:demo|synthetic|test|sample)\)\s*$", re.IGNORECASE)


def without_marker(name: str) -> str:
    """The name without a trailing demo marker; a name that is only a marker stays as it is."""
    cleaned = _MARKER.sub("", name)
    return cleaned if cleaned.strip() else name


def real_name(value: object) -> str | None:
    """The name when it is one, unchanged (but for a trailing demo marker); None for nothing, a blank, or a placeholder made from an id."""
    if not isinstance(value, str):
        return None
    if not value.strip() or _PLACEHOLDER.fullmatch(" ".join(value.split())):
        return None
    return without_marker(value.strip())   # as written: a name with a line break in it stays one (the quote renderer refuses it; this must not tidy it away)


def lead_title(name: object, phone: object = None, last4: object = None) -> str:
    """The name, else the phone number, else (only the last four digits known) "Number ending 4407", else "New enquiry"."""
    named = real_name(name)
    if named:
        return named
    if isinstance(phone, str) and phone.strip():
        return " ".join(phone.split())
    if isinstance(last4, str) and last4.strip():
        return f"Number ending {last4.strip()}"
    return NO_NAME


def without_display_name(data: object) -> object:
    """`display_name` is worked out from the other fields and only ever leaves the API: a model built again from a dump of itself must not refuse it."""
    if isinstance(data, dict) and "display_name" in data:
        return {k: v for k, v in data.items() if k != "display_name"}
    return data
