"""The standing rules of the automatic WhatsApp reply (job DY, the owner's decision "approve once, not per message"), in CODE and never decided by a model:

  1. a customer's message is answered once, within 24 hours (the database hands out only those: workspace/auto_reply.sql);
  2. a PRICE, a DISCOUNT or a PROMISE waits for the Owner: the outbox flags it (money, commitment) and holds it; when the customer ASKS about a price or a discount the reply is held too, so the Owner decides what is said;
  3. HAND OVER: when the customer asks for a person, or the model is unsure, or its answer fails a check, the reply is held for the Owner (the outbox's `uncertain`).

Pure text rules for English, Telugu, Hindi and Kannada (the languages of the product). Nothing here reads a network or a key."""

from __future__ import annotations

import re
from datetime import date, timedelta

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


# ---------------------------------------------------------------------------------------------------------------------------------
# chat promises (owner, 16 Nov 2026): a reply that says "I will check / let you know / send" is a promise the shop must keep. These are CODE rules (a model may also flag a promise; either one counts).
# Every expression is bounded (no nested or open-ended repeats).
# ---------------------------------------------------------------------------------------------------------------------------------
_PROMISE = re.compile(
    r"(\blet\s{1,3}me\s{1,3}(?:check|confirm|find out|ask|send|get back)\b|\b(?:i|we|owner|shop|team|manager)\b[^.?!]{0,25}\b(?:will|shall|'ll)\b[^.?!]{0,25}\b(?:check|confirm|let you know|get back|find out|send|share|update|revert|call|reply|inform|tell you|ask|pass|forward|relay|note)\b|"
    r"\b(?:pass|passing|forward|forwarding|hand|handing)\s{1,3}(?:it|this|that|your\s{1,3}\w{3,20}|the\s{1,3}\w{3,20}|them|these)?\s{0,3}(?:on\s{1,3})?(?:to|over to)\s{1,3}(?:the\s{1,3})?(?:team|owner|manager|staff|shop)\b|"
    r"\b(?:the\s{1,3})?(?:team|owner|manager|staff|someone|somebody|they)\s{1,3}(?:will|shall|'ll)\s{1,3}(?:reply|respond|get back|contact|call|reach|confirm|let you know|message|write|share|send)\b|"
    r"\b(?:team|owner|vaaru|vaallu)\b[^.?!]{0,40}\b(?:chestanu|chestaam|chestam|chestaru|cheptanu|cheptaam|chepthanu|cheptaru|istaaru|istaru|istanu|pampistaam|pampistanu|pampistaru|pampistamu)\b|"
    r"\b(?:pass\s{1,3}chestanu|pass\s{1,3}chestaam|pampistaam|pampistanu|cheptanu|cheptaam|chepthanu|istaaru|batayenge|bataunga|bataenge|bhejenge|bhejunga|batadenge|pass\s{1,3}karunga|pass\s{1,3}karenge|check\s{1,3}karke)\b|"
    r"టీమ్ ?కి[^.?!]{0,30}(?:చెప్|పంపి|తెలియ|పాస్)|"
    r"\b(?:will|shall)\s{1,3}(?:be\s{1,3})?(?:reply|reach out|get back|call you|confirm|let you know|inform you|update you)\b|"
    r"చెప్తాం|చెబుతాం|చెప్తాను|చెప్తారు|చెబుతారు|తెలియజేస్తారు|తెలుపుతారు|తెలియజేస్తాం|తెలియజేస్తాను|తెలుపుతాం|చూసి చెప్|చెక్ చేసి|పంపుతాం|పంపిస్తాం|కన్ఫర్మ్ చేస్తాం|రిప్లై ఇస్తారు|రిప్లై ఇస్తాం|కాల్ చేస్తాం|"
    r"बताएंगे|बताएँगे|बता देंगे|बता दूंगा|बताऊंगा|चेक करके|पता करके|भेजेंगे|भेज देंगे|वापस आएंगे|जवाब देंगे|कन्फर्म करेंगे|संपर्क करेंगे|कॉल करेंगे|"
    r"ತಿಳಿಸುತ್ತೇವೆ|ತಿಳಿಸುತ್ತೇನೆ|ತಿಳಿಸುತ್ತಾರೆ|ಹೇಳುತ್ತಾರೆ|ಹೇಳುತ್ತೇವೆ|ಚೆಕ್ ಮಾಡಿ|ಕಳುಹಿಸುತ್ತೇವೆ|ಖಚಿತಪಡಿಸುತ್ತೇವೆ|ಉತ್ತರಿಸುತ್ತೇವೆ|ಉತ್ತರಿಸುತ್ತಾರೆ|ಕರೆ ಮಾಡುತ್ತೇವೆ)",
    re.IGNORECASE,
)
_PRICEWORD = re.compile(r"\b(?:price|prices|rate|rates|cost|how much|charges?|quote|quotation)\b|ధర|రేటు|ఎంత|कीमत|दाम|रेट|कितना|ಬೆಲೆ|ರೇಟ್|ಎಷ್ಟು", re.IGNORECASE)


