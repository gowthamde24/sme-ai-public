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
    "- record: ONE action on ONE named record. `record_action` is one of: lead_status (`status`: new|in_review|qualified|disqualified; \"contacted\", \"followed up\" or \"working on it\" is in_review), lead_edit (`fields`: an object with any of name, city, interest, notes (free text: what to remember about the person, added to what is there), quantity, area, budget, timeline, urgency (low|normal|high), each value exactly as the owner said it), lead_archive, visit_book / visit_move (`date` as YYYY-MM-DD and `time` as HH:MM, "
    "24-hour, exactly as the owner's words give them: a weekday, \"tomorrow\", a date; \"4 pm\" is 16:00), visit_cancel (`date` and `time` ONLY if the owner names the day or the time of the visit: they pick one of several visits), campaign_pause / campaign_resume / campaign_cancel / campaign_approve (start an existing "
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


def resolve_date(value: str, text: str, today: date) -> str:
    """The model often writes the date as the owner's word ("Saturday", "tomorrow", "21 Nov") although the prompt asks for YYYY-MM-DD (found 15 Nov from the refusal log: date_shape "aaaaaaaa"). The earliest day that BOTH the
    model's word and the owner's own words support; "Saturday" said on a Saturday is the next one. A date already written as YYYY-MM-DD is kept as it is."""
    if _DATE.match(value):
        return value
    low = _flat(value)
    if not low:
        return value
    for offset in range(0, 61):
        day = today + timedelta(days=offset)
        if offset == 0 and not any(w in low for w in _RELATIVE.get(0, ())):
            continue
        if day_supported(day, value, today) and day_supported(day, text, today):
            return day.isoformat()
    return value


def _norm_time(value: str) -> str:
    """"11", "11am", "11 AM", "4 pm", "16:30:00", "4.30 pm" -> "HH:MM" (24 hour); anything else is returned as it was (the caller then refuses it)."""
    m = re.fullmatch(r"\s*(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?\s*", value.lower())
    if not m:
        return value
    hour, minute, half = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if half == "p" and hour < 12:
        hour += 12
    elif half == "a" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}" if hour < 24 and minute < 60 else value


def _norm_date(value: str) -> str:
    """A full timestamp ("2026-11-21T00:00:00Z") -> "2026-11-21"."""
    return value[:10] if re.match(r"\d{4}-\d{2}-\d{2}[T ]", value) else value


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
        raw_date, raw_time = resolve_date(_norm_date(str(args.get("date") or "")), text, today), _norm_time(str(args.get("time") or ""))   # the model writes "11", "11 AM", "11:00:00" or a full timestamp as often as "11:00": the same moment, one shape
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
    elif action == "visit_cancel":   # the day and the time are only a way to pick ONE of several visits: kept when they are well formed, never an error
        picked_date, picked_time = resolve_date(_norm_date(str(args.get("date") or "")), text, today), _norm_time(str(args.get("time") or ""))
        if _DATE.match(picked_date):
            out["date"] = picked_date
        if _TIME.match(picked_time):
            out["time"] = picked_time
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


DETAIL_SEP = " · "


def split_target(asked: str) -> tuple[str, list[str]]:
    """"Usha Murthy · Hyderabad · 11 Nov" (what a choose button sends back) -> ("Usha Murthy", ["hyderabad", "11 nov"])."""
    name, *details = [p.strip() for p in asked.split("·")]
    return name, [d.lower() for d in details if d]


def details_of(row: dict[str, Any], name_key: str) -> list[str]:
    """What tells two people of the same name apart: the city, where the lead came from, the day it arrived (all from the list the screen reads)."""
    profile = row.get("profile") if isinstance(row.get("profile"), dict) else {}
    city = str((profile or {}).get("city") or row.get("city") or "").strip()
    source = str(row.get("source") or row.get("source_tag") or "").replace("_", " ").strip()
    when = ""
    created = str(row.get("created_at") or "")
    if len(created) >= 10:
        try:
            when = datetime.fromisoformat(created[:10]).strftime("%-d %b")
        except ValueError:
            when = ""
    return [x for x in (city, source, when) if x]


def choice_labels(rows: list[dict[str, Any]], name_key: str) -> list[str]:
    """One label per candidate, never two the same: "Usha Murthy · Hyderabad · 11 Nov" (a number is added only when the details do not separate them)."""
    labels = [DETAIL_SEP.join([str(r.get(name_key) or ""), *details_of(r, name_key)]) for r in rows]
    seen: dict[str, int] = {}
    out = []
    for label in labels:
        seen[label] = seen.get(label, 0) + 1
        out.append(label if labels.count(label) == 1 else f"{label}{DETAIL_SEP}{seen[label]}")
    return out


def narrow(rows: list[dict[str, Any]], details: list[str], name_key: str) -> list[dict[str, Any]]:
    """Of several people with one name, the ones the owner's extra words point at (their city, source or day); all of them when the words point at none."""
    if not details:
        return rows
    kept = [r for r in rows if any(d in " | ".join(x.lower() for x in details_of(r, name_key)) for d in details)]
    return kept or rows


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
