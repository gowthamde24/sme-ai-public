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
)
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
