"""The visits calendar feed as an iCalendar (RFC 5545) text. Pure: the rows come from `public.calendar_feed_read`, which has already cut them down to what may be shown (when, how long, the state,
the party size and "first name + last initial"). Nothing else is added here: no phone number, e-mail, note, purpose or company ever reaches a calendar.

Times are written in UTC with a trailing Z, which every calendar app converts to the person's own zone. Lines are CRLF-terminated and folded at 75 octets without splitting a UTF-8 character. A booked
visit is TENTATIVE (not yet confirmed by the shop); confirmed and arrived are CONFIRMED. Each event's UID is stable (`visit-<id>@sme-ai`), so an app updates a moved visit instead of adding a second one."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

PRODID = "-//SME AI Revenue Engine//Store visits//EN"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")


def _fold(line: str) -> list[str]:
    data = line.encode("utf-8")
    if len(data) <= 75:
        return [line]
    out: list[str] = []
    start = 0
    limit = 75
    while start < len(data):
        end = min(start + limit, len(data))
        while end < len(data) and (data[end] & 0xC0) == 0x80:  # never cut inside a character
            end -= 1
        out.append(data[start:end].decode("utf-8"))
        start = end
        limit = 74  # a continuation line starts with one space
    return [out[0], *[" " + part for part in out[1:]]]


def _utc(value: str) -> str:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def build_calendar(feed: dict[str, Any]) -> str:
    business = str(feed.get("business") or "Shop")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(business)} - store visits",
        "X-WR-TIMEZONE:Asia/Kolkata",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for ev in feed.get("events") or []:
        status = "TENTATIVE" if ev.get("status") == "booked" else "CONFIRMED"
        size = int(ev.get("party_size") or 1)
        note = f"{size} {'person' if size == 1 else 'people'} - {ev.get('status')}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:visit-{ev['id']}@sme-ai",
            f"DTSTAMP:{_utc(str(ev.get('updated_at') or feed['generated_at']))}",
            f"DTSTART:{_utc(str(ev['starts_at']))}",
            f"DTEND:{_utc(str(ev['ends_at']))}",
            f"SUMMARY:{_escape('Visit: ' + str(ev.get('label') or 'Customer'))}",
            f"DESCRIPTION:{_escape(note)}",
            f"STATUS:{status}",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    folded = [part for line in lines for part in _fold(line)]
    return "\r\n".join(folded) + "\r\n"
