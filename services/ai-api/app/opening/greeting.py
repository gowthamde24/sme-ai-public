"""Does the greeting say "I'm the AI assistant"? (owner decision of 20 Nov 2026, reversed by the lawyer's written opinion of 25 Nov 2026; contract docs/contracts/greeting-disclosure.md)

A SETTING of the business, DEFAULT ON: the greeting says it is the business's AI assistant. Switching it OFF is possible only after the Owner has accepted the written undertaking (never claim to be a person, say so when asked, calls without the mention are logged), stored in the document as `ai_off_undertaking` (date and who; written by the server only, see app/talk_training/repository.py); an "off" without it is read as ON. Before 26 Nov 2026 the default was OFF: the greeting was the name only ("Namaste, I'm Priya from Sri Sai Homes"). A job may override it (`business` follows the business, `on`, `off`; the Jobs setting catalogue comes with S2: until then
`resolve_greeting_disclosure(business_setting, job_override)` is the one place that decides). It is stored in the Talk training document (`say_ai_when_greeting`, like `background`), so it needs no table.

What is NOT a setting, in every mode, in every language: a customer who asks whether they are talking to a person, a robot or an AI gets the truthful answer that this is the business's AI assistant, never a claim to be human
(app/opening/honesty.py: the rule is in every prompt, and the question is detected by code, so it never depends on the model). The outbound gate (`no_ai_disclosure`) follows the resolved value: required when ON, not required when OFF.

Pure: no network, no database."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Mapping

from app.opening.render import _OPENERS

JOB_OVERRIDES = ("business", "on", "off")
DEFAULT = True
UNDERTAKING_KEY = "ai_off_undertaking"
UNDERTAKING_VERSION = "2026-11"
# the jobs that speak to a customer (docs/contracts/jobs-detail.md): each may override the business setting; their words are the Talk training document's `say_ai_by_job`
JOB_KINDS = ("speed_to_lead", "answer_calls", "followups", "store_visits", "offers")
# which job a Lead Desk task call belongs to, by the task's template (a template not listed is no job's: the business setting applies)
JOB_OF_TASK_TEMPLATE = {"call_new_leads": "speed_to_lead", "reengage_old_leads": "followups", "confirm_appointments": "store_visits", "offer_invite": "offers"}
# which job an outbox message belongs to, by its category (the database function app.outbox_mention_ai(tenant, category) says the same)
JOB_OF_OUTBOX_CATEGORY = {"followup": "followups", "visit": "store_visits"}

# the question that follows a plain greeting on a call WE place, per language (the words of the call openings of app/tasks/dialer.py)
ASK = {
    "en": "Is this a good time to talk?",
    "te": "ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "hi": "एक minute बात कर सकते हैं?",
    "kn": "ಒಂದು minute ಮಾತಾಡಬಹುದಾ?",
    "ta": "ஒரு நிமிஷம் பேசலாமா?",
    "ml": "ഒരു minute സംസാരിക്കാമോ?",
}


def has_undertaking(doc: Mapping[str, object] | None) -> bool:
    """The Owner accepted the written undertaking that allows the mention to be switched off (a stored date and who). Anything else is no undertaking."""
    u = doc.get(UNDERTAKING_KEY) if isinstance(doc, Mapping) else None
    return isinstance(u, Mapping) and bool(u.get("at")) and bool(u.get("by"))


def disclosure_off_in(doc: Mapping[str, object] | None) -> bool:
    """The document asks for the mention to be OFF somewhere (the business setting, or a job's own word)."""
    if not isinstance(doc, Mapping):
        return False
    by_job = doc.get("say_ai_by_job")
    return doc.get("say_ai_when_greeting") is False or (isinstance(by_job, Mapping) and any(v == "off" for v in by_job.values()))


def resolve_greeting_disclosure(business_setting: bool | None, job_override: str | None = None) -> bool:
    """True when the greeting must say it is an AI assistant: the job's `on` / `off`, else the business setting, else the default (ON). `business` and anything unknown follow the business setting."""
    if job_override == "on":
        return True
    if job_override == "off":
        return False
    return business_setting if isinstance(business_setting, bool) else DEFAULT


def setting_of(doc: Mapping[str, object] | None) -> bool | None:
    """The business's own choice from the Talk training document: True / False, or None when the owner never chose."""
    value = doc.get("say_ai_when_greeting") if isinstance(doc, Mapping) else None
    if value is False and not has_undertaking(doc):
        return None   # an "off" without the stored undertaking is read as not chosen: ON
    return value if isinstance(value, bool) else None


def job_word(doc: Mapping[str, object] | None, job: str | None) -> str | None:
    """The job's own word, `on` or `off`, from the Talk training document (`say_ai_by_job`); None when the job has none, is no job, or the document says anything else."""
    by_job = doc.get("say_ai_by_job") if isinstance(doc, Mapping) else None
    word = by_job.get(job) if isinstance(by_job, Mapping) and job in JOB_KINDS else None
    if word == "off" and not has_undertaking(doc):
        return None   # a job's "off" needs the undertaking too
    return word if word in ("on", "off") else None


def resolved_from(doc: Mapping[str, object] | None, job_override: str | None = None) -> bool:
    return resolve_greeting_disclosure(setting_of(doc), job_override)


def resolved_for_job(doc: Mapping[str, object] | None, job: str | None) -> bool:
    """THE value a call, a message and the job page's preview use for one job: the job's override, else the business setting, else the default (ON). `job` None (a call that belongs to no job) is the business setting."""
    return resolve_greeting_disclosure(setting_of(doc), job_word(doc, job))


def plain_outbound(language: str) -> str:
    """The greeting of a call WE place with no AI mention: the name only (the business), then the same question. {business} is left in for the caller to fill."""
    lang = language if language in ASK else "en"
    return f"{_OPENERS[lang]['plain']} {ASK[lang]}"


def from_repo(repo: object, token: str, tenant_id: object, job_override: str | None = None, job: str | None = None) -> bool:
    """The resolved value read from a Talk training repository (`get(token, tenant_id)` -> {"doc": ...}); the default (ON) when there is no repository or the read fails."""
    getter = getattr(repo, "get", None)
    if getter is None:
        return resolve_greeting_disclosure(None, job_override)
    try:
        row = getter(token, tenant_id)
    except Exception:   # noqa: BLE001 - an unreadable setting is the default: the AI mention ON
        return resolve_greeting_disclosure(None, job_override)
    doc = row.get("doc") if isinstance(row, dict) else None
    doc = doc if isinstance(doc, dict) else None
    return resolve_greeting_disclosure(setting_of(doc), job_override or job_word(doc, job))
