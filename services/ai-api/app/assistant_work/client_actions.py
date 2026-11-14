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
PAGES = ("today", "my_assistant", "calls", "chats", "leads", "campaigns", "reports", "catalogue", "phone_numbers", "billing", "settings", "outbox", "visits")
PERIODS = ("today", "14", "month")
CALL_STATUS = ("all", "completed", "transferred", "no_answer", "rejected", "spam", "live")
CALL_WHEN = ("any", "today", "7d", "30d")
SECTIONS = tuple("business profile plan members fields data language assistant activity agent leadfinder notifications limits security".split())   # (a split string: a list of literals tripped the guard that keeps plan ids out of code)
ACTIONS = ("theme", "language", "navigate", "filter", "open_settings", "talk_live")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

PROMPT = (
    "- client: something only the app's screen can do, asked as `client_action` + `client_args`: theme {mode: light|dark|system}; language {lang: en|te|hi|kn} (the APP's language); "
    "navigate {page: " + "|".join(PAGES) + "; period (only for reports): today|14|month, or {from, to} as YYYY-MM-DD}; filter {page: calls, status?: " + "|".join(CALL_STATUS) + ", when?: " + "|".join(CALL_WHEN)
    + ", q?: up to 80 characters}; open_settings {section: " + "|".join(SECTIONS) + "}; talk_live {state: start|stop}. Opening a particular person's chat or lead is NOT available yet: decide \"clarify\" and say so."
)


def check(action: str, args: dict[str, Any]) -> dict[str, Any] | str:
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
        period = args.get("period")
        if period is not None:
            if period in PERIODS:
                out["period"] = period
            elif isinstance(period, dict) and _DATE.match(str(period.get("from", ""))) and _DATE.match(str(period.get("to", ""))) and str(period["from"]) <= str(period["to"]):
                out["period"] = {"from": str(period["from"]), "to": str(period["to"])}
            else:
                return "period"
        return out
    if action == "filter":
        if args.get("page") != "calls":
            return "page"   # Calls is the only page whose filters are in the address today
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


def card(action: str, args: dict[str, Any]) -> dict[str, Any]:
    """The work card the web runs once: `{kind:"client_action", id, action, args}`."""
    return {"kind": "client_action", "id": str(uuid.uuid4()), "action": action, "args": args}