def promises_follow_up(text: str) -> bool:
    """Does this reply promise that someone will check, confirm, send or call back?"""
    return bool(_PROMISE.search(text))


def is_about_price(*texts: str) -> bool:
    """The promise is about a price: the customer asked about money or the reply speaks of a price."""
    return any(_PRICEWORD.search(t) or asks_about_money(t) for t in texts)


_WEEKDAYS = (
    ("monday", "mon", "సోమవారం", "सोमवार", "ಸೋಮವಾರ"),
    ("tuesday", "tue", "మంగళవారం", "मंगलवार", "ಮಂಗಳವಾರ"),
    ("wednesday", "wed", "బుధవారం", "बुधवार", "ಬುಧವಾರ"),
    ("thursday", "thu", "గురువారం", "गुरुवार|बृहस्पतिवार", "ಗುರುವಾರ"),
    ("friday", "fri", "శుక్రవారం", "शुक्रवार", "ಶುಕ್ರವಾರ"),
    ("saturday", "sat", "శనివారం", "शनिवार", "ಶನಿವಾರ"),
    ("sunday", "sun", "ఆదివారం", "रविवार", "ಭಾನುವಾರ"),
)
_WEEKDAY_FULL = [re.compile(rf"\b(?:{d[0]})\b|{'|'.join(d[2:])}", re.IGNORECASE) for d in _WEEKDAYS]
_WEEKDAY_SHORT = [re.compile(rf"\b(?:by|on|for|before|till|until)\s{{1,3}}{d[1]}\b", re.IGNORECASE) for d in _WEEKDAYS]
_TODAY = re.compile(r"\b(?:today|tonight)\b|ఈ రోజు|ఇవాళ|आज|ಇಂದು", re.IGNORECASE)
_TOMORROW = re.compile(r"\b(?:tomorrow|tmrw|tomorow)\b|రేపు|ನಾಳೆ", re.IGNORECASE)
_AFTER_TOMORROW = re.compile(r"\bday\s{1,3}after\s{1,3}tomorrow\b|ఎల్లుండి|परसों|ನಾಡಿದ್ದು", re.IGNORECASE)
_NEXT_WEEK = re.compile(r"\bnext\s{1,3}week\b|వచ్చే వారం|అగ్లే|अगले हफ्ते|अगले सप्ताह|ಮುಂದಿನ ವಾರ", re.IGNORECASE)
_THIS_WEEKEND = re.compile(r"\bthis\s{1,3}weekend\b|\bweekend\b", re.IGNORECASE)
_THIS_WEEK = re.compile(r"\bthis\s{1,3}week\b|ఈ వారం|इस हफ्ते|इस सप्ताह|ಈ ವಾರ", re.IGNORECASE)
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_DAY_MONTH = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s{0,3}(?:of\s{1,3})?(" + "|".join(_MONTHS) + r")[a-z]{0,6}\b", re.IGNORECASE)


