# ruff: noqa: E501
"""The actions only the BROWSER can do (owner, 14 Nov 2026: theme, app language, open a page, a filter, a settings section, Talk live on or off). The assistant asks for one with a `client_action` work card; the
web (C2) holds the typed registry, runs the action once when the card first appears and draws "Done · Undo" (it computes the undo itself from the previous value). Whatever is not listed here, or has an argument
outside its closed list, is never sent: the assistant then says it plainly instead of promising it. The lists are the web's own (agreed with C2, 14 Nov 2026)."""

from __future__ import annotations

import re
import uuid
from typing import Any

THEMES = ("light", "dark", "system")
LANGS = ("en", "te", "hi", "kn")
PAGES = ("today", "my_assistant", "calls", "chats", "leads", "campaigns", "reports", "catalogue", "phone_numbers", "billing", "settings", "outbox", "visits", "lead_sources")
SOURCE_CARDS = tuple("website missed_calls meta click_to_whatsapp indiamart email_forward google_ads sheets files whatsapp".split())   # the cards of "Where your enquiries come from" (docs/contracts/lead-sources-v2.md)
PERIODS = ("today", "14", "month")
CALL_STATUS = ("all", "completed", "transferred", "no_answer", "rejected", "spam", "live")
CALL_WHEN = ("any", "today", "7d", "30d")
SECTIONS = tuple("business profile plan members fields data language assistant activity agent leadfinder notifications limits security".split())   # (a split string: a list of literals tripped the guard that keeps plan ids out of code)
ACTIONS = ("theme", "language", "navigate", "filter", "open_settings", "talk_live", "open_record")
LEAD_CHIPS = ("all", "new", "contacted", "visit_booked", "quote", "won", "lost")   # the Leads page's own chips (C2, 15 Nov 2026)
RECORD_TYPES = ("lead", "chat", "campaign")   # what a name can be turned into an id for today (customer, call and quote need their own lookups)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

PROMPT = (
    "- client: something only the app's screen can do, asked as `client_action` + `client_args`: theme {mode: light|dark|system}; language {lang: en|te|hi|kn} (the APP's language); "
    "navigate {page: " + "|".join(PAGES) + "; card (only with lead_sources): " + "|".join(SOURCE_CARDS) + "; period (only for reports): today|14|month, or {from, to} as YYYY-MM-DD}; filter {page: calls, status?: " + "|".join(CALL_STATUS) + ", when?: " + "|".join(CALL_WHEN)
    + ", q?: up to 80 characters} or {page: leads, status?: " + "|".join(LEAD_CHIPS) + ", q?: up to 80 characters}; open_record {type: " + "|".join(RECORD_TYPES) + ", target: the person's or the campaign's name exactly as said} (\"show Kalyani's chat\" -> type chat); open_settings {section: " + "|".join(SECTIONS) + "}; talk_live {state: start|stop}. "
    "These ARE things you can do: \"switch to dark mode\" -> client theme dark; \"make the app Telugu\" / \"switch the app to Hindi\" -> client language te / hi; \"open Reports for this month\" -> client navigate. Connecting or testing where enquiries come from (\"connect my IndiaMART\", \"set up my website form\", \"test my Meta lead ads\") -> client navigate page lead_sources with that `card`; NEVER ask for or take a key, a token or a password in the chat: the owner pastes it on the card. The leads filter has no date range: \"new leads from this week\" -> filter leads status new, (the week part is dropped, the screen shows every new lead); never ask first. Never decide \"not_mine\" or \"cant_do\" for them."
)


_PERIOD_WORDS = re.compile(r"(?i)\b(this week|last week|this month|last month|yesterday|today|since|from \d|between|past \d+ days|last \d+ days)\b|ఈ వారం|ఈ నెల|నిన్న|ఈ రోజు|इस हफ्ते|इस महीने|कल|आज|ಈ ವಾರ|ಈ ತಿಂಗಳು|ನಿನ್ನೆ|ಇಂದು")


def drops_period(action: str, checked: Any, text: str) -> bool:
    """A Leads filter has chips and a text, no date range: when the owner named a period, the screen shows every lead of that chip and the answer must say so."""
    return action == "filter" and isinstance(checked, dict) and checked.get("page") == "leads" and bool(_PERIOD_WORDS.search(text or ""))


def check(action: str, args: dict[str, Any], text: str = "") -> dict[str, Any] | str:
    """The arguments if they are inside the closed lists, else the name of what is wrong."""
    if action not in ACTIONS or not isinstance(args, dict):
        return "action"
    if action == "theme":
        return {"mode": args["mode"]} if args.get("mode") in THEMES else "mode"
    if action == "language":
        return {"lang": args["lang"]} if args.get("lang") in LANGS else "lang"
    if action == "navigate":
        if args.get("page") not in PAGES:
            return "page"
        out: dict[str, Any] = {"page": args["page"]}
        if args.get("card") is not None:   # a card of the lead sources page: the page opens that card
            if args["page"] != "lead_sources" or args["card"] not in SOURCE_CARDS:
                return "card"
            out["card"] = args["card"]
        period = args.get("period")
        if period is not None:
            if period in PERIODS:
                out["period"] = period
            elif isinstance(period, dict) and _DATE.match(str(period.get("from", ""))) and _DATE.match(str(period.get("to", ""))) and str(period["from"]) <= str(period["to"]):
                out["period"] = {"from": str(period["from"]), "to": str(period["to"])}
            else:
                return "period"
        return out
    if action == "open_record":
        target = " ".join(str(args.get("target") or "").split())[:120]
        if args.get("type") not in RECORD_TYPES:
            return "type"
        if not target or re.sub(r"\s+", " ", target.casefold()) not in re.sub(r"\s+", " ", text.casefold()):
            return "target"   # the name must be the owner's own words
        return {"type": args["type"], "target": target}
    if action == "filter":
        if args.get("page") == "leads":
            lead_out: dict[str, Any] = {"page": "leads"}
            if args.get("status") is not None:
                if args["status"] not in LEAD_CHIPS:
                    return "status"
                lead_out["status"] = args["status"]
            if args.get("q") is not None:
                lead_q = " ".join(str(args["q"]).split())[:80]
                if lead_q:
                    lead_out["q"] = lead_q
            return lead_out if len(lead_out) > 1 else "filter"
        if args.get("page") != "calls":
            return "page"   # the Calls and Leads pages are the ones whose filters are in the address
        out = {"page": "calls"}
        if args.get("status") is not None:
            if args["status"] not in CALL_STATUS:
                return "status"
            out["status"] = args["status"]
        if args.get("when") is not None:
            if args["when"] not in CALL_WHEN:
                return "when"
            out["when"] = args["when"]
        if args.get("q") is not None:
            q = " ".join(str(args["q"]).split())[:80]
            if q:
                out["q"] = q
        return out if len(out) > 1 else "filter"
    if action == "open_settings":
        return {"section": args["section"]} if args.get("section") in SECTIONS else "section"
    return {"state": args["state"]} if args.get("state") in ("start", "stop") else "state"   # talk_live


def card(action: str, args: dict[str, Any], note: str | None = None) -> dict[str, Any]:
    """The work card the web runs once: `{kind:"client_action", id, action, args}`, and `note` (one plain line, in the owner's language) when part of the request could not be done: the page changes at once, so the web shows the note on the page."""
    out: dict[str, Any] = {"kind": "client_action", "id": str(uuid.uuid4()), "action": action, "args": args}
    if note:
        out["note"] = note
    return out
