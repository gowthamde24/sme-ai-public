"""The Sources page as big simple cards (job EB part B): each way of getting leads has ONE clear action and a live status in plain words. Pure: the numbers come from the database (lead_source_cards_stats and the
list of sources), what is switched on from the service. No HTTP code, no API term ever reaches a card."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

ORDER = ("website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets", "files", "whatsapp")
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
    "click_to_whatsapp": "Ads that open WhatsApp",
    "google_ads": "Google Ads lead forms",
    "sheets": "Google Sheets",
}
# the lead tag the owner's cost per lead is saved under (PUT /outreach/source-costs) and the tags a card counts
COST_SOURCE = {"website": "website_form", "missed_calls": "missed_calls", "meta": "meta_lead_ads", "click_to_whatsapp": "click_to_whatsapp", "indiamart": "indiamart", "email_forward": "email_forward",
               "google_ads": "google_ads", "sheets": "google_sheet", "files": "excel_upload", "whatsapp": "whatsapp"}
TESTABLE = {"website": "Send a test lead to your Leads", "missed_calls": "Send a test missed call to your Leads", "google_ads": "Send a test Google Ads lead to your Leads",
            "email_forward": "Send a test portal e-mail to your Leads",
            "indiamart": "Check your IndiaMART key"}   # a kind is added here in the slice that builds its test
DISCONNECTABLE = {"website", "missed_calls", "google_ads", "email_forward", "indiamart"}


# ---- the words of a card as CODES (planner and C2, 18 Nov 2026): the API sends `text` with a code and its parameters next to every English sentence; the web holds the words in each language and falls back to the
# English field when it does not know a code. The codes are closed: a test fails when a card says a sentence that has none.
CODES: dict[str, str] = {
    "Coming soon": "card.coming_soon", "Not connected": "card.not_connected", "Paused": "card.paused", "Connected": "card.connected", "Needs a look": "card.needs_a_look", "Ready": "card.ready",
    "Nothing added yet": "card.nothing_added", "Connecting": "card.connecting", "On": "card.on", "Linked": "card.linked", "Not linked": "card.not_linked",
    "Waiting for the first lead": "detail.waiting_first", "Nothing received for 7 days": "detail.nothing_7d", "No new leads this week": "detail.none_this_week",
    "New chats become leads by themselves": "detail.chats_become_leads", "Waiting for WhatsApp to finish connecting": "detail.wa_connecting",
    "Connect it in Integrations: new chats become leads by themselves": "detail.wa_connect_in_integrations",
    "Connect WhatsApp first: then a chat that starts from your Instagram or Facebook ad becomes a lead": "detail.ctwa_connect_wa_first",
    "Paste the link of a Google Sheet: every new row becomes a lead": "detail.sheets_paste_link",
    "Facebook and Instagram lead ads will connect here.": "off.meta", "Paste your IndiaMART key here.": "off.indiamart", "Forward your portal e-mails here. Ask us to switch this on.": "off.email_forward",
    "A form for your website. Ask us to switch this on.": "off.website", "Missed calls become leads when phone calls are switched on.": "off.missed_calls",
    "Leads from your Google Ads lead forms. Ask us to switch this on.": "off.google_ads",
    "This is paused, so no new leads come in.": "problem.source_paused",
    "Needs a new key": "card.needs_new_key",
    "IndiaMART no longer accepts your key, so no new leads are coming in. A key lasts 7 days: paste a new one and they start again.": "problem.indiamart_key_expired",
    "A Google Sheet you linked cannot be read now. Open it and check that it is still shared and has the same columns.": "problem.sheet_needs_attention",
    "Continue with Facebook": "action.meta_connect", "Paste your IndiaMART key": "action.indiamart_connect", "Copy the form": "action.website_copy", "Add a file or a list": "action.files_add", "Link a sheet": "action.sheets_link",
    "Open Integrations": "action.open_integrations", "Open my sheets": "action.open_sheets", "Open Google Sheets": "action.open_google_sheets",
    "Copy your address": "action.email_forward_copy", "Resume Google Ads leads": "action.google_ads_resume", "Resume missed-call leads": "action.missed_calls_resume", "Turn back on": "action.resume",
    "Copy the address for your phone company": "action.missed_calls_copy", "Copy the address for Google Ads": "action.google_ads_copy",
    "Send a test lead to your Leads": "test.website", "Send a test missed call to your Leads": "test.missed_calls", "Send a test Google Ads lead to your Leads": "test.google_ads",
    "Send a test portal e-mail to your Leads": "test.email_forward", "Check your IndiaMART key": "test.indiamart",
}
_DYNAMIC = ((re.compile(r"^(\d+) leads? this week$"), "detail.leads_this_week"), (re.compile(r"^(\d+) new chats? this week$"), "detail.chats_this_week"), (re.compile(r"^(\d+) sheets? linked$"), "detail.sheets_linked"))


def text_ref(sentence: str | None) -> dict[str, Any] | None:
    """{code, params} for a sentence a card says, or None for no sentence. A sentence with no code gets `unknown` (the test below fails on it, so it never reaches a client)."""
    if not sentence:
        return None
    if sentence in CODES:
        return {"code": CODES[sentence], "params": {}}
    for pattern, code in _DYNAMIC:
        m = pattern.match(sentence)
        if m:
            return {"code": code, "params": {"n": int(m.group(1))}}
    return {"code": "unknown", "params": {}}


def card_text(card: dict[str, Any]) -> dict[str, Any]:
    problem = card.get("problem") or {}
    return {"headline": text_ref(card.get("headline")), "detail": text_ref(card.get("detail")), "action": text_ref((card.get("action") or {}).get("label")), "test_label": text_ref(card.get("test_label")),
            "problem_message": text_ref(problem.get("message")), "problem_fix": text_ref((problem.get("fix") or {}).get("label"))}


@dataclass(frozen=True)
class Available:
    """What the operator has switched on (the card says 'Coming soon' for the rest)."""

    meta: bool = False
    indiamart: bool = False
    email_forward: bool = False
    website: bool = False
    missed_calls: bool = False
    google_ads: bool = False


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


def _total(stats: dict[str, Any], tags: tuple[str, ...]) -> int:
    by_tag = stats.get("by_tag") or {}
    return sum(int((by_tag.get(tag) or {}).get("total") or 0) for tag in tags)


def _detail(received: int, last: datetime | None, now: datetime) -> str:
    if received > 0:
        return f"{received} lead{'s' if received != 1 else ''} this week"
    if last is None:
        return "Waiting for the first lead"
    return "Nothing received for 7 days" if now - last > timedelta(days=7) else "No new leads this week"


def _card(kind: str, status: str, headline: str, detail: str | None, received: int, last: datetime | None, action: dict[str, str], *, available: bool = True, problem: dict[str, Any] | None = None, total: int | None = None) -> dict[str, Any]:
    if status == "needs_attention" and problem is not None and problem.get("code") == "source_paused":
        state = "paused"
    elif status == "needs_attention":
        state = "needs_attention"
    elif status == "connected":
        state = "connected" if (received > 0 or last is not None) else "waiting"
    else:
        state = "off"
    card = {
        "kind": kind, "title": TITLES[kind], "status": status, "headline": headline, "detail": detail, "received_7d": received,
        "last_received_at": last, "action": action, "problem": problem, "available": available,
        "state": state, "received_count": received, "received_total": max(received, total or 0), "last_lead_at": last,
        "can_test": kind in TESTABLE and status in ("connected", "needs_attention"), "can_disconnect": kind in DISCONNECTABLE and status in ("connected", "needs_attention"),
        "test_label": TESTABLE.get(kind), "cost_source": COST_SOURCE[kind],
    }
    card["text"] = card_text(card)
    return card


def _source_card(kind: str, sources: list[dict[str, Any]], kinds: tuple[str, ...], tags: tuple[str, ...], stats: dict[str, Any], now: datetime, *, on: bool, off_label: str, connect: dict[str, str], resume_label: str) -> dict[str, Any]:
    received, last = _count(stats, tags)
    total = _total(stats, tags)
    mine = [s for s in sources if s.get("kind") in kinds and s.get("status") != "disconnected"]   # a disconnected source is as good as none: the card is off again
    if not on:
        return _card(kind, "coming_soon", "Coming soon", off_label, 0, None, _action("none", ""), available=False)
    if not mine:
        return _card(kind, "not_connected", "Not connected", None, received, last, connect, total=total)
    if all(s.get("status") == "paused" for s in mine):
        problem = {"code": "source_paused", "message": "This is paused, so no new leads come in.", "fix": _action("resume", resume_label)}
        return _card(kind, "needs_attention", "Paused", None, received, last, connect, problem=problem, total=total)
    return _card(kind, "connected", "Connected", _detail(received, last, now), received, last, connect, total=total)


def build_cards(sources: list[dict[str, Any]], stats: dict[str, Any], available: Available, *, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    cards: dict[str, dict[str, Any]] = {}
    cards["meta"] = _source_card("meta", sources, ("meta_lead_ads",), ("meta_lead_ads",), stats, now, on=available.meta, off_label="Facebook and Instagram lead ads will connect here.", connect=_action("oauth", "Continue with Facebook"), resume_label="Turn back on")
    cards["indiamart"] = _source_card("indiamart", sources, ("indiamart",), ("indiamart",), stats, now, on=available.indiamart, off_label="Paste your IndiaMART key here.", connect=_action("paste_key", "Paste your IndiaMART key"), resume_label="Turn back on")
    pull = stats.get("indiamart_pull") or {}
    if pull.get("key_state") == "expired" and cards["indiamart"]["status"] == "connected":   # the scheduled pull found the key refused (or gone): the owner sees it on the card until a new key is pasted
        received, last = _count(stats, ("indiamart",))
        problem = {"code": "key_expired", "message": "IndiaMART no longer accepts your key, so no new leads are coming in. A key lasts 7 days: paste a new one and they start again.", "fix": _action("paste_key", "Paste your IndiaMART key")}
        cards["indiamart"] = _card("indiamart", "needs_attention", "Needs a new key", None, received, last, _action("paste_key", "Paste your IndiaMART key"), problem=problem, total=_total(stats, ("indiamart",)))
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
    cards["missed_calls"] = _source_card("missed_calls", sources, ("missed_calls",), ("missed_calls",), stats, now, on=available.missed_calls, off_label="Missed calls become leads when phone calls are switched on.",
                                         connect=_action("copy_address", "Copy the address for your phone company"), resume_label="Resume missed-call leads")
    ctwa_received, ctwa_last = _count(stats, ("click_to_whatsapp",))
    ctwa_total = _total(stats, ("click_to_whatsapp",))
    if (stats.get("whatsapp") or {}).get("status") == "active":
        # nothing to connect: when WhatsApp is connected, a chat that starts from an Instagram or Facebook ad is a lead tagged with that ad
        cards["click_to_whatsapp"] = _card("click_to_whatsapp", "connected", "On", _detail(ctwa_received, ctwa_last, now), ctwa_received, ctwa_last, _action("none", "Open Integrations"), total=ctwa_total)
    else:
        cards["click_to_whatsapp"] = _card("click_to_whatsapp", "not_connected", "Not connected", "Connect WhatsApp first: then a chat that starts from your Instagram or Facebook ad becomes a lead", 0, None, _action("none", "Open Integrations"))
    cards["google_ads"] = _source_card("google_ads", sources, ("google_ads",), ("google_ads",), stats, now, on=available.google_ads, off_label="Leads from your Google Ads lead forms. Ask us to switch this on.",
                                       connect=_action("copy_address", "Copy the address for Google Ads"), resume_label="Resume Google Ads leads")
    sheets_total = int(sheets.get("total") or 0)
    if int(sheets.get("needs_attention") or 0) > 0:
        sheet_problem = {"code": "sheet_needs_attention", "message": "A Google Sheet you linked cannot be read now. Open it and check that it is still shared and has the same columns.", "fix": _action("open", "Open Google Sheets")}
        cards["sheets"] = _card("sheets", "needs_attention", "Needs a look", None, 0, None, _action("upload", "Link a sheet"), problem=sheet_problem)
    elif sheets_total > 0:
        cards["sheets"] = _card("sheets", "connected", "Linked", f"{sheets_total} sheet{'s' if sheets_total != 1 else ''} linked", 0, _when(sheets.get("last_synced_at")), _action("upload", "Link a sheet"))
    else:
        cards["sheets"] = _card("sheets", "not_connected", "Not linked", "Paste the link of a Google Sheet: every new row becomes a lead", 0, None, _action("upload", "Link a sheet"))
    return [cards[k] for k in ORDER]
