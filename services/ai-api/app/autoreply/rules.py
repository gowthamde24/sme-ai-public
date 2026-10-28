"""The standing rules of the automatic WhatsApp reply (job DY, the owner's decision "approve once, not per message"), in CODE and never decided by a model:

  1. a customer's message is answered once, within 24 hours (the database hands out only those: workspace/auto_reply.sql);
  2. a PRICE, a DISCOUNT or a PROMISE waits for the Owner: the outbox flags it (money, commitment) and holds it; when the customer ASKS about a price or a discount the reply is held too, so the Owner decides what is said;
  3. HAND OVER: when the customer asks for a person, or the model is unsure, or its answer fails a check, the reply is held for the Owner (the outbox's `uncertain`).

Pure text rules for English, Telugu, Hindi and Kannada (the languages of the product). Nothing here reads a network or a key."""

from __future__ import annotations

import re

# the customer asks for a person: "talk to the owner", "call me", "manager", "human", in the four languages and their Latin-letter spellings
_PERSON = re.compile(
    r"(\b(talk|speak|connect|call)\b[^.?!]{0,30}\b(owner|manager|person|human|someone|sir|madam|boss)\b|\b(owner|manager|human|real person|boss)\b|\bcall me\b|\bphone me\b|"
    r"ఓనర్|మేనేజర్|మనిషి|మాట్లాడాలి|కాల్ చేయండి|ఫోన్ చేయండి|"
    r"मालिक|ओनर|मैनेजर|इंसान|बात करनी|बात करना है|कॉल करो|फोन करो|"
    r"ಮಾಲೀಕ|ಓನರ್|ಮ್ಯಾನೇಜರ್|ವ್ಯಕ್ತಿ|ಮಾತನಾಡ|ಕಾಲ್ ಮಾಡಿ)",
    re.IGNORECASE,
)
# the customer asks about money: a price, a rate, a discount, an offer, an advance
_MONEY = re.compile(
    r"(\b(price|prices|rate|rates|cost|how much|discount|offer|best price|final price|advance|emi|quotation|quote|charges?|fees?)\b|[₹]|\brs\.?\s?\d|"
    r"ధర|రేటు|ఎంత|డిస్కౌంట్|ఆఫర్|ఫీజు|"
    r"कीमत|दाम|रेट|कितना|कितने|डिस्काउंट|ऑफर|फीस|"
    r"ಬೆಲೆ|ರೇಟ್|ಎಷ್ಟು|ರಿಯಾಯಿತಿ|ಆಫರ್|ಶುಲ್ಕ)",
    re.IGNORECASE,
)
# the customer is upset: a person answers
_COMPLAINT = re.compile(r"(\b(complaint|complain|cheated|fraud|refund|angry|worst|terrible|useless|legal|police|consumer court)\b|మోసం|ఫిర్యాదు|धोखा|शिकायत|ಮೋಸ|ದೂರು)", re.IGNORECASE)

MIN_CONFIDENCE = 0.6
MAX_REPLY_CHARS = 600


def asks_for_a_person(text: str) -> bool:
    return bool(_PERSON.search(text))


def asks_about_money(text: str) -> bool:
    return bool(_MONEY.search(text))


def is_a_complaint(text: str) -> bool:
    return bool(_COMPLAINT.search(text))


def must_hand_over(text: str, *, confidence: float, model_wants_person: bool) -> str | None:
    """None when the assistant may answer on its own; otherwise the reason it hands over to the Owner (a closed word, logged as a count, never the customer's words)."""
    if asks_for_a_person(text) or model_wants_person:
        return "asked_for_a_person"
    if asks_about_money(text):
        return "asked_about_money"
    if is_a_complaint(text):
        return "complaint"
    if confidence < MIN_CONFIDENCE:
        return "unsure"
    return None
