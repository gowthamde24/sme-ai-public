"""Our side of a push: the fields a business can map, the record built from an event, and the plain-words note. Nothing here reaches the network or logs a value."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

EVENTS = ("call.completed", "call.missed", "lead.created", "lead.updated", "job.outcome")
# our fields, in the order the mapping table shows them. `event` and `ref` are for tools that keep one row per event (a sheet, Airtable, Notion).
OUR_FIELDS = ("name", "phone", "email", "source", "outcome", "summary", "captured", "duration", "call_id")
ROW_FIELDS = (*OUR_FIELDS, "event", "ref")
NOTE = "@note"   # a mapping value: "put this in the note / activity text", not in a field of its own
SKIP = ""        # a mapping value: "do not send this"
_TARGET = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_ .:/()-]{0,59}")
MAX_VALUE = 2000


@dataclass(frozen=True)
class Record:
    """One event as a record for the other tool. Built from the database's event data (a call, a lead or an outcome and the lead's OWN contact). No transcript, no number of a third party."""

    event: str
    event_id: str
    name: str = ""
    phone: str = ""
    email: str = ""
    source: str = ""
    outcome: str = ""
    summary: str = ""
    captured: dict[str, str] = field(default_factory=dict)
    duration_s: int | None = None
    call_id: str = ""
    lead_id: str = ""
    sandbox: bool = False   # a test lead, a simulated or sandbox call: never pushed

    @property
    def is_call(self) -> bool:
        return self.event.startswith("call.") or self.event == "job.outcome"

    def value(self, key: str) -> str:
        """The text for one of our fields (empty when the event has none)."""
        if key == "captured":
            return "; ".join(f"{k}: {v}" for k, v in self.captured.items())
        if key == "duration":
            return "" if self.duration_s is None else str(self.duration_s)
        if key == "event":
            return self.event
        if key == "ref":
            return self.event_id
        return str(getattr(self, "call_id" if key == "call_id" else key, "") or "")[:MAX_VALUE]


def _text(raw: Any, limit: int = MAX_VALUE) -> str:
    if raw is None or isinstance(raw, bool | dict | list):
        return ""
    return " ".join(str(raw).split())[:limit]


def _captured(raw: Any) -> dict[str, str]:
    """What the assistant captured on the call (a few named answers), as short text. Anything not a plain value is left out."""
    out: dict[str, str] = {}
    if isinstance(raw, dict):
        for k, v in list(raw.items())[:20]:
            text = _text(v, 300)
            key = _text(k, 60)
            if key and text:
                out[key] = text
    return out


def _obj(raw: Any) -> dict[str, Any]:
    return raw if isinstance(raw, dict) else {}


def record_from(event: str, event_id: str, data: dict[str, Any]) -> Record:
    """From the claim's `data` (app.crm_data). A person's name, number and e-mail are the lead's OWN contact only."""
    lead = _obj(data.get("lead"))
    call = data.get("call") if isinstance(data.get("call"), dict) else None
    outcome = data.get("outcome") if isinstance(data.get("outcome"), dict) else None
    contact = lead
    flagged = False
    out_word, summary, call_id = "", "", ""
    duration: int | None = None
    captured: dict[str, str] = {}
    if call is not None:
        flagged = bool(call.get("simulated") or call.get("sandbox"))
        out_word = _text(call.get("outcome") or call.get("state"), 80)
        summary = _text(call.get("summary"))
        d = call.get("duration_seconds")
        duration = d if isinstance(d, int) and not isinstance(d, bool) and d >= 0 else None
        captured = _captured(call.get("captured"))
        call_id = _text(call.get("id"), 60)
    elif outcome is not None:
        out_word = _text(outcome.get("outcome") or outcome.get("category"), 80)
        summary = _text(outcome.get("reason"))
        call_id = _text(outcome.get("source_id"), 60)
    elif isinstance(lead.get("contact"), dict):   # a lead event: data.lead = {..., contact: {...}}
        contact = lead["contact"]
        flagged = bool(lead.get("is_test"))
    return Record(event=event, event_id=event_id, name=_text(contact.get("name"), 120), phone=_text(contact.get("phone"), 30), email=_text(contact.get("email"), 160),
                  source=_text(data.get("source") or lead.get("source"), 80), outcome=out_word, summary=summary, captured=captured, duration_s=duration,
                  call_id=call_id, lead_id=_text(data.get("lead_id"), 60), sandbox=flagged)


