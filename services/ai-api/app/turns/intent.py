"""What kind of turn is this? (job EA, the conversational assistant.) THE ROUTER DECIDES; the client never says "Ask" or "Do it".

Four kinds: `smalltalk` (a greeting, a feeling, thanks, a joke), `general` (help from general knowledge: write, translate, explain, advise), `business` (a question about THIS business's records: the
tool path, with sources) and `action` (do something to people: call, message, remind; the task planner, then the owner's yes).

Rules in code, no model call, no clock, no randomness (the same words give the same kind, so a test can pin each example). Order, first match wins:
  1. an OUTREACH verb at the start of the message (call, phone, message, WhatsApp, remind, follow up with ...) or, in Telugu, Hindi and Kannada, a channel word together with a "do/send" verb -> action;
  2. a short greeting, feeling, thanks or joke -> smalltalk;
  3. a word about the business's own records (enquiry, lead, customer, quote, order, due, stock, today, how many ...) -> business;
  4. a general-help verb or question word (write, translate, explain, how do I, what is ...) -> general;
  5. a short follow-up ("and yesterday?", "make it shorter") continues the kind of the turn before it;
  6. nothing matched: a message in an Indian script or naming someone (a capitalised word that does not start the sentence, a number) is `business` (the cited path is the safe one: it can say "no record");
     plain English with no names is `general`.
A business word beats a general verb: "write a follow-up for Ramesh" is the follow-up draft tool, not a poem. The lists are data below, one per language, and every entry is pinned by a test.

Matching: lower-cased, NFC, zero-width joiners removed. A Latin word matches at a word start ("lead" finds "leads"); a word ending in `$` must end there; an Indian-language word matches anywhere inside a word
(those languages put endings on the word)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

Kind = Literal["smalltalk", "general", "business", "action"]
KINDS: tuple[Kind, ...] = ("smalltalk", "general", "business", "action")

_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿"))
SMALLTALK_WORDS = 8   # a longer message is never "just small talk"
FOLLOW_UP_WORDS = 6   # a message this short, with no other signal, continues the turn before it

# ---- 1. action: a verb of reaching people at the START of the message (after "please", "can you" ...)
_POLITE = r"(?:(?:please|pls|kindly|can you|could you|would you|will you|i want you to|i need you to|go and|just|now|also|then|and)\s+)*"
_NOT_NOUN = r"(?!\s+(?:from|history|log|logs|count|volume|rate|rates|is|was|are|were|me|us|back)\b)"   # "message from Ramesh", "call log" are not instructions
_ACTION_START = re.compile(
    rf"^{_POLITE}(?:call|phone|ring|whatsapp|message|text|ping|remind|follow[ -]?up(?: with| on)?|reach out(?: to)?|send (?:a |the )?(?:message|whatsapp|reminder)s?)\b{_NOT_NOUN}"
)
# the channel words and the "do it" verbs of the other languages: a message with BOTH is an instruction to reach people
_ACTION_CHANNEL = {
    "te": ("కాల్", "ఫోన్", "మెసేజ్", "వాట్సాప్", "గుర్తు చేయ", "గుర్తుచేయ"),
    "hi": ("कॉल", "फोन", "मैसेज", "व्हाट्सऐप", "व्हाट्सएप", "याद दिला"),
    "kn": ("ಕಾಲ್", "ಕರೆ", "ಫೋನ್", "ಮೆಸೇಜ್", "ವಾಟ್ಸಾಪ್", "ನೆನಪಿಸ"),
}
_ACTION_DO = {
    "te": ("చేయ", "చెయ్", "పంపు", "పంపండి", "చేసెయ్"),
    "hi": ("कर", "भेज", "दिला", "करो", "कीजिए"),
    "kn": ("ಮಾಡಿ", "ಮಾಡು", "ಕಳುಹಿಸಿ", "ಕಳುಹಿಸು"),
}
# a question about a call or a message is not an instruction ("how many calls today?")
_ACTION_NOT = re.compile(r"\b(how many|how much|which|who|what|when|why|show|list|count|did|have|has|was|were)\b|\?\s*$")

# ---- 2. small talk
_SMALLTALK_LATIN = (
    r"^(?:hi+|hello+|hey+|hola|namaste|namaskaram|namaskar|vanakkam|good (?:morning|afternoon|evening|night)|gm|gn)\b",
    r"\bhow are you\b", r"\bhow('s| is) it going\b", r"\bwhat'?s up\b", r"\bhow('s| is) your day\b", r"\bwho are you\b", r"\bwhat'?s your name\b",
    r"^(?:ok(?:ay)? )?(?:thanks|thank you|thx|ty|cheers)\b", r"^(?:bye|good ?bye|see you|ttyl|take care)\b", r"^(?:lol|haha+|hehe+|nice|cool|great|awesome|wow)\b",
    r"\btell me a joke\b", r"^joke\b", r"\bi(?:'m| am)\s+(?:so |very |really |a bit )?(?:tired|happy|sad|stressed|bored|worried|excited|fine|good|great|angry|upset|sleepy|hungry)\b",
    r"\b(?:i feel|feeling)\s+(?:tired|low|sad|stressed|happy|bad)\b", r"\bhow do you do\b",
    r"\b(?:ela ?(?:unnaru|unnav)|bagunnara|baagunnara|baagunnava|bagunnava|em chestunnav|em chestunnaru)\b",
)
_SMALLTALK_INDIAN = (
    "నమస్కారం", "నమస్తే", "హలో", "హాయ్", "ఎలా ఉన్నారు", "ఎలా ఉన్నావు", "బాగున్నారా", "బాగున్నావా", "ధన్యవాదాలు", "థాంక్స్", "థాంక్యూ", "అలసిపోయా", "అలిసిపోయా", "జోక్ చెప్పు", "జోక్",
    "नमस्ते", "हेलो", "हैलो", "कैसे हो", "कैसी हो", "आप कैसे हैं", "आप कैसी हैं", "धन्यवाद", "शुक्रिया", "थैंक", "थक गया", "थक गई", "चुटकुला", "जोक सुना",
    "ನಮಸ್ಕಾರ", "ಹಲೋ", "ಹಾಯ್", "ಹೇಗಿದ್ದೀರಿ", "ಹೇಗಿದ್ದೀಯ", "ಧನ್ಯವಾದ", "ಥ್ಯಾಂಕ್ಸ್", "ಸುಸ್ತಾಗಿದೆ", "ಜೋಕ್",
    "வணக்கம்", "நன்றி", "எப்படி இருக்கிறீர்கள்", "നമസ്കാരം", "നന്ദി", "സുഖമാണോ",
)

# ---- 3. the business's own records
_BUSINESS_LATIN = (
    "enquir", "inquir", "lead", "customer", "client", "quote", "quotation", "order", "invoice", "payment", "paid", "unpaid", "due$", "dues$", "outstanding", "overdue", "stock", "inventory",
    "catalog", "follow-up", "followup", "follow up", "repl(?:y|ied|ies)", "chat$", "chats$", "pending", "waiting",
    "visit", "appointment", "walk-in", "sales", "revenue", "collection", "fees$", "fee$", "admission", "parent", "delivery", "deliveries", "price list", "price of", "rate of", "rates of",
    "how many", "how much (?:did|have|is|are)", "who (?:didn't|did not|hasn't|has not|haven't|have not|paid|called|wrote|replied|messaged|visited|owes)", "which customers", "my business", "our (?:customers|leads|orders|sales|stock|team)",
    "my (?:customers|leads|orders|sales|stock|quotes|enquiries|payments|messages|chats|numbers|day)", "what needs me", "what do i need to do", "what should i do first", "need(?:s)? my attention",
    "whatsapp chat", "missed call", "gst invoice", "bill$", "bills$", "outbox", "approval",
)
# a time word alone is a business signal only when nothing else decided ("I'm tired today" is small talk; "and yesterday?" is a follow-up on the records)
_WEAK_TIME = ("today", "yesterday", "tomorrow", "this week", "this month", "last week", "last month", "ఈరోజు", "ఈ రోజు", "నిన్న", "రేపు", "ఈ వారం", "ఈ నెల", "आज", "कल", "इस हफ्ते", "इस हफ़्ते", "इस महीने", "ಇಂದು", "ನಿನ್ನೆ", "ನಾಳೆ", "ಈ ವಾರ", "ಈ ತಿಂಗಳು")
_BUSINESS_INDIAN = (
    "ఎంక్వైరీ", "ఎంక్వయిరీ", "లీడ్", "కస్టమర్", "వినియోగదారు", "కొటేషన్", "ఆర్డర్", "ఇన్వాయిస్", "చెల్లింపు", "బకాయి", "స్టాక్", "ఫాలో", "పెండింగ్", "ఎంత మంది",
    "ఎంతమంది", "ధర", "రేటు", "అమ్మకాలు", "విజిట్", "అపాయింట్", "ఫీజు", "విద్యార్థ", "అడ్మిషన్", "డెలివరీ", "నా వ్యాపార", "నా బిజినెస్", "రిప్లై",
    "पूछताछ", "इंक्वायरी", "एनक्वायरी", "लीड", "ग्राहक", "कस्टमर", "कोटेशन", "ऑर्डर", "इनवॉइस", "भुगतान", "बकाया", "स्टॉक", "फॉलो", "पेंडिंग", "कितने", "कितनी", "कीमत", "रेट",
    "बिक्री", "विज़िट", "अपॉइंटमेंट", "फीस", "छात्र", "एडमिशन", "डिलीवरी", "मेरा बिजनेस", "मेरे ग्राहक", "रिप्लाई", "जवाब",
    "ಎನ್‌ಕ್ವೈರಿ", "ಎನ್ಕ್ವೈರಿ", "ಲೀಡ್", "ಗ್ರಾಹಕ", "ಕಸ್ಟಮರ್", "ಕೊಟೇಶನ್", "ಆರ್ಡರ್", "ಇನ್‌ವಾಯ್ಸ್", "ಪಾವತಿ", "ಬಾಕಿ", "ಸ್ಟಾಕ್", "ಫಾಲೋ", "ಎಷ್ಟು", "ಬೆಲೆ", "ದರ", "ಮಾರಾಟ", "ಶುಲ್ಕ", "ವಿದ್ಯಾರ್ಥಿ", "ರಿಪ್ಲೈ",
)

# ---- 4. general help
_GENERAL_LATIN = (
    r"^(?:please |pls |can you |could you |kindly )?(?:write|compose|draft|create|make|rewrite|rephrase|translate|explain|summari[sz]e|suggest|recommend|give me|teach|tell me (?:about|how|why|what)|help me (?:write|plan|understand|with|think)|brainstorm|proofread|correct|shorten|improve)\b",
    r"^(?:how (?:do|can|should|to|does|would)|what (?:is|are|does|do|should)|what'?s (?:a|an|the)|why (?:is|are|do|does|did|should)|when (?:should|do|is it)|is it (?:ok|okay|legal|allowed|true)|should i|can i|which is better|difference between|meaning of|define)\b",
    r"\b(?:capital of|population of|weather|news|recipe|history of|who (?:is|was) the (?:prime minister|president|ceo|founder|inventor)|how far|how old|time zone)\b",
    r"\b(?:idea|ideas|tips?|advice|strategy|template|slogan|caption|greeting|poem|story|speech|post|offer message|festival|diwali|sankranti|ugadi|dasara|eid|christmas)\b",
)
_GENERAL_INDIAN = (
    "రాయి", "రాయండి", "రాసి", "అనువదించ", "వివరించ", "ఎలా రాయాలి", "ఎలా చేయాలి", "ఏమిటి", "అంటే ఏమిటి", "ఐడియా", "సలహా", "చిట్కా",
    "लिखो", "लिखिए", "लिख दो", "अनुवाद", "समझाओ", "समझाइए", "क्या है", "कैसे करें", "आइडिया", "सलाह", "सुझाव",
    "ಬರೆ", "ಅನುವಾದ", "ವಿವರಿಸಿ", "ಎಂದರೇನು", "ಹೇಗೆ", "ಐಡಿಯಾ", "ಸಲಹೆ",
)

_NAME_TOKEN = re.compile(r"(?<!^)(?<![.!?]\s)\b[A-Z][a-z]{2,}\b")
_NUMBER_TOKEN = re.compile(r"\b\d{3,}\b")
_YES_NO = re.compile(r"^(?:yes|yeah|yep|y|ok(?:ay)?|sure|go ahead|do it|confirm|no|nope|n|cancel|don'?t|stop|ho|avunu|kaadu|haan|nahi|illa)\b[.! ]*$")


@dataclass(frozen=True)
class Intent:
    kind: Kind
    reason: str   # a closed word for the log and the tests: why this kind


def normalise(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_ZERO_WIDTH).lower().strip()


def _latin(patterns: tuple[str, ...], text: str) -> bool:
    for p in patterns:
        if p.startswith("^") or p.startswith("\\b") or p.startswith("(?"):
            if re.search(p, text):
                return True
        elif re.search(rf"\b{p}" if not p.endswith("$") else rf"\b{p[:-1]}\b", text):
            return True
    return False


def _indian(words: tuple[str, ...], text: str) -> bool:
    return any(w in text for w in words)


def _word_count(text: str) -> int:
    return len(re.findall(r"[^\W_]+", text))


def is_yes_no(text: str) -> bool:
    """A bare yes or no (the owner answering a plan that waits): the router of the voice socket uses it."""
    return bool(_YES_NO.match(normalise(text)))


def _is_action(norm: str) -> bool:
    if _ACTION_START.match(norm):
        return True
    for lang in ("te", "hi", "kn"):
        if _indian(_ACTION_CHANNEL[lang], norm) and _indian(_ACTION_DO[lang], norm) and not _ACTION_NOT.search(norm):
            return True
    return False


def _has_business(norm: str) -> bool:
    return _latin(_BUSINESS_LATIN, norm) or _indian(_BUSINESS_INDIAN, norm)


def _has_time_word(norm: str) -> bool:
    return _latin(tuple(w for w in _WEAK_TIME if w.isascii()), norm) or _indian(tuple(w for w in _WEAK_TIME if not w.isascii()), norm)


def _is_smalltalk(norm: str) -> bool:
    return _word_count(norm) <= SMALLTALK_WORDS and (_latin(_SMALLTALK_LATIN, norm) or _indian(_SMALLTALK_INDIAN, norm))


def _is_general(norm: str) -> bool:
    return _latin(_GENERAL_LATIN, norm) or _indian(_GENERAL_INDIAN, norm)


def _has_indian_script(text: str) -> bool:
    return any(ord(ch) >= 0x0900 and unicodedata.category(ch).startswith(("L", "M")) for ch in text)


def classify(text: str, previous: Kind | None = None) -> Intent:
    """The kind of this turn. `previous` is the kind of the turn before it in the same conversation (None for the first)."""
    norm = normalise(text)
    if _is_action(norm):
        return Intent("action", "outreach_verb")
    strong = _has_business(norm)
    if _is_smalltalk(norm) and not strong:
        return Intent("smalltalk", "greeting_or_feeling")
    if strong:
        return Intent("business", "records_word")
    if _has_time_word(norm) and not _is_general(norm):
        return Intent("business", "time_word")
    if _is_general(norm):
        return Intent("general", "general_help")
    if previous is not None and _word_count(norm) <= FOLLOW_UP_WORDS:
        return Intent(previous if previous != "action" else "business", "follow_up")
    if _has_indian_script(text) or _NAME_TOKEN.search(text) or _NUMBER_TOKEN.search(text):
        return Intent("business", "names_or_numbers")
    return Intent("general", "default")