def needed_by_of(text: str, today: date) -> date | None:
    """The day the customer said they need it by ("for Sunday", "by Friday", "tomorrow", "25 Nov"), as a date from `today` (India time). A weekday is its next occurrence, today included. None when no day is named."""
    if _AFTER_TOMORROW.search(text):
        return today + timedelta(days=2)
    if _TOMORROW.search(text):
        return today + timedelta(days=1)
    for index in range(7):
        if _WEEKDAY_FULL[index].search(text) or _WEEKDAY_SHORT[index].search(text):
            return today + timedelta(days=(index - today.weekday()) % 7)
    if _NEXT_WEEK.search(text):
        return today + timedelta(days=7)
    if _THIS_WEEKEND.search(text):
        return today + timedelta(days=(5 - today.weekday()) % 7)
    if _THIS_WEEK.search(text):
        return today + timedelta(days=6 - today.weekday())
    found = _DAY_MONTH.search(text)
    if found:
        day, month = int(found.group(1)), _MONTHS.index(found.group(2).lower()[:3]) + 1
        for year in (today.year, today.year + 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                return None
            if candidate >= today:
                return candidate
    if _TODAY.search(text):
        return today
    return None


_LEAD_IN = re.compile(
    r"^(?:(?:hi|hello|hey|namaste|namaskaram|dear\s{1,3}sir)\b[\s,!.]{0,4})?(?:(?:do|did|can|could|will)\s{1,3}you\s{1,3}(?:have|show|send|share|give|tell)|(?:i|we)\s{1,3}(?:need|want|am looking for|are looking for|would like|am interested in)|"
    r"(?:please\s{1,3})?(?:show|send|share|tell)\s{1,3}me|looking\s{1,3}for|need|want|is\s{1,3}there|are\s{1,3}there|what(?:'s|\s{1,3}is)\s{1,3}the\s{1,3}(?:price|rate|cost)\s{1,3}(?:of|for)|(?:price|rate|cost)\s{1,3}(?:of|for)|how\s{1,3}much\s{1,3}(?:is|are|for))\b[\s,:-]{0,3}",
    re.IGNORECASE,
)
_TAIL = re.compile(r"\s{1,3}(?:(?:for|of|around|about)\s{1,3})?\d.{0,300}$|\bin\s{1,3}stock\b.{0,300}$|\b(?:please|pls|plz|price|prices|rate|rates|cost|details|available|availability|for\s{1,3}(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tomorrow)|by\s{1,3}\w{3,9}|for\s{1,3}(?:a|an|the|my|our)|asap|urgent)\b.*$|[?!.].*$", re.IGNORECASE)
_STOP_WORDS = frozenset(
    "a an the any some all new old more other another this that these those it its them one ones thing things item items stuff product products what whats which who whom how when where why is are was were be been do does did have has had can could will would "
    "you your yours me my mine we our us i am to of for in on at by with and or if so then there here about regarding available availability stock details detail info information price prices rate rates cost costs quote please pls plz kindly hi hello hey ok okay yes no need want like looking".split()
)
_PRODUCT_CONTROL = re.compile(r"[\u0000-\u001f\u007f]")


_BEFORE_PRICE = re.compile(r"^(?:(?:hi|hello|hey|namaste|namaskaram)\b[\s,!.]{0,4})?([^.?!\n]{3,60}?)\s{1,3}(?:price|prices|rate|rates|cost|available|availability|details)\b", re.IGNORECASE)
_NOT_A_PRODUCT = re.compile(
    r"^(?:hi|hello|hey|ok|okay|yes|no|thanks|thank you|please|pls|it|this|that|these|those|them|one|ones|something|anything|everything|today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|^\d"
    r"|\b(?:today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b",
    re.IGNORECASE,
)


def product_of(text: str) -> str | None:
    """A short guess of the product the customer asks about, from their own words, when the model gave none: what follows "do you have / I need / price of", or what comes before "price / rate / available",
    without trailing price or day words, at most six words. None when no such shape is found (the raw message is never used as the product)."""
    one = " ".join(_PRODUCT_CONTROL.sub(" ", text).split())[:300]
    if re.search(r"\d{6,}|@", one):
        return None
    lead = _LEAD_IN.match(one)
    found = _BEFORE_PRICE.match(one)
    if lead:
        candidate = _TAIL.sub("", one[lead.end():], count=1)
    elif found:
        candidate = found.group(1)
    else:
        return None
    candidate = candidate.strip(" ,;:-")
    words = candidate.split()
    if not 1 <= len(words) <= 6 or len(candidate) < 3 or _NOT_A_PRODUCT.match(candidate):
        return None
    if all(w.lower().strip(".,;:!?'\"") in _STOP_WORDS for w in words):
        return None   # "any new items", "whats the": words, but no product
    return candidate[:80]
