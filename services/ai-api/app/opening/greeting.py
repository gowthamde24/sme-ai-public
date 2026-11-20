"""Does the greeting say "I'm the AI assistant"? (owner decision of 20 Nov 2026; contract docs/contracts/greeting-disclosure.md)

A SETTING of the business, DEFAULT OFF: the greeting is the name only ("Namaste, I'm Priya from Sri Sai Homes"). A job may override it (`business` follows the business, `on`, `off`; the Jobs setting catalogue comes with S2: until then
`resolve_greeting_disclosure(business_setting, job_override)` is the one place that decides). It is stored in the Talk training document (`say_ai_when_greeting`, like `background`), so it needs no table.

What is NOT a setting, in every mode, in every language: a customer who asks whether they are talking to a person, a robot or an AI gets the truthful answer that this is the business's AI assistant, never a claim to be human
(app/opening/honesty.py: the rule is in every prompt, and the question is detected by code, so it never depends on the model). The outbound gate (`no_ai_disclosure`) follows the resolved value: required when ON, not required when OFF.

Pure: no network, no database."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Mapping

from app.opening.render import _OPENERS

JOB_OVERRIDES = ("business", "on", "off")
DEFAULT = False

# the question that follows a plain greeting on a call WE place, per language (the words of the call openings of app/tasks/dialer.py)
ASK = {
    "en": "Is this a good time to talk?",
    "te": "ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "hi": "एक minute बात कर सकते हैं?",
    "kn": "ಒಂದು minute ಮಾತಾಡಬಹುದಾ?",
    "ta": "ஒரு நிமிஷம் பேசலாமா?",
    "ml": "ഒരു minute സംസാരിക്കാമോ?",
}


def resolve_greeting_disclosure(business_setting: bool | None, job_override: str | None = None) -> bool:
    """True when the greeting must say it is an AI assistant: the job's `on` / `off`, else the business setting, else the default (OFF). `business` and anything unknown follow the business setting."""
    if job_override == "on":
        return True
    if job_override == "off":
        return False
    return business_setting if isinstance(business_setting, bool) else DEFAULT


def setting_of(doc: Mapping[str, object] | None) -> bool | None:
    """The business's own choice from the Talk training document: True / False, or None when the owner never chose."""
    value = doc.get("say_ai_when_greeting") if isinstance(doc, Mapping) else None
    return value if isinstance(value, bool) else None


def resolved_from(doc: Mapping[str, object] | None, job_override: str | None = None) -> bool:
    return resolve_greeting_disclosure(setting_of(doc), job_override)


def plain_outbound(language: str) -> str:
    """The greeting of a call WE place with no AI mention: the name only (the business), then the same question. {business} is left in for the caller to fill."""
    lang = language if language in ASK else "en"
    return f"{_OPENERS[lang]['plain']} {ASK[lang]}"


def from_repo(repo: object, token: str, tenant_id: object, job_override: str | None = None) -> bool:
    """The resolved value read from a Talk training repository (`get(token, tenant_id)` -> {"doc": ...}); the default (OFF) when there is no repository or the read fails."""
    getter = getattr(repo, "get", None)
    if getter is None:
        return resolve_greeting_disclosure(None, job_override)
    try:
        row = getter(token, tenant_id)
    except Exception:   # noqa: BLE001 - an unreadable setting is the default: the name only
        return resolve_greeting_disclosure(None, job_override)
    doc = row.get("doc") if isinstance(row, dict) else None
    return resolved_from(doc if isinstance(doc, dict) else None, job_override)
