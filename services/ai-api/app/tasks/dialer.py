"""Placing a call, behind an interface (job DR B1). Telephony does not exist yet, so the only dialer is FAKE: it places no call and sends nothing anywhere; it produces a deterministic, clearly SIMULATED conversation and result (marked `simulated`) from the plan, so the whole engine (approval, cap, progress, report) can be built and tried. A real dialer replaces it behind this interface and must keep the contract: the call opens with the AI disclosure, asks the plan's questions, says nothing outside the plan and the approved facts, and returns the outcome and the captured answers.

Languages: the assistant's lines are drafts for native review (everyday spoken style, English nouns kept in English); the contact's synthetic replies are short."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.visits.texts import WEEKDAYS

AI_MARK = re.compile(r"\bAI\b|ఏఐ|एआई|ಎಐ|ஏஐ|എഐ")

OPENERS: dict[str, str] = {
    "en": "Hello, I'm Vijaya, {business}'s AI assistant. Is this a good time to talk?",
    "te": "నమస్కారం అండీ, నేను విజయ, {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "hi": "नमस्ते जी, मैं विजया, {business} से AI assistant बोल रही हूँ। एक minute बात कर सकते हैं?",
    "kn": "ನಮಸ್ಕಾರ ರೀ, ನಾನು ವಿಜಯ, {business} ನಿಂದ AI assistant ಮಾತಾಡ್ತಿದ್ದೀನಿ. ಒಂದು minute ಮಾತಾಡಬಹುದಾ?",
    "ta": "வணக்கம்ங்க, நான் விஜயா, {business} ல இருந்து AI assistant பேசுறேன். ஒரு நிமிஷம் பேசலாமா?",
    "ml": "നമസ്കാരം, ഞാൻ വിജയ, {business} ൽ നിന്ന് AI assistant ആണ്. ഒരു minute സംസാരിക്കാമോ?",
}
YES: dict[str, str] = {"en": "Yes, go ahead.", "te": "అవునండీ, చెప్పండి.", "hi": "हाँ जी, बोलिए।", "kn": "ಹೌದು ರೀ, ಹೇಳಿ.", "ta": "ஆமாங்க, சொல்லுங்க.", "ml": "അതെ, പറയൂ."}
NOT_INTERESTED: dict[str, str] = {"en": "No, I'm not interested.", "te": "వద్దండీ, interest లేదు.", "hi": "नहीं जी, interest नहीं है।", "kn": "ಬೇಡ ರೀ, interest ಇಲ್ಲ.", "ta": "வேண்டாங்க, interest இல்ல.", "ml": "വേണ്ട, interest ഇല്ല."}
WRONG_NUMBER: dict[str, str] = {"en": "Sorry, wrong number.", "te": "Sorry అండీ, wrong number.", "hi": "Sorry जी, wrong number है।", "kn": "Sorry ರೀ, wrong number.", "ta": "Sorry ங்க, wrong number.", "ml": "Sorry, wrong number."}
LATER: dict[str, str] = {"en": "Please call me later.", "te": "తర్వాత call చేయండి అండీ.", "hi": "बाद में call कीजिए जी।", "kn": "ಆಮೇಲೆ call ಮಾಡಿ ರೀ.", "ta": "அப்புறம் call பண்ணுங்க.", "ml": "പിന്നീട് call ചെയ്യൂ."}
CLOSE: dict[str, str] = {"en": "Thank you, I've noted that down.", "te": "సరేనండీ, note చేసుకున్నాను. Thank you!", "hi": "ठीक है जी, note कर लिया। Thank you!", "kn": "ಸರಿ ರೀ, note ಮಾಡ್ಕೊಂಡೆ. Thank you!", "ta": "சரிங்க, note பண்ணிக்கிட்டேன். Thank you!", "ml": "ശരി, note ചെയ്തു. Thank you!"}
SORRY_CLOSE: dict[str, str] = {"en": "Understood, sorry to disturb you. Thank you!", "te": "అర్థమైందండీ, disturb చేసినందుకు sorry. Thank you!", "hi": "समझ गई जी, disturb करने के लिए sorry। Thank you!", "kn": "ಅರ್ಥ ಆಯ್ತು ರೀ, disturb ಮಾಡಿದ್ದಕ್ಕೆ sorry. Thank you!", "ta": "புரியுதுங்க, disturb பண்ணதுக்கு sorry. Thank you!", "ml": "മനസ്സിലായി, disturb ചെയ്തതിൽ sorry. Thank you!"}
YES_WORD: dict[str, str] = {"en": "Yes", "te": "అవును", "hi": "हाँ", "kn": "ಹೌದು", "ta": "ஆமா", "ml": "അതെ"}
NO_WORD: dict[str, str] = {"en": "No", "te": "లేదు", "hi": "नहीं", "kn": "ಇಲ್ಲ", "ta": "இல்ல", "ml": "ഇല്ല"}


@dataclass(frozen=True)
class CallResult:
    outcome: str                       # positive | negative | unclear | no_answer
    category: str | None
    captured: dict[str, Any]
    transcript: list[dict[str, str]]
    minutes: int
    simulated: bool = True
    recording_ref: str | None = None


class Dialer(Protocol):
    name: str

    def call(self, *, business: str, language: str, questions: list[dict[str, Any]], template: str, seed: str) -> CallResult: ...


def has_ai_disclosure(line: str) -> bool:
    return bool(AI_MARK.search(line))


def _h(seed: str) -> int:
    return int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16)


def _answer(question: dict[str, Any], language: str, h: int, positive: bool) -> tuple[Any, str]:
    """(the captured value, how the contact says it). Amounts are paise; a date is a weekday of the language."""
    kind = question.get("type")
    if kind == "amount":
        paise = 35000 + 500 * ((h >> 4) % 12)
        return paise, f"₹{paise // 100}"
    if kind == "date":
        day = WEEKDAYS[language][(h >> 8) % 6]
        return day, day
    if kind == "yesno":
        value = positive
        return value, (YES_WORD if value else NO_WORD)[language]
    return "details given on the call (simulated)", "…"


@dataclass
class FakeDialer:
    """Deterministic: the same seed (task and contact) gives the same call. No network, no sound."""

    name: str = "fake"
    calls: list[str] = field(default_factory=list)

    def call(self, *, business: str, language: str, questions: list[dict[str, Any]], template: str, seed: str) -> CallResult:
        self.calls.append(seed)
        h = _h(seed)
        bucket = h % 10
        if template == "supplier_price_enquiry":
            bucket = 0 if bucket <= 8 else 8   # suppliers answer; one in ten does not
        opener = OPENERS[language].format(business=business)
        if bucket >= 8:
            return CallResult("no_answer", None, {}, [], 1)
        lines = [{"who": "assistant", "text": opener}]
        if bucket == 7:
            lines += [{"who": "contact", "text": WRONG_NUMBER[language]}, {"who": "assistant", "text": SORRY_CLOSE[language]}]
            return CallResult("negative", "wrong_number", {}, lines, 1)
        if bucket == 6:
            lines += [{"who": "contact", "text": NOT_INTERESTED[language]}, {"who": "assistant", "text": SORRY_CLOSE[language]}]
            return CallResult("negative", "not_interested", {}, lines, 1)
        if bucket == 5:
            lines += [{"who": "contact", "text": LATER[language]}, {"who": "assistant", "text": CLOSE[language]}]
            return CallResult("unclear", "call_back_later", {}, lines, 1)
        lines.append({"who": "contact", "text": YES[language]})
        captured: dict[str, Any] = {}
        for index, question in enumerate(questions):
            value, spoken = _answer(question, language, h >> index, positive=True)
            captured[question["key"]] = value
            lines += [{"who": "assistant", "text": question["text"]}, {"who": "contact", "text": spoken}]
        lines.append({"who": "assistant", "text": CLOSE[language]})
        category = "visit_booked" if bucket == 4 else "interested"
        return CallResult("positive", category, captured, lines, 1 + (len(questions) + 1) // 2)
