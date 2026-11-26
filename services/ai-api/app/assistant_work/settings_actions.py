"""The settings the assistant can change from the chat, one table (owner, 14 Nov 2026: "the assistant does everything the website can do"; docs-private/plans/assistant-tool-coverage.md, slice G).

Each entry names the screen's own routes (a read tool and the write tool, both in the tool catalogue), the fields the owner may change by words, and each field's rule. The model only PICKS the setting and
the fields from the owner's words; CODE checks every value: its type, its range or its closed list, and that a name, a number or a sentence is really in what the owner said. The step is built from the
state read through the screen's own route (a PUT keeps the fields the owner did not mention), the card says old -> new in code's words, and Undo puts the state back (the route's own snapshot undo).
The routes keep their role and second-factor rules; nothing here writes by itself."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

Kind = Literal["int", "bool", "text", "choice"]


@dataclass(frozen=True)
class Field:
    kind: Kind
    low: int = 0
    high: int = 0
    choices: tuple[Any, ...] = ()
    pattern: str = ""
    min_len: int = 1
    max_len: int = 200
    label: str = ""
    allow_empty: bool = False   # "remove it" is a change too: null is accepted when the owner's words say so (REMOVE_WORDS)


@dataclass(frozen=True)
class Setting:
    label: str
    get: str                       # the read tool
    put: str                       # the write tool
    fields: dict[str, Field]
    method: Literal["PUT", "PATCH"]
    wrapper: str | None = None     # the read answer holds the settings under this key
    keep: tuple[str, ...] = ()     # a PUT needs these fields too: taken from what is saved now
    fixed: dict[str, Any] = field(default_factory=dict)   # always sent as is (a null the route wants)
    second_factor: bool = True
    sensitive: str | None = None


CALL_FIELDS = ("retry_busy", "retry_no_answer", "retry_call_later", "concurrent_calls", "detect_voicemail", "voicemail_action", "detect_phone_menu", "phone_menu_action", "silence_timeout_seconds",
               "max_call_seconds", "interruption_sensitivity", "listening_sounds", "pronunciations", "keywords", "hours", "holidays", "max_calls_per_customer_per_week", "auto_pause_refusals_per_hour",
               "contact_memory", "handover", "allowed_purposes")
SETTINGS: dict[str, Setting] = {
    "call_limit": Setting(
        "Calls per day", "tasks.call_limit", "tasks.set_call_limit", {"limit": Field("int", 1, 5000, label="calls per day")}, "PUT",
        second_factor=False,   # owner decision 14 Nov 2026: no authenticator code in the shop app for the call limit
    ),
    "outbox": Setting(
        "Message limits", "outbox.get_settings", "outbox.put_settings",
        {"auto_send_enabled": Field("bool", label="send automatically"), "per_customer_daily_limit": Field("int", 1, 20, label="messages per customer a day"),
         "quiet_hours_start": Field("int", 19, 23, label="quiet hours start (hour)"), "quiet_hours_end": Field("int", 7, 10, label="quiet hours end (hour)")},
        "PUT", keep=("auto_send_enabled", "per_customer_daily_limit", "quiet_hours_start", "quiet_hours_end"), sensitive="sending",
    ),
    "opening_line": Setting(
        "The opening line of calls", "ai-assistant.get_opening", "ai-assistant.put_opening",
        {"text": Field("text", min_len=10, max_len=300, label="the sentence"), "language": Field("choice", choices=("en", "te", "hi", "kn", "ta", "ml", "mr"), label="its language")},
        "PUT", keep=("language",), fixed={"campaign_id": None},
    ),
    "call_behaviour": Setting(
        "How calls behave", "call-settings.get_settings", "call-settings.put_settings",
        {"concurrent_calls": Field("int", 1, 20, label="calls at the same time"), "detect_voicemail": Field("bool", label="detect voicemail"),
         "voicemail_action": Field("choice", choices=("hang_up", "leave_message", "retry_later"), label="when voicemail answers"),
         "silence_timeout_seconds": Field("int", 3, 30, label="seconds of silence before it speaks again"), "max_call_seconds": Field("int", 30, 1800, label="longest call (seconds)"),
         "interruption_sensitivity": Field("choice", choices=("low", "medium", "high"), label="how easily it stops when interrupted"), "listening_sounds": Field("bool", label="listening sounds"),
         "max_calls_per_customer_per_week": Field("int", 1, 14, label="calls per customer a week"), "contact_memory": Field("bool", label="remember the person between calls")},
        "PUT", wrapper="settings", keep=CALL_FIELDS,
    ),
    "lead_finder": Setting(
        "Lead Finder limits", "lead-finder.get_settings", "lead-finder.put_settings",
        {"fit_bar": Field("int", 50, 100, label="how well a business must fit (percent)"), "daily_call_cap": Field("int", 0, 500, label="qualifying calls a day"),
         "call_from_hour": Field("int", 10, 20, label="calls start (hour)"), "call_to_hour": Field("int", 10, 21, label="calls end (hour)"),
         "searches_per_day": Field("int", 1, 20, label="searches a day"), "results_per_search": Field("int", 1, 20, label="results per search")},
        "PUT", keep=("fit_bar", "daily_call_cap", "call_from_hour", "call_to_hour", "searches_per_day", "results_per_search"),
    ),
    "call_follow_up": Setting(
        "Follow-up calls", "outreach.get_policy", "outreach.put_policy",
        {"max_attempts": Field("int", 1, 6, label="call attempts a customer gets"), "retry_gap_hours": Field("int", 1, 48, label="hours between attempts"),
         "then_whatsapp": Field("bool", label="send a WhatsApp after the last missed call")},
        "PUT",   # PolicyIn takes only the fields sent (the rest stay as saved); the route needs the Owner's second factor
    ),
    "call_speed": Setting(
        "First call to new leads", "outreach.list_rules", "outreach.save_rule",
        {"within_minutes": Field("int", 0, 120, label="minutes until the first call"), "source": Field("text", min_len=2, max_len=40, pattern=r"^[A-Za-z0-9 ._-]{2,40}$", label="lead source")},
        "PUT", sensitive="sending",   # changes the EXISTING standing rule of that source (the route needs the Owner's second factor); `source` only says which one
    ),
    "assistant_voice": Setting(
        "The assistant's voice", "ai-assistant.get_voices", "ai-assistant.put_voices",
        {"language": Field("choice", choices=("en", "te", "hi", "kn"), label="language"),
         "voice": Field("text", min_len=2, max_len=40, pattern=r"^[A-Za-z0-9 _-]{2,40}$", label="voice")},
        "PUT", second_factor=False,   # (owner, 26 Nov 2026) "change your voice to Ramya": a plan card (routed._assistant_voice); the screen's own route PUT /ai-assistant/voices takes {language, voice_id} (Owner or Admin, no second factor), Undo puts the voice back
    ),
    "assistant_name": Setting(
        "The assistant's name", "ai-assistant.get_name", "ai-assistant.put_name",
        {"name": Field("text", min_len=1, max_len=24, pattern=r"^[^<>{}@/\\|]+$", label="The assistant's name", allow_empty=True)},
        "PUT", second_factor=False,   # cosmetic: no authenticator code in the shop app (owner decision 14 Nov 2026)
    ),
    "business_profile": Setting(
        "Business details", "workspace.get_business", "workspace.patch_business",
        {"name": Field("text", min_len=1, max_len=120, label="business name"), "city": Field("text", min_len=2, max_len=80, label="city"),
         "phone": Field("text", pattern=r"^\+?[0-9 ()-]{6,20}$", min_len=6, max_len=20, label="phone"), "address_line": Field("text", min_len=3, max_len=160, label="address"),
         "area": Field("text", min_len=2, max_len=80, label="area"), "pincode": Field("text", pattern=r"^[1-9][0-9]{5}$", min_len=6, max_len=6, label="pincode")},
        "PATCH",
    ),
    "visit_settings": Setting(
        "Visit booking", "visits.get_settings", "visits.put_settings",
        {"slot_minutes": Field("choice", choices=(15, 20, 30, 45, 60, 90, 120), label="slot length (minutes)"), "max_parallel": Field("int", 1, 50, label="visits at the same time"),
         "buffer_minutes": Field("int", 0, 60, label="gap between visits (minutes)")},
        "PUT", keep=("weekly_hours", "slot_minutes", "max_parallel", "buffer_minutes", "closed_dates"),
    ),
}
NAMES = tuple(SETTINGS)

# the lead source an owner names -> the tag a standing rule is saved under (lead-sources-v2.md)
SOURCE_WORDS: tuple[tuple[str, str], ...] = (
    ("meta", "meta_lead_ads"), ("facebook", "meta_lead_ads"), ("instagram", "meta_lead_ads"), ("lead ads", "meta_lead_ads"), ("website", "website_form"), ("web site", "website_form"), ("form", "website_form"),
    ("indiamart", "indiamart"), ("india mart", "indiamart"), ("justdial", "justdial"), ("just dial", "justdial"), ("99acres", "99acres"), ("magicbricks", "magicbricks"), ("housing", "housing"),
    ("sheet", "google_sheet"), ("excel", "excel_upload"), ("webhook", "webhook"),
)


def source_tag(word: str) -> str | None:
    """The rule tag for a lead source as the owner said it ("Meta", "the website form"); None when it is not one we know."""
    flat = _flat(word)
    return next((tag for key, tag in SOURCE_WORDS if key in flat), None)


def prompt() -> str:
    """The lines of the router's prompt for the `setting` action: each setting, what it is, its fields with their limits."""
    lines = []
    for key, s in SETTINGS.items():
        fields = []
        for name, f in s.fields.items():
            rule = {"int": f"whole number {f.low} to {f.high}", "bool": "true or false", "text": f"text up to {f.max_len} characters" + (", or null to take it away (the app then says \"your assistant\")" if f.allow_empty else ""), "choice": "one of " + ", ".join(str(c) for c in f.choices)}[f.kind]
            fields.append(f"`{name}` ({f.label}: {rule})")
        lines.append(f"  {key}: {s.label}. Fields: " + "; ".join(fields) + ".")
    return "\n".join(lines)


