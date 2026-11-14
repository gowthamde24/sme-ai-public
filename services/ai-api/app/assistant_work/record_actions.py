# ruff: noqa: E501
"""Actions on ONE named record (owner, 14 Nov 2026: book, move or cancel a visit; start, pause, resume or cancel a campaign; set a catalogue price; record consent or stop messaging; change a lead's status or
archive it). The model only says WHAT and to WHOM, in the owner's words; CODE does the rest: finds the record through the screen's own read route (a name in any script, the same spelling-tolerant match as
calls), refuses to guess (nobody found, or two equally good matches: ONE question), checks every value against the owner's words and the route's closed lists, builds the step, and shows the usual plan card
(old -> new, Undo where the route has one; sensitive ones need the Owner and the second tap)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from app.tasks import names as name_match

LEAD_STATUS = ("new", "in_review", "qualified", "disqualified")
ACTIONS = ("lead_status", "lead_edit", "lead_archive", "visit_book", "visit_move", "visit_cancel", "campaign_pause", "campaign_resume", "campaign_cancel", "campaign_approve", "price_set", "consent_record", "stop_messaging")
NEEDS_PERSON = ("lead_status", "lead_edit", "lead_archive", "visit_book", "visit_move", "visit_cancel", "consent_record", "stop_messaging")
# what the owner may change on a lead by words: the name (on the contact) and the lead's profile fields; where each one is written
PROFILE_FIELDS = {"city": "city", "interest": "need", "quantity": "quantity", "area": "area", "budget": "budget", "timeline": "timeline", "urgency": "urgency", "notes": "notes"}
LEAD_FIELDS = ("name", *PROFILE_FIELDS)
URGENCY = ("low", "normal", "high")
# acted at once, with "Done · Undo" (owner, 14 Nov 2026): everything that is easy to undo or safe; one confirm only for money and for sending to many
IMMEDIATE = ("lead_status", "lead_edit", "lead_archive", "visit_book", "visit_move", "visit_cancel", "campaign_pause", "campaign_cancel", "consent_record", "stop_messaging")
BIG_CAMPAIGN = 50   # a campaign to more than this many people needs the second tap (as calls do)
_WEEKDAYS = {
    0: ("monday", "mon", "సోమవారం", "सोमवार"), 1: ("tuesday", "tue", "మంగళవారం", "मंगलवार"), 2: ("wednesday", "wed", "బుధవారం", "बुधवार"), 3: ("thursday", "thu", "గురువారం", "गुरुवार"),
    4: ("friday", "fri", "శుక్రవారం", "शुक्रवार"), 5: ("saturday", "sat", "శనివారం", "शनिवार"), 6: ("sunday", "sun", "ఆదివారం", "रविवार"),
}
_RELATIVE = {0: ("today", "ఈరోజు", "ఈ రోజు", "आज"), 1: ("tomorrow", "రేపు", "कल"), 2: ("day after tomorrow", "ఎల్లుండి", "परसों")}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

PROMPT = (
    "- record: ONE action on ONE named record. `record_action` is one of: lead_status (`status`: new|in_review|qualified|disqualified), lead_edit (`fields`: an object with any of name, city, interest, notes (free text: what to remember about the person, added to what is there), quantity, area, budget, timeline, urgency (low|normal|high), each value exactly as the owner said it), lead_archive, visit_book / visit_move (`date` as YYYY-MM-DD and `time` as HH:MM, "
    "24-hour, exactly as the owner's words give them: a weekday, \"tomorrow\", a date; \"4 pm\" is 16:00), visit_cancel, campaign_pause / campaign_resume / campaign_cancel / campaign_approve (start an existing "
    "campaign), price_set (a catalogue item; `price` in rupees as a whole number), consent_record (`channel`: whatsapp|phone; the person agreed), stop_messaging (the person asked to stop). `target` is the "
    "person's, the campaign's or the item's name exactly as the owner said it. A request to START or CREATE a NEW campaign about something (\"start a campaign for the new silk collection\") is NOT this action: decide \"not_mine\" (the planner makes that plan)."
)


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text.casefold()).strip()


def day_supported(day: date, text: str, today: date) -> bool:
    """The owner's words give this date: a relative word ("tomorrow", "రేపు"), a weekday that IS this date's weekday and falls within the next two weeks, or the day number with its month name or slash."""
    low = _flat(text)
    for offset, words in _RELATIVE.items():
        if today + timedelta(days=offset) == day and any(w in low for w in words):
            return True
    if 0 <= (day - today).days <= 14 and any(w in low for w in _WEEKDAYS[day.weekday()]):
        return True
    months = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")
    month = months[day.month - 1]
    return bool(re.search(rf"\b0?{day.day}(st|nd|rd|th)?\s+(of\s+)?(?:{month}|{month[:3]})\b|\b(?:{month}|{month[:3]})\s+0?{day.day}\b|\b0?{day.day}[/-]0?{day.month}\b", low))


def check(action: str, args: dict[str, Any], text: str, today: date) -> dict[str, Any] | str:
    """The arguments the owner's words support, or the name of what to ask about."""
    if action not in ACTIONS:
        return "action"
    target = " ".join(str(args.get("target") or "").split())
    if not target or _flat(target) not in _flat(text):
        return "target"
    out: dict[str, Any] = {"target": target}
    if action == "lead_status":
        if args.get("status") not in LEAD_STATUS:
            return "status"
        out["status"] = args["status"]
    elif action in ("visit_book", "visit_move"):
        raw_date, raw_time = str(args.get("date") or ""), str(args.get("time") or "")
        if not _DATE.match(raw_date) or not _TIME.match(raw_time):
            return "when"
        try:
            day = date.fromisoformat(raw_date)
        except ValueError:
            return "when"
        if day < today or not day_supported(day, text, today):
            return "date"
        from app.assistant_work.router import _hour_in_words

        if _hour_in_words(raw_time, text) is None:
            return "time"
        out.update({"date": raw_date, "time": raw_time})
    elif action == "lead_edit":
        fields = args.get("fields")
        if not isinstance(fields, dict) or not fields or any(k not in LEAD_FIELDS for k in fields):
            return "fields"
        clean: dict[str, str] = {}
        for key, value in fields.items():
            text_value = " ".join(str(value or "").split())[: 2000 if key == "notes" else 160]
            if key == "urgency":
                if text_value not in URGENCY:
                    return "urgency"
            elif not text_value or _flat(text_value) not in _flat(text):
                return str(key)   # a value must be the owner's own words
            clean[key] = text_value
        out["fields"] = clean
    elif action == "price_set":
        price = args.get("price")
        if isinstance(price, bool) or not isinstance(price, int) or not 1 <= price <= 10_000_000 or str(price) not in re.sub(r"[,\s]", "", text):
            return "price"
        out["price"] = price
    elif action == "consent_record":
        if args.get("channel") not in ("whatsapp", "phone"):
            return "channel"
        out["channel"] = args["channel"]
    return out


def rank(asked: str, rows: list[dict[str, Any]], name_key: str) -> tuple[list[dict[str, Any]], bool]:
    """The best matches for a name among rows: (the rows that match best, whether one of them is clearly the best). Uses the same sound-based match as calls (Telugu and English spellings)."""
    scored = [(name_match.score(asked, str(r.get(name_key) or "")), r) for r in rows]
    scored = [x for x in scored if x[0] > 0]
    if not scored:
        return [], False
    best = max(s for s, _ in scored)
    top = [r for s, r in scored if s == best]
    return top, len(top) == 1


def kolkata_today(now: datetime | None = None) -> date:
    from datetime import UTC, timezone

    return (now or datetime.now(UTC)).astimezone(timezone(timedelta(hours=5, minutes=30))).date()


def local_hhmm(iso: object) -> str:
    """The clock time (India, 24-hour) of a stored instant such as "2026-11-21T04:30:00Z" (the visits routes WRITE local times and READ UTC ones)."""
    from datetime import UTC, timezone

    try:
        moment = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(timezone(timedelta(hours=5, minutes=30))).strftime("%H:%M")
