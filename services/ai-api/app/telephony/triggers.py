"""What a caller says that ends or changes a call, in code (job phone-calls part 3): "do not call me again", and the greeting of a voicemail or a phone menu. Plain word lists per language, matched on the lower-cased,
NFC-normalised text; a miss means the model's ordinary conversation goes on (the assistant is also told to stop when asked), a hit acts at once. The lists are data and every entry is pinned by a test."""

# ruff: noqa: E501
from __future__ import annotations

import re
import unicodedata

_STOP_LATIN = re.compile(
    r"\b(?:(?:do not|don't|dont|never|stop)\s+(?:call|phone|ring|disturb|contact)(?:ing)?(?:\s+me)?(?:\s+again)?|stop\s+calling|remove\s+(?:my|this)\s+(?:number|name)|take\s+me\s+off|"
    r"(?:call|phone)\s+(?:me\s+)?(?:again|back)\s+(?:never|no)|no\s+more\s+calls|(?:call|phone)\s+cheyakandi|call\s+cheyoddu|phone\s+mat\s+karo|call\s+mat\s+karo|disturb\s+mat\s+karo)\b"
)
_STOP_INDIAN = (
    "కాల్ చేయకండి", "కాల్ చేయొద్దు", "కాల్ చెయ్యొద్దు", "ఫోన్ చేయకండి", "ఫోన్ చేయొద్దు", "మళ్ళీ కాల్ చేయకండి", "మళ్లీ కాల్ చేయకండి", "నంబర్ తీసేయండి", "డిస్టర్బ్ చేయకండి",
    "कॉल मत करो", "कॉल मत करना", "फोन मत करो", "फोन मत करना", "दोबारा कॉल मत", "दुबारा फोन मत", "नंबर हटा", "परेशान मत करो", "कॉल नहीं करना",
    "ಕಾಲ್ ಮಾಡಬೇಡಿ", "ಫೋನ್ ಮಾಡಬೇಡಿ", "ಮತ್ತೆ ಕಾಲ್ ಮಾಡಬೇಡಿ", "ನಂಬರ್ ತೆಗೆದುಹಾಕಿ", "ತೊಂದರೆ ಕೊಡಬೇಡಿ",
    "அழைக்காதீர்கள்", "போன் பண்ணாதீங்க", "கால் பண்ணாதீங்க", "மீண்டும் அழைக்காதீர்கள்", "நம்பரை நீக்குங்க",
    "വിളിക്കരുത്", "വിളിക്കല്ലേ", "ഫോൺ ചെയ്യരുത്", "നമ്പർ ഒഴിവാക്കൂ",
    "कॉल करू नका", "फोन करू नका", "पुन्हा कॉल करू नका", "पुन्हा फोन करू नका", "नंबर काढून टाका", "त्रास देऊ नका",   # Marathi (job M1, drafts)
)
_VOICEMAIL_LATIN = re.compile(
    r"\b(?:leave\s+(?:a|your)\s+message|after\s+the\s+(?:tone|beep)|at\s+the\s+(?:tone|beep)|voice\s?mail|mail\s?box|(?:is|are)\s+(?:not\s+available|unavailable|switched\s+off|out\s+of\s+(?:coverage|reach))|"
    r"(?:number|subscriber)\s+you\s+(?:have\s+)?(?:dialled|dialed|called)|cannot\s+be\s+reached|not\s+reachable|please\s+record)\b"
)
_VOICEMAIL_INDIAN = (
    "బీప్ శబ్దం", "మీరు డయల్ చేసిన", "అందుబాటులో లేరు", "స్విచ్ ఆఫ్", "సందేశం వదలండి",
    "आपके द्वारा डायल किया गया", "उपलब्ध नहीं है", "स्विच ऑफ", "बीप के बाद", "संदेश छोड़ें", "पहुँच से बाहर",
    "ನೀವು ಡಯಲ್ ಮಾಡಿದ", "ಲಭ್ಯವಿಲ್ಲ", "ಸ್ವಿಚ್ ಆಫ್", "ಸಂದೇಶ ಬಿಡಿ",
    "நீங்கள் அழைத்த", "தொடர்பு கொள்ள முடியவில்லை", "ஸ்விட்ச் ஆஃப்", "ബീപ്പ്", "നിങ്ങൾ വിളിച്ച", "ലഭ്യമല്ല",
    "तुम्ही डायल केलेला", "उपलब्ध नाही", "संदेश ठेवा", "बीपनंतर", "संपर्क क्षेत्राबाहेर",   # Marathi (job M1, drafts; "स्विच ऑफ" is already above)
)
# "let me talk to a person" (owner, 5 Nov 2026; calls-like-a-pro part 4): the caller asks for a human, the owner or the manager; the call hands over (the team calls back)
_PERSON_LATIN = re.compile(
    r"\b(?:(?:talk|speak)\s+(?:to|with)\s+(?:a\s+|some\s?one\s+|an?\s+)?(?:real\s+)?(?:person|human|someone|somebody|owner|manager|staff|team|boss|sales\s?person)|"
    r"(?:connect|transfer|put)\s+me\s+(?:to|through|with)|(?:i\s+want|give\s+me|get\s+me)\s+(?:a\s+|the\s+)?(?:person|human|owner|manager)|"
    r"(?:manager|owner)\s+(?:ki|ko)\s+(?:phone|call)|(?:manager|owner|insaan)\s+se\s+baat|manishi\s+tho\s+matladali)\b"
)
_PERSON_INDIAN = (
    "మనిషితో మాట్లాడాలి", "మనిషితో మాట్లాడతాను", "ఓనర్ తో మాట్లాడాలి", "ఓనర్‌తో మాట్లాడాలి", "మేనేజర్ తో మాట్లాడాలి", "మేనేజర్‌తో మాట్లాడాలి", "ఎవరైనా మనిషి", "మీ ఓనర్ కి ఇవ్వండి",
    "किसी इंसान से बात", "इंसान से बात", "मैनेजर से बात", "मालिक से बात", "ओनर से बात", "किसी आदमी से बात",
    "ಮನುಷ್ಯರ ಜೊತೆ ಮಾತಾಡ", "ಮ್ಯಾನೇಜರ್ ಜೊತೆ ಮಾತಾಡ", "ಮಾಲೀಕರ ಜೊತೆ ಮಾತಾಡ", "ಓನರ್ ಜೊತೆ ಮಾತಾಡ",
    "மனிதரிடம் பேச", "மேனேஜரிடம் பேச", "ஓனரிடம் பேச", "മനുഷ്യനോട് സംസാരിക്കണം", "മാനേജരോട് സംസാരിക്കണം",
    "माणसाशी बोल", "मॅनेजरशी बोल", "मालकाशी बोल", "ओनरशी बोल",   # Marathi (job M1, drafts): "माणसाशी बोलायचं आहे", "मॅनेजरशी बोलायचं आहे" ...
)
_REAL_PERSON = re.compile(r"\b(?:real|actual)\s+(?:person|human)\b")   # "a real person": a request, unless it is the identity question ("are you a real person?")
_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿"))


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_ZERO_WIDTH).lower()


def stop_requested(text: str) -> bool:
    """The caller asks not to be called again."""
    t = _norm(text)
    return bool(_STOP_LATIN.search(t)) or any(w in t for w in _STOP_INDIAN)


def voicemail_greeting(text: str) -> bool:
    """The "person" is a mailbox, a network message or a phone menu."""
    t = _norm(text)
    return bool(_VOICEMAIL_LATIN.search(t)) or any(w in t for w in _VOICEMAIL_INDIAN)


def person_asked_explicitly(text: str) -> bool:
    """The caller asks to TALK to a human (a person, the owner, the manager): always a hand-over, even when the sentence also says "human"."""
    t = _norm(text)
    return bool(_PERSON_LATIN.search(t)) or any(_norm(w) in t for w in _PERSON_INDIAN)


def person_requested(text: str) -> bool:
    """Any request for a person: the explicit ones, or "a real person" (the caller checks the identity question first for that one)."""
    return person_asked_explicitly(text) or bool(_REAL_PERSON.search(_norm(text)))
