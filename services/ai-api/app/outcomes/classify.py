"""What a customer's WhatsApp reply says about the follow-up (job DM, C1 part): a cautious word list, NOT a model.

Only a clear signal gives a suggestion; anything else gives None and no outcome is recorded (the owner or the AI assistant can still record one). The words are a first draft written without a native reader,
the same caveat as `app/whatsapp/optout.py`: a person who reads each language should check them. A wrong guess is cheap: the owner sees every outcome on the customer's timeline and can correct it. The reason
is a FIXED sentence per category, never the customer's own words (so no customer text, and no child's name, can end up in an outcome)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.whatsapp import optout

_PUNCT = re.compile(r"[\s\.,!?;:'\"()\[\]{}\-_*/\\|~`^]+")


def _norm(text: str) -> str:
    return _PUNCT.sub(" ", unicodedata.normalize("NFKC", text).casefold()).strip()


@dataclass(frozen=True)
class Suggestion:
    outcome: str
    category: str
    reason: str


REASONS = {
    "interested": "Showed interest or asked for details.",
    "order_likely": "Said they will place an order.",
    "not_interested": "Said they are not interested.",
    "wrong_number": "Said it is the wrong number.",
    "too_costly": "Said the price is too high.",
    "call_back_later": "Asked to be contacted later.",
}
STOP_REASON = "Asked us to stop messaging."
OUTCOME_OF = {
    "interested": "positive", "order_likely": "positive",
    "not_interested": "negative", "wrong_number": "negative", "too_costly": "negative",
    "call_back_later": "unclear",
}
# the order of the words in each language: English, Hindi, Telugu, Kannada, and Hindi/Telugu/Kannada written in English letters
WORDS: dict[str, tuple[str, ...]] = {
    "wrong_number": (
        "wrong number", "wrong no", "galat number", "ghalat number", "rong number",
        "गलत नंबर", "रॉन्ग नंबर", "रांग नंबर", "తప్పు నంబర్", "తప్పు నెంబర్", "తప్పు నంబరు", "ತಪ್ಪು ನಂಬರ್", "ತಪ್ಪು ನಂಬರು",
    ),
    "not_interested": (
        "not interested", "no thanks", "no thank you", "dont call", "don t call", "do not call", "not needed", "no need", "not required", "nahi chahiye", "interest nahi", "interest ledu", "agatyam ledu",
        "रुचि नहीं", "नहीं चाहिए", "ज़रूरत नहीं", "जरूरत नहीं", "ఆసక్తి లేదు", "అవసరం లేదు", "ఇంట్రస్ట్ లేదు", "ಆಸಕ್ತಿ ಇಲ್ಲ", "ಬೇಕಿಲ್ಲ", "ಅಗತ್ಯವಿಲ್ಲ",
    ),
    "too_costly": (
        "too costly", "too expensive", "very expensive", "very costly", "costly", "expensive", "bahut mehnga", "bahut costly", "chala costly", "chala kharidu",
        "बहुत महंगा", "बहुत महँगा", "महंगा", "చాలా ఖరీదు", "ఖరీదు ఎక్కువ", "చాలా ఎక్కువ", "ತುಂಬಾ ದುಬಾರಿ", "ದುಬಾರಿ",
    ),
    "call_back_later": (
        "call later", "call me later", "call tomorrow", "call me tomorrow", "busy now", "i am busy", "im busy", "message later", "later", "baad mein", "kal call", "tarvata", "repu call",
        "बाद में", "कल कॉल", "कल फोन", "తర్వాత", "రేపు కాల్", "రేపు ఫోన్", "ನಂತರ", "ನಾಳೆ ಕರೆ",
    ),
    "order_likely": (
        "i will order", "will order", "place order", "place an order", "confirm the order", "confirm order", "book it", "order karunga", "order chestanu",
        "ऑर्डर करूँगा", "ऑर्डर करूंगा", "ఆర్డర్ చేస్తాను", "ఆర్డర్ చేస్తా", "ಆರ್ಡರ್ ಮಾಡುತ್ತೇನೆ",
    ),
    "interested": (
        "interested", "send photos", "send photo", "send pics", "send catalogue", "send catalog", "send price", "price list", "what is the price", "what s the price", "how much", "tell me more", "more details",
        "yes please", "haan bhejo", "photo bhejo", "fotos pampandi", "photos pampandi", "dhara enta",
        "रुचि है", "फोटो भेजो", "फ़ोटो भेजो", "कीमत क्या", "कितने का", "ఆసక్తి ఉంది", "ఫోటోలు పంపండి", "ఫోటోలు పంపు", "ధర ఎంత", "ಆಸಕ್ತಿ ಇದೆ", "ಫೋಟೋ ಕಳುಹಿಸಿ", "ಬೆಲೆ ಎಷ್ಟು",
    ),
}


def _present(text: str, phrases: tuple[str, ...]) -> tuple[bool, str]:
    """(whether any phrase is in the text, the text with those phrases taken out). Latin phrases need word edges; Indic phrases are matched as substrings (their word edges are not reliable in a regex)."""
    found = False
    rest = text
    for raw in phrases:
        phrase = _norm(raw)
        if phrase.isascii():
            pattern = re.compile(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])")
            if pattern.search(rest):
                found = True
                rest = pattern.sub(" ", rest)
        elif phrase in rest:
            found = True
            rest = rest.replace(phrase, " ")
    return found, rest


def classify_reply(text: str | None) -> Suggestion | None:
    """The suggestion for one customer reply, or None when nothing is clear (or when the signals disagree)."""
    if not text or len(text) > 600:
        return None
    if optout.is_optout(text):
        return Suggestion("negative", "not_interested", STOP_REASON)
    rest = _norm(text)
    hits: list[str] = []
    for category in ("wrong_number", "not_interested", "too_costly", "call_back_later", "order_likely", "interested"):
        found, rest = _present(rest, WORDS[category])   # a phrase taken out cannot be read again as a smaller one ("not interested" is not "interested")
        if found:
            hits.append(category)
    if not hits:
        return None
    negatives = [h for h in hits if OUTCOME_OF[h] == "negative"]
    positives = [h for h in hits if OUTCOME_OF[h] == "positive"]
    if negatives and positives:
        return None   # they disagree: a person should read it
    pick = (negatives or positives or hits)[0]
    return Suggestion(OUTCOME_OF[pick], pick, REASONS[pick])
