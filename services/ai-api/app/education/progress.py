"""Marks and progress messages to parents (job DM, owner decision 25 Oct 2026): FIXED TEMPLATES filled from the school's own records, NEVER written, rewritten, summarised, translated or even read by a model.

Why: these messages NAME THE CHILD and carry the child's marks. Children's data is the most protected data we hold (DPDP; ADR 0084 part 5), so the words are fixed, reviewed once, and the only variable parts are
values a person at the school supplied from the school's records: the child's first name, the subject, the marks, the maximum, the term. This module imports nothing that talks to a model, a speech engine or the
network (a test reads its imports), no module of the assistant, the agents or the voice-note path imports it (a test reads theirs), and the assistant has no tool that can reach it (a test reads the tool names).

Nothing is stored here: marks are not kept by the platform (education/models.py: never stored). The values come at send time from a file the school uploads and sees before approving (job DP part 2,
app/marksmessages, ADR 0096): it is read in memory for one request and never stored; only a send log (guardian, time, template id, status) is kept. The wording of the three languages is a first draft for native review."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml")
KINDS = ("marks", "report_ready")
# kind -> the merge fields it needs, in the order the screen asks for them
FIELDS: dict[str, tuple[str, ...]] = {
    "marks": ("student", "subject", "marks", "out_of", "term"),
    "report_ready": ("student", "term"),
}
TEMPLATES: dict[str, dict[str, str]] = {
    "marks": {
        "en": "{student} scored {marks} out of {out_of} in {subject} ({term}). - {school}",
        "te": "{student} {term}లో {subject}లో {out_of}కి {marks} మార్కులు సాధించారు. - {school}",
        "hi": "{student} ने {term} में {subject} में {out_of} में से {marks} अंक प्राप्त किए। - {school}",
        "kn": "{student} {term}ದಲ್ಲಿ {subject}ದಲ್ಲಿ {out_of}ಕ್ಕೆ {marks} ಅಂಕಗಳನ್ನು ಪಡೆದಿದ್ದಾರೆ. - {school}",
        "ta": "{student} {term} தேர்வில் {subject} பாடத்தில் {out_of}க்கு {marks} மதிப்பெண்கள் பெற்றார். - {school}",
        "ml": "{student} {term} ൽ {subject} ൽ {out_of} ൽ {marks} മാർക്ക് നേടി. - {school}",
    },
    "report_ready": {
        "en": "{student}'s progress report for {term} is ready. Please collect it from the school. - {school}",
        "te": "{student} యొక్క {term} ప్రోగ్రెస్ రిపోర్ట్ సిద్ధంగా ఉంది. దయచేసి పాఠశాలలో తీసుకోండి. - {school}",
        "hi": "{student} की {term} की प्रोग्रेस रिपोर्ट तैयार है। कृपया स्कूल से ले लें। - {school}",
        "kn": "{student} ಅವರ {term} ಪ್ರೋಗ್ರೆಸ್ ರಿಪೋರ್ಟ್ ಸಿದ್ಧವಾಗಿದೆ. ದಯವಿಟ್ಟು ಶಾಲೆಯಲ್ಲಿ ಪಡೆಯಿರಿ. - {school}",
        "ta": "{student} இன் {term} முன்னேற்ற அறிக்கை தயாராக உள்ளது. தயவுசெய்து பள்ளியில் பெற்றுக்கொள்ளவும். - {school}",
        "ml": "{student} ന്റെ {term} പ്രോഗ്രസ് റിപ്പോർട്ട് തയ്യാറാണ്. ദയവായി സ്കൂളിൽ നിന്ന് വാങ്ങുക. - {school}",
    },
}
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
# a name or a short word of the school's records: letters, marks, digits, space, dot, apostrophe, hyphen, brackets; no markup, braces, links or e-mail
_WORD = re.compile(r"^[^\W_][\w .'’()\-]*$", re.UNICODE)
_NUMBER = re.compile(r"^\d{1,3}(\.\d{1,2})?$")
LIMITS = {"student": 60, "subject": 40, "term": 30, "school": 80}


class ProgressMessageError(ValueError):
    """The values do not make a safe message (the message is not made)."""


@dataclass(frozen=True)
class ProgressMessage:
    kind: str
    language: str
    text: str


def _word(name: str, value: object) -> str:
    if not isinstance(value, str):
        raise ProgressMessageError(f"{name} must be text")
    cleaned = unicodedata.normalize("NFC", value).strip()
    if not cleaned or len(cleaned) > LIMITS[name] or not _WORD.match(cleaned) or any(unicodedata.category(c).startswith("C") for c in cleaned):
        raise ProgressMessageError(f"{name} is empty, too long or has characters a message must not carry")
    return cleaned


def _number(name: str, value: object) -> Decimal:
    text = str(value).strip() if isinstance(value, (int, float, str, Decimal)) and not isinstance(value, bool) else ""
    if not _NUMBER.match(text):
        raise ProgressMessageError(f"{name} must be a number of at most three digits")
    try:
        return Decimal(text)
    except InvalidOperation:  # pragma: no cover - the pattern already guarantees a number
        raise ProgressMessageError(f"{name} must be a number") from None


def _show(number: Decimal) -> str:
    return format(number.normalize(), "f") if number != number.to_integral() else str(int(number))


def render(kind: str, language: str, school: str, fields: dict[str, object]) -> ProgressMessage:
    """The message for one child. Pure: the same values give the same words; no model, no network, no storage."""
    if kind not in TEMPLATES or language not in LANGUAGES:
        raise ProgressMessageError("unknown message or language")
    wanted = set(FIELDS[kind])
    if set(fields) != wanted:
        raise ProgressMessageError(f"{kind} needs exactly {sorted(wanted)}")
    values: dict[str, str] = {"school": _word("school", school)}
    for name in FIELDS[kind]:
        if name in ("marks", "out_of"):
            continue
        values[name] = _word(name, fields[name])
    if kind == "marks":
        marks, out_of = _number("marks", fields["marks"]), _number("out_of", fields["out_of"])
        if out_of <= 0 or marks > out_of:
            raise ProgressMessageError("marks cannot be above the maximum")
        values["marks"], values["out_of"] = _show(marks), _show(out_of)
    text = TEMPLATES[kind][language]
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)   # plain replacement: a value with braces stays text
    return ProgressMessage(kind=kind, language=language, text=text)
