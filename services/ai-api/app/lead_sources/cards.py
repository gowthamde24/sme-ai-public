"""The Sources page as big simple cards (job EB part B): each way of getting leads has ONE clear action and a live status in plain words. Pure: the numbers come from the database (lead_source_cards_stats and the
list of sources), what is switched on from the service. No HTTP code, no API term ever reaches a card."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

ORDER = ("meta", "indiamart", "email_forward", "website", "files", "whatsapp", "missed_calls")
EMAIL_TAGS = ("email_forward", "justdial", "99acres", "magicbricks", "housing")
WEBSITE_TAGS = ("website_form", "webhook")
FILE_TAGS = ("excel_upload", "google_sheet", "pasted_list", "vcard")
TITLES = {
    "meta": "Facebook and Instagram lead ads",
    "indiamart": "IndiaMART",
    "email_forward": "JustDial, Sulekha and other portals",
    "website": "Your website",
    "files": "Excel, Google Sheets, a list or your phone contacts",
    "whatsapp": "WhatsApp",
    "missed_calls": "Missed calls",
}


@dataclass(frozen=True)
class Available:
    """What the operator has switched on (the card says 'Coming soon' for the rest)."""

    meta: bool = False
    indiamart: bool = False
    email_forward: bool = False
    website: bool = False


def _action(kind: str, label: str) -> dict[str, str]:
    return {"type": kind, "label": label}


def _when(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _count(stats: dict[str, Any], tags: tuple[str, ...]) -> tuple[int, datetime | None]:
    by_tag = stats.get("by_tag") or {}
    total, last = 0, None
    for tag in tags:
        item = by_tag.get(tag) or {}
        total += int(item.get("received_7d") or 0)
        seen = _when(item.get("last_at"))
        if seen is not None and (last is None or seen > last):
            last = seen
    return total, last


def _detail(received: int, last: datetime | None, now: datetime) -> str:
    if received > 0:
        return f"{received} lead{'s' if received != 1 else ''} this week"
    if last is None:
        return "Waiting for the first lead"
    return "Nothing received for 7 days" if now - last > timedelta(days=7) else "No new leads this week"


def _card(kind: str, status: str, headline: str, detail: str | None, received: int, last: datetime | None, action: dict[str, str], *, available: bool = True, problem: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "kind": kind, "title": TITLES[kind], "status": status, "headline": headline, "detail": detail, "received_7d": received,
        "last_received_at": last, "action": action, "problem": problem, "available": available,
    }


def _source_card(kind: str, sources: list[dict[str, Any]], kinds: tuple[str, ...], tags: tuple[str, ...], stats: dict[str, Any], now: datetime, *, on: bool, off_label: str, connect: dict[str, str], resume_label: str) -> dict[str, Any]:
    received, last = _count(stats, tags)
    mine = [s for s in sources if s.get("kind") in kinds]
    if not on:
        return _card(kind, "coming_soon", "Coming soon", off_label, 0, None, _action("none", ""), available=False)
    if not mine:
        return _card(kind, "not_connected", "Not connected", None, 0, None, connect)
    if all(s.get("status") == "paused" for s in mine):
        problem = {"code": "source_paused", "message": "This is paused, so no new leads come in.", "fix": _action("resume", resume_label)}
        return _card(kind, "needs_attention", "Paused", None, received, last, connect, problem=problem)
    return _card(kind, "connected", "Connected", _detail(received, last, now), received, last, connect)


def build_cards(sources: list[dict[str, Any]], stats: dict[str, Any], available: Available, *, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    cards: dict[str, dict[str, Any]] = {}
    cards["meta"] = _source_card("meta", sources, ("meta_lead_ads",), ("meta_lead_ads",), stats, now, on=available.meta, off_label="Facebook and Instagram lead ads will connect here.", connect=_action("oauth", "Continue with Facebook"), resume_label="Turn back on")
    cards["indiamart"] = _source_card("indiamart", sources, ("indiamart",), ("indiamart",), stats, now, on=available.indiamart, off_label="Paste your IndiaMART key here. Coming soon.", connect=_action("paste_key", "Paste your IndiaMART key"), resume_label="Turn back on")
    cards["email_forward"] = _source_card("email_forward", sources, ("email_forward",), EMAIL_TAGS, stats, now, on=available.email_forward, off_label="Forward your portal e-mails here. Ask us to switch this on.", connect=_action("copy_address", "Copy your address"), resume_label="Turn back on")
    cards["website"] = _source_card("website", sources, ("website_form", "webhook"), WEBSITE_TAGS, stats, now, on=available.website, off_label="A form for your website. Ask us to switch this on.", connect=_action("copy_snippet", "Copy the form"), resume_label="Turn back on")

    received, last = _count(stats, FILE_TAGS)
    sheets = stats.get("sheets") or {}
    imports = stats.get("imports") or {}
    last_import = _when(imports.get("last_at"))
    if last_import is not None and (last is None or last_import > last):
        last = last_import
    received = max(received, int(imports.get("received_7d") or 0))
    ever = last is not None or int(sheets.get("total") or 0) > 0
    if int(sheets.get("needs_attention") or 0) > 0:
        problem = {"code": "sheet_needs_attention", "message": "A Google Sheet you linked cannot be read now. Open it and check that it is still shared and has the same columns.", "fix": _action("open", "Open my sheets")}
        cards["files"] = _card("files", "needs_attention", "Needs a look", _detail(received, last, now), received, last, _action("upload", "Add a file or a list"), problem=problem)
    elif ever:
        cards["files"] = _card("files", "connected", "Ready", _detail(received, last, now), received, last, _action("upload", "Add a file or a list"))
    else:
        cards["files"] = _card("files", "not_connected", "Nothing added yet", None, 0, None, _action("upload", "Add a file or a list"))

    received, last = _count(stats, ("whatsapp",))
    wa = (stats.get("whatsapp") or {}).get("status")
    if wa == "active":
        cards["whatsapp"] = _card("whatsapp", "connected", "Connected", f"{received} new chat{'s' if received != 1 else ''} this week" if received else "New chats become leads by themselves", received, last, _action("none", ""))
    elif wa == "pending":
        cards["whatsapp"] = _card("whatsapp", "not_connected", "Connecting", "Waiting for WhatsApp to finish connecting", 0, None, _action("none", "Open Integrations"))
    else:
        cards["whatsapp"] = _card("whatsapp", "not_connected", "Not connected", "Connect it in Integrations: new chats become leads by themselves", 0, None, _action("none", "Open Integrations"))
    cards["missed_calls"] = _card("missed_calls", "coming_soon", "Coming soon", "Missed calls become leads when phone calls are switched on (December).", 0, None, _action("none", ""), available=False)
    return [cards[k] for k in ORDER]
