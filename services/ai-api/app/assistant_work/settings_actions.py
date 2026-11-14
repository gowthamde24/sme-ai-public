"""The settings the assistant can change from the chat, one table (owner, 14 Nov 2026: "the assistant does everything the website can do"; docs/plans/assistant-tool-coverage.md, slice G).

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


def prompt() -> str:
    """The lines of the router's prompt for the `setting` action: each setting, what it is, its fields with their limits."""
    lines = []
    for key, s in SETTINGS.items():
        fields = []
        for name, f in s.fields.items():
            rule = {"int": f"whole number {f.low} to {f.high}", "bool": "true or false", "text": f"text up to {f.max_len} characters", "choice": "one of " + ", ".join(str(c) for c in f.choices)}[f.kind]
            fields.append(f"`{name}` ({f.label}: {rule})")
        lines.append(f"  {key}: {s.label}. Fields: " + "; ".join(fields) + ".")
    return "\n".join(lines)


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
