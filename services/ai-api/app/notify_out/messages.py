"""What a notification says. The text is built here, in code, from closed phrases (English; Telugu, Hindi and Kannada are DRAFTS that wait for a native reader) and the closed fields the database returned
(`notify_event_data`: name, phone_masked, outcome and category, reason). Whatever the database returned is checked AGAIN before it goes into a sentence: a phone must have the masked shape (first three digits and
X's, or X's and the last four), a name or reason has e-mail addresses and runs of digits taken out, and anything else is dropped. A full number, an address, a transcript or an amount cannot get into a message
through this module."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Any

EVENTS = ("new_lead", "missed_call", "call_outcome", "low_balance")
FIELDS = ("name", "phone_masked", "outcome", "reason")
DEFAULT_FIELDS = ("name", "phone_masked", "outcome")
LANGUAGES = ("en", "te", "hi", "kn")

EVENT_WORDS = {
    "new_lead": "A new lead comes in.",
    "missed_call": "A call to your business number is missed.",
    "call_outcome": "A call ends and the assistant records what came of it.",
    "low_balance": "Your call balance runs low (once each time it does).",
}
FIELD_WORDS = {
    "name": "The person's name",
    "phone_masked": "Their phone number, first 3 digits only",
    "outcome": "What came of the call",
    "reason": "The reason the assistant wrote (it can repeat what the person said)",
}

_MASKED = re.compile(r"^(?:(?:\+91 )?[0-9]{3}X{4,9}|X{7}[0-9]{4})$")
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+")
_DIGITS = re.compile(r"[0-9][0-9 ()+.-]{3,}[0-9]")   # five or more digits in a row, with the usual separators
_CONTROL = re.compile(r"[\x00-\x1f\x7f​-‏  ‪-‮⁠﻿]")
CATEGORIES = ("interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "call_back_later", "already_bought")
OUTCOMES = ("positive", "negative", "unclear")

PHRASES: dict[str, dict[str, str]] = {
    "en": {
        "new_lead": "New lead", "missed_call": "Missed call", "call_outcome": "Call result", "unknown_caller": "Unknown caller",
        "low_balance": "Your call balance is low. Top up so calls do not stop.", "summary": "and {n} more new leads",
        "test": "Test message from Stack19. This channel is connected.",
        "interested": "Interested", "visit_booked": "Visit booked", "order_likely": "Order likely", "not_interested": "Not interested", "wrong_number": "Wrong number",
        "too_costly": "Too costly", "call_back_later": "Call back later", "already_bought": "Already bought", "positive": "Positive", "negative": "Negative", "unclear": "Unclear",
    },
    "te": {   # DRAFT, for the owner's review (spoken Telugu with English business words)
        "new_lead": "కొత్త లీడ్", "missed_call": "మిస్డ్ కాల్", "call_outcome": "కాల్ రిజల్ట్", "unknown_caller": "తెలియని నంబర్",
        "low_balance": "మీ కాల్ బ్యాలెన్స్ తక్కువగా ఉంది. కాల్స్ ఆగకుండా టాప్ అప్ చేయండి.", "summary": "ఇంకా {n} కొత్త లీడ్స్",
        "test": "Stack19 నుంచి టెస్ట్ మెసేజ్. ఈ ఛానల్ కనెక్ట్ అయింది.",
        "interested": "ఇంట్రెస్ట్ ఉంది", "visit_booked": "విజిట్ బుక్ అయింది", "order_likely": "ఆర్డర్ వచ్చే అవకాశం ఉంది", "not_interested": "ఇంట్రెస్ట్ లేదు", "wrong_number": "రాంగ్ నంబర్",
        "too_costly": "రేటు ఎక్కువ అన్నారు", "call_back_later": "తర్వాత కాల్ చేయమన్నారు", "already_bought": "ఇప్పటికే కొన్నారు", "positive": "పాజిటివ్", "negative": "నెగటివ్", "unclear": "క్లియర్ కాలేదు",
    },
    "hi": {   # DRAFT
        "new_lead": "नया लीड", "missed_call": "मिस्ड कॉल", "call_outcome": "कॉल का नतीजा", "unknown_caller": "अनजान नंबर",
        "low_balance": "आपका कॉल बैलेंस कम है। कॉल रुकें नहीं, इसलिए टॉप अप करें।", "summary": "और {n} नए लीड",
        "test": "Stack19 की तरफ़ से टेस्ट मैसेज। यह चैनल जुड़ गया है।",
        "interested": "इंटरेस्टेड", "visit_booked": "विज़िट बुक हुई", "order_likely": "ऑर्डर की संभावना", "not_interested": "इंटरेस्ट नहीं", "wrong_number": "गलत नंबर",
        "too_costly": "रेट ज़्यादा", "call_back_later": "बाद में कॉल करें", "already_bought": "पहले ही खरीद चुके", "positive": "पॉज़िटिव", "negative": "नेगेटिव", "unclear": "साफ़ नहीं",
    },
    "kn": {   # DRAFT
        "new_lead": "ಹೊಸ ಲೀಡ್", "missed_call": "ಮಿಸ್ಡ್ ಕಾಲ್", "call_outcome": "ಕಾಲ್ ರಿಸಲ್ಟ್", "unknown_caller": "ಗೊತ್ತಿಲ್ಲದ ನಂಬರ್",
        "low_balance": "ನಿಮ್ಮ ಕಾಲ್ ಬ್ಯಾಲೆನ್ಸ್ ಕಡಿಮೆ ಇದೆ. ಕಾಲ್‌ಗಳು ನಿಲ್ಲದಂತೆ ಟಾಪ್ ಅಪ್ ಮಾಡಿ.", "summary": "ಇನ್ನೂ {n} ಹೊಸ ಲೀಡ್‌ಗಳು",
        "test": "Stack19 ಕಡೆಯಿಂದ ಟೆಸ್ಟ್ ಮೆಸೇಜ್. ಈ ಚಾನಲ್ ಕನೆಕ್ಟ್ ಆಗಿದೆ.",
        "interested": "ಆಸಕ್ತಿ ಇದೆ", "visit_booked": "ವಿಸಿಟ್ ಬುಕ್ ಆಗಿದೆ", "order_likely": "ಆರ್ಡರ್ ಆಗುವ ಸಾಧ್ಯತೆ", "not_interested": "ಆಸಕ್ತಿ ಇಲ್ಲ", "wrong_number": "ತಪ್ಪು ನಂಬರ್",
        "too_costly": "ರೇಟ್ ಜಾಸ್ತಿ", "call_back_later": "ಆಮೇಲೆ ಕಾಲ್ ಮಾಡಿ", "already_bought": "ಈಗಾಗಲೇ ಖರೀದಿಸಿದ್ದಾರೆ", "positive": "ಪಾಸಿಟಿವ್", "negative": "ನೆಗೆಟಿವ್", "unclear": "ಸ್ಪಷ್ಟವಿಲ್ಲ",
    },
}


def scrub(text: object, limit: int) -> str | None:
    """A sentence or a name made safe for a message: no control or invisible characters, no e-mail address, no run of five digits or more, cut to `limit`."""
    if not isinstance(text, str):
        return None
    cleaned = _DIGITS.sub("", _EMAIL.sub("", _CONTROL.sub(" ", text)))
    cleaned = " ".join(cleaned.split())[:limit].strip()
    return cleaned or None


def safe_data(raw: object) -> dict[str, str]:
    """The closed fields of one event, each checked again. Anything that is not exactly one of them is dropped."""
    data = raw if isinstance(raw, dict) else {}
    out: dict[str, str] = {}
    name = scrub(data.get("name"), 60)
    if name:
        out["name"] = name
    phone = data.get("phone_masked")
    if isinstance(phone, str) and _MASKED.fullmatch(phone):
        out["phone_masked"] = phone
    if data.get("category") in CATEGORIES:
        out["category"] = str(data["category"])
    if data.get("outcome") in OUTCOMES:
        out["outcome"] = str(data["outcome"])
    reason = scrub(data.get("reason"), 140)
    if reason:
        out["reason"] = reason
    return out


def _words(language: str) -> dict[str, str]:
    return PHRASES.get(language, PHRASES["en"])


def build_text(event: str, data: object, language: str = "en", more: int = 0) -> str:
    """One message. Only the fields present in `data` appear; with none the text is the event's own words."""
    words = _words(language)
    if event == "low_balance":
        return words["low_balance"]
    if event == "new_lead_summary":
        return words["summary"].format(n=max(1, int(more)))
    clean = safe_data(data)
    head = words.get(event, words["new_lead"])
    pieces = [p for p in (clean.get("name"), clean.get("phone_masked")) if p]
    if event == "missed_call" and not clean.get("name") and clean.get("phone_masked"):
        pieces.insert(0, words["unknown_caller"])
    text = f"{head}: {', '.join(pieces)}" if pieces else head
    if event == "call_outcome":
        outcome = words.get(clean.get("category", ""), None) or words.get(clean.get("outcome", ""), None)
        if outcome:
            text += f" - {outcome}" if pieces else f": {outcome}"
        if clean.get("reason"):
            text += f" ({clean['reason']})"
    return text


def test_text(language: str = "en") -> str:
    return _words(language)["test"]


def slack_escape(text: str) -> str:
    """Slack reads &, < and > in a message as markup (a name could otherwise make a mention or a link)."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def teams_plain(text: str) -> str:
    """Teams cards read a little Markdown: its marks are taken out of what a person's name could carry."""
    return re.sub(r"[*_`\[\]()~#>|]", " ", text)


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}
