"""Is this message a request to stop? (job BR). WHOLE-message match only (after trimming, lower-casing and removing punctuation): "STOP" stops, "please stop by tomorrow" does not. English, Hindi,
Telugu and Kannada words, and the same words written in English letters. The lists are a first draft written without a native reader: a person who reads each language should check them (the same
caveat as the other language assets); a missed word costs nothing worse than the owner stopping the person by hand, a false match is prevented by the whole-message rule. Words that also mean a plain "no" (వద్దు, ಬೇಡ, "end", "cancel") are left out on purpose: a "no" to a question is not an opt-out.

An opt-out that is missed is the costly mistake, so the owner also sees every inbound message in the inbox and can stop a contact by hand (POST .../suppress is the existing CRM route)."""

from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[\s\.,!?;:'\"()\[\]{}\-_*/\\|~`^]+")

EN = {"stop", "stop all", "stop messages", "stop messaging", "stop sending", "unsubscribe", "opt out", "optout", "quit", "remove me", "do not message", "dont message", "dont send"}
HI = {"बंद", "बंद करो", "बंद कीजिए", "रोको", "रुको", "स्टॉप", "स्टाप", "मैसेज बंद करो", "संदेश बंद करो", "सदस्यता रद्द", "अनसब्सक्राइब"}
TE = {"ఆపండి", "ఆపు", "ఆపేయండి", "స్టాప్", "స్టాపు", "మెసేజ్ ఆపండి", "సందేశాలు ఆపండి", "అన్‌సబ్‌స్క్రైబ్"}
KN = {"ನಿಲ್ಲಿಸಿ", "ನಿಲ್ಲಿಸು", "ಸ್ಟಾಪ್", "ಮೆಸೇಜ್ ನಿಲ್ಲಿಸಿ", "ಸಂದೇಶ ನಿಲ್ಲಿಸಿ"}
TRANSLITERATED = {"band karo", "band kijiye", "ruko", "message band karo", "aapandi", "aapu", "message aapandi", "nillisi", "nillisu", "message nillisi"}


def _norm(text: str) -> str:
    return _PUNCT.sub(" ", unicodedata.normalize("NFKC", text).casefold()).strip()


PHRASES: frozenset[str] = frozenset(_norm(p) for p in EN | HI | TE | KN | TRANSLITERATED)


def is_optout(text: str | None) -> bool:
    return bool(text) and len(text or "") <= 60 and _norm(text or "") in PHRASES
