"""(d) In-call actions: book a slot, send a WhatsApp during the call, look up stock / price / fee from OUR data, call the owner's own API (a webhook tool) with a timeout. Each tool is a function behind an interface; the
backends here are fakes until the calendar, WhatsApp and the owner's endpoint are connected. The webhook tool refuses any address that is not global unicast (the SSRF guard of the fetcher) and caps the wait."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlsplit

from app.webfetch.netguard import address_allowed

WEBHOOK_TIMEOUT_SECONDS = 5


class Backends(Protocol):
    def free_slots(self, day: str) -> list[str]: ...
    def book(self, day: str, slot: str, name: str) -> str: ...
    def whatsapp(self, text: str) -> str: ...
    def lookup(self, kind: str, key: str) -> str | None: ...
    def post_json(self, url: str, body: dict[str, Any], timeout: int) -> dict[str, Any]: ...


@dataclass
class FakeBackends:
    slots: dict[str, list[str]] = field(default_factory=lambda: {"2026-11-01": ["11:00", "15:00"]})
    data: dict[tuple[str, str], str] = field(default_factory=lambda: {("price", "paver-60mm"): "Rs 38 per piece", ("fee", "class-10"): "Rs 5,000 per term"})
    sent: list[str] = field(default_factory=list)
    posted: list[tuple[str, dict[str, Any], int]] = field(default_factory=list)

    def free_slots(self, day: str) -> list[str]:
        return list(self.slots.get(day, []))

    def book(self, day: str, slot: str, name: str) -> str:
        self.slots[day].remove(slot)
        return f"fake-booking-{day}-{slot}"

    def whatsapp(self, text: str) -> str:
        self.sent.append(text)
        return "fake-message-id"

    def lookup(self, kind: str, key: str) -> str | None:
        return self.data.get((kind, key))

    def post_json(self, url: str, body: dict[str, Any], timeout: int) -> dict[str, Any]:
        self.posted.append((url, body, timeout))
        return {"ok": True}


@dataclass(frozen=True)
class ToolResult:
    ok: bool
    result: str  # a closed word on failure (no_slot, not_found, blocked_address, bad_url), else the text the assistant may say


def book_slot(b: Backends, day: str, slot: str, name: str) -> ToolResult:
    if slot not in b.free_slots(day):
        return ToolResult(False, "no_slot")
    return ToolResult(True, b.book(day, slot, name))


def send_whatsapp(b: Backends, text: str) -> ToolResult:
    return ToolResult(True, b.whatsapp(text[:1000]))


def look_up(b: Backends, kind: str, key: str) -> ToolResult:
    """Only what OUR data holds (price list, fee template, stock): never invented."""
    found = b.lookup(kind, key)
    return ToolResult(True, found) if found else ToolResult(False, "not_found")


def webhook_tool(b: Backends, url: str, body: dict[str, Any], *, resolved_ip: str) -> ToolResult:
    """Call the owner's own API: https only, the address it resolves to must be global unicast, the wait is capped. `resolved_ip` is the address the connection will use (the real caller resolves and passes it)."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return ToolResult(False, "bad_url")
    try:
        ip = ipaddress.ip_address(resolved_ip)
    except ValueError:
        return ToolResult(False, "bad_url")
    if not address_allowed(ip):
        return ToolResult(False, "blocked_address")
    b.post_json(url, body, WEBHOOK_TIMEOUT_SECONDS)
    return ToolResult(True, "done")