def sample_record() -> Record:
    """The record the 'Test connection' button describes in words (never sent to a customer's tool as a real person)."""
    return Record(event="call.completed", event_id="evt_sample", name="Asha Reddy", phone="+919800000000", email="asha@example.com", source="My website", outcome="interested",
                  summary="Asked about the 2 BHK; wants a visit on Saturday.", captured={"Budget": "45 lakh"}, duration_s=130, call_id="call_sample", lead_id="lead_sample")


def split_name(full: str) -> tuple[str, str]:
    parts = full.split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


def phone_digits(raw: str) -> str:
    return re.sub(r"\D", "", raw)


def phone_ten(raw: str) -> str:
    """The last ten digits (an Indian mobile number without +91 or 0): what most Indian CRMs match on."""
    digits = phone_digits(raw)
    return digits[-10:] if len(digits) >= 10 else digits


def duration_words(seconds: int | None) -> str:
    if seconds is None:
        return ""
    minutes, rest = divmod(seconds, 60)
    return f"{minutes} min {rest} s" if minutes else f"{rest} s"


_EVENT_WORDS = {"call.completed": "Call answered", "call.missed": "Call not answered", "lead.created": "New lead", "lead.updated": "Lead changed", "job.outcome": "Outcome recorded"}


def note_text(rec: Record, mapping: dict[str, str]) -> str:
    """The note or activity text: the event, then each of our fields the business mapped to the note. The reference at the end is the event's id (a retry never makes a second note in the tools that can be searched)."""
    lines = [f"Stack19: {_EVENT_WORDS.get(rec.event, rec.event)}"]
    labels = {"outcome": "Result", "summary": "Summary", "captured": "Details", "duration": "Duration", "call_id": "Call", "source": "Source", "name": "Name", "phone": "Phone", "email": "Email"}
    for key in OUR_FIELDS:
        if mapping.get(key) != NOTE:
            continue
        text = rec.value(key)
        if key == "duration":
            text = duration_words(rec.duration_s)
        if text:
            lines.append(f"{labels[key]}: {text}")
    lines.append(f"Ref: {rec.event_id}")
    return "\n".join(lines)


def has_note(rec: Record, mapping: dict[str, str]) -> bool:
    """Is there anything to write in a note? A lead event has none; a call or an outcome has when at least one field is mapped to the note and has a value."""
    if not rec.is_call:
        return False
    return any(mapping.get(k) == NOTE and rec.value(k) for k in OUR_FIELDS) or rec.event == "call.missed"


def clean_mapping(raw: Any, allowed: tuple[str, ...]) -> dict[str, str] | None:
    """The mapping the business sent: our field -> a field name of the tool, or '@note', or '' (skip). None when it is not shaped so (an unknown field of ours, a name with odd characters)."""
    if not isinstance(raw, dict) or len(raw) > 20:
        return None
    out: dict[str, str] = {}
    for k, v in raw.items():
        if k not in allowed or not isinstance(v, str):
            return None
        value = v.strip()
        if value not in (NOTE, SKIP) and not _TARGET.fullmatch(value):
            return None
        out[k] = value
    return out


def mapped_fields(rec: Record, mapping: dict[str, str], *, keys: tuple[str, ...] = OUR_FIELDS) -> dict[str, str]:
    """{the tool's field name: value} for every field mapped to a field (not the note), when it has a value. If two of ours go to one field the values are joined."""
    out: dict[str, str] = {}
    for key in keys:
        target = mapping.get(key, SKIP)
        if target in (SKIP, NOTE):
            continue
        text = rec.value(key)
        if text:
            out[target] = f"{out[target]} | {text}" if target in out else text
    return out


def dumps(obj: Any) -> bytes:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
