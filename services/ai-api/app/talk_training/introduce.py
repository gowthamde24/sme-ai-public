"""How the assistant introduces itself on a call (owner, 11 Nov 2026): "Introduce as", a per-workspace setting that sits next to the greeting in the Talk training document (no new column: the document is jsonb).

  business  (default)  "I am the AI assistant of {business}"
  owner                "I am {name}'s AI assistant"            (`text` = the owner's first name or name, letters only)
  custom               the Owner's own words, e.g. "Gowtham's AI assistant"   (`text`)

Rules, enforced here (the web form can show the same words): the phrase ALWAYS says "AI assistant" (in Latin letters or in the language's own script), in every tone; 8 to 60 characters; no digit of any script, no link or e-mail address, no brace,
and never the words human / person (or their equivalents in the product's languages), so it can never claim to be a person; it is never read from a call goal (only from this setting or from the Owner's own per-call choice on a test call).
Lead Desk calls to customers keep the business name until the owner says the lawyer agreed otherwise: `applies_to_task_calls` is False and the code that builds a task call's opening never reads this setting.
Telugu and English are the languages with a written-out introduction; every other language keeps the business form. Pure text: no network, no database."""

# ruff: noqa: E501

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

Kind = Literal["business", "owner", "custom"]
KINDS: tuple[str, ...] = ("business", "owner", "custom")
LANGUAGES = frozenset({"te", "en"})
applies_to_task_calls = False   # until the owner says the lawyer agreed

_AI_ASSISTANT = re.compile(r"\bAI\b[\s‌‍]{0,3}(?:assistant|అసిస్టెంట్|असिस्टेंट|ಅಸಿಸ್ಟೆಂಟ್|அசிஸ்டென்ட்|അസിസ്റ്റന്റ്|असिस्टंट)", re.IGNORECASE)
_PERSON = re.compile(r"\b(?:human|person|people|man|woman|boy|girl|real|live|someone)\b|మనిషి|ఆదమి|इंसान|व्यक्ति|आदमी|ಮನುಷ್ಯ|மனிதர்|மனிதன்|മനുഷ്യൻ", re.IGNORECASE)
_LINK = re.compile(r"https?:|www\.|://|@|\.(?:com|in|net|org|co)\b", re.IGNORECASE)
_NAME = re.compile(r"^[^\W\d_][\w .'\-‌‍]{0,38}[^\W\d_]$", re.UNICODE)


class IntroduceError(ValueError):
    """`reason` is a closed word: missing_text | too_short | too_long | no_ai_assistant | digit | link | brace | person_word | not_a_name | text_not_allowed | unknown_kind."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Introduce:
    kind: str = "business"
    text: str | None = None


def check(kind: str, text: str | None) -> Introduce:
    """The setting if it is valid, else an IntroduceError with a closed reason."""
    if kind not in KINDS:
        raise IntroduceError("unknown_kind")
    value = " ".join((text or "").split())
    if kind == "business":
        if value:
            raise IntroduceError("text_not_allowed")
        return Introduce("business", None)
    if not value:
        raise IntroduceError("missing_text")
    if any(unicodedata.category(c) == "Nd" for c in value):
        raise IntroduceError("digit")
    if _LINK.search(value):
        raise IntroduceError("link")
    if "{" in value or "}" in value:
        raise IntroduceError("brace")
    if _PERSON.search(value):
        raise IntroduceError("person_word")
    if kind == "owner":
        if not 2 <= len(value) <= 40:
            raise IntroduceError("too_short" if len(value) < 2 else "too_long")
        if not _NAME.match(value):
            raise IntroduceError("not_a_name")
        return Introduce("owner", value)
    if len(value) < 8:
        raise IntroduceError("too_short")
    if len(value) > 60:
        raise IntroduceError("too_long")
    if not _AI_ASSISTANT.search(value):
        raise IntroduceError("no_ai_assistant")
    return Introduce("custom", value)


def from_doc(raw: object) -> Introduce:
    """The setting out of a stored document (a dict {kind, text}); anything unreadable or invalid is the default (the business name), never a guess."""
    if not isinstance(raw, dict):
        return Introduce()
    try:
        return check(str(raw.get("kind") or "business"), raw.get("text") if isinstance(raw.get("text"), str) else None)
    except IntroduceError:
        return Introduce()


def phrase(language: str, intro: Introduce | None) -> str | None:
    """The sentence that introduces the assistant, for `language`, or None when the business form applies (the standard opener is used). It always contains "AI assistant"."""
    if intro is None or intro.kind == "business" or language not in LANGUAGES or not intro.text:
        return None
    if language == "te":
        if intro.kind == "owner":
            return f"నేను {intro.text} AI assistant ని."
        text = intro.text
        return f"నేను {text} ని." if re.search(r"(?:assistant|అసిస్టెంట్)$", text, re.IGNORECASE) else f"నేను {text}."
    if intro.kind == "owner":
        return f"this is {intro.text}'s AI assistant."
    return f"this is {intro.text}."