# the owner's words for taking a value away ("remove your name", "no name", "without a name"): a null is accepted only with one of them in what they said
REMOVE_WORDS = re.compile(r"(remov|delet|clear|no name|without|drop|forget|reset|తీసేయ|తీసివేయ|వద్దు|हटा|मिटा|नहीं चाहिए|ತೆಗೆ|ಬೇಡ)", re.IGNORECASE)


def _in_words(value: str, text: str) -> bool:
    return bool(value) and _flat(value) in _flat(text)


def _flat(s: str) -> str:
    return re.sub(r"\s+", " ", s.casefold()).strip()


def check(setting: str, changes: dict[str, Any], text: str) -> dict[str, Any] | str:
    """The changes the owner's words support, checked field by field; or the name of what does not hold (the router then asks)."""
    spec = SETTINGS.get(setting)
    if spec is None or not isinstance(changes, dict) or not changes:
        return "setting"
    out: dict[str, Any] = {}
    for name, value in changes.items():
        f = spec.fields.get(name)
        if f is None:
            return name
        if f.kind == "bool":
            if not isinstance(value, bool):
                return name
            out[name] = value
        elif f.kind == "int":
            if isinstance(value, bool) or not isinstance(value, int) or not f.low <= value <= f.high or str(value) not in re.sub(r"[,\s]", "", text):
                return name   # a number must be in what the owner said (15, "fifteen" is asked again)
            out[name] = value
        elif f.kind == "choice":
            if value not in f.choices:
                return name
            if f.choices and isinstance(f.choices[0], int) and str(value) not in text:
                return name
            out[name] = value
        elif f.kind == "text" and f.allow_empty and (value is None or str(value).strip() == ""):
            if not REMOVE_WORDS.search(text):
                return name   # taking a name away needs the owner to say so
            out[name] = None
        else:
            clean = " ".join(str(value or "").split())
            if not f.min_len <= len(clean) <= f.max_len or (f.pattern and not re.fullmatch(f.pattern, clean)) or not _in_words(clean, text):
                return name   # a name, a city or a sentence must be the owner's own words
            out[name] = clean
    return out


def current_of(spec: Setting, answer: Any) -> dict[str, Any] | None:
    """The settings in force, from the read tool's answer."""
    if not isinstance(answer, dict):
        return None
    inner = answer.get(spec.wrapper) if spec.wrapper else None
    return inner if isinstance(inner, dict) else answer


def prepare(name: str, current: dict[str, Any], changes: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Settings whose read does not look like their write: the opening line is read as a list of lines but written as ONE line in ONE language (taken from the sentence's own script when the owner named
    none; the old sentence shown is the saved one for that language, not for a campaign). Returns (current, changes) in the shape of the write."""
    if name != "opening_line":
        return current, changes
    from app.assistant.language import detect_language

    text = str(changes.get("text") or "")
    language = str(changes.get("language") or detect_language(text))
    raw_lines = current.get("lines")
    lines: list[Any] = raw_lines if isinstance(raw_lines, list) else []
    old = next((str(x.get("text") or "") for x in lines if isinstance(x, dict) and x.get("language") == language and not x.get("campaign_id")), None)
    return {"language": language, "text": old}, {**changes, "language": language}


def body_for(spec: Setting, current: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    """What the write route is sent: for a PUT the fields it needs from what is saved now, plus the changes; for a PATCH only the changes."""
    if spec.method == "PATCH":
        return dict(changes)
    body = {k: current[k] for k in spec.keep if k in current}
    body.update(spec.fixed)
    body.update(changes)
    return body


def summary(spec: Setting, current: dict[str, Any], changes: dict[str, Any]) -> str:
    """"Calls per day: 100 -> 150" in code's words (one line per changed field, joined)."""
    parts = []
    for name, new in changes.items():
        label = spec.fields[name].label or name
        old = current.get(name)
        parts.append(f"{_show(old)} -> {_show(new)}" if len(changes) == 1 and label.casefold() == spec.label.casefold() else f"{label}: {_show(old)} -> {_show(new)}")
    return f"{spec.label}: " + "; ".join(parts)


def _show(value: Any) -> str:
    if value is None or value == "":
        return "not set"
    if isinstance(value, bool):
        return "on" if value else "off"
    return str(value)
