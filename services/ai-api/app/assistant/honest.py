"""A reply that only TALKS must never promise or refuse (owner, 14 Nov 2026: "check if kalyani's contact is there or not?" was answered "I'll check your contacts for Kalyani now… I'll tell you what I find." and nothing ever came
back; earlier in the thread the same step said "I can't see Kalyani's contact or send WhatsApp messages", which is false).

The chat-only step has no records and no tools. The turn's gate (app/turns/intent.py) sends everything that touches the business's data or asks for an action to the step that has them; this is the second net for what
slips through: a chat-only answer that promises to look something up or do something, or says it cannot, is NOT shown. In its place goes ONE fixed line that says plainly that nothing was looked up or done, and how to
ask it so that it is. Code decides, no model call."""

from __future__ import annotations

import re

from app.assistant.language import Language

_DO = r"(?:check|look(?:ing)?|find|search|see|set|do|send|get|tell|let you know|update|add|call|message|share|pull|fetch|verify|confirm|open|save|book|cancel|move|change|notify|remind|reply|forward|connect|work on)"
_PROMISE_EN = re.compile(rf"(?i)\b(?:i\'?ll|i will|i shall|i\'?m going to|i am going to|let me|allow me to|give me a (?:moment|second|minute)(?: and i)?|one moment while i)\s+(?:now |just |quickly |first |go and )?{_DO}\b")
_REFUSE_EN = re.compile(
    r"(?i)\b(?:i\s+)?(?:can\'?t|cannot|can not|am not able to|\'?m not able to|am unable to|\'?m unable to|don\'?t have (?:the )?(?:ability|way|access)|do not have (?:the )?(?:ability|way|access)|have no (?:way|access))\b.{0,50}"
    r"\b(?:see|view|access|check|find|look|open|read|send|call|message|whatsapp|contacts?|leads?|records?|numbers?)\b"
)
_INDIAN = (
    # Telugu: I will see / do / send / tell; I cannot see / do
    "చూస్తాను", "చూస్తా ", "చెక్ చేస్తాను", "చెక్ చేస్తా", "చేస్తాను", "చేస్తా.", "పంపుతాను", "పంపిస్తాను", "చెబుతాను", "చెప్తాను", "తెలియజేస్తాను", "వెతుకుతాను", "చూడలేను", "చేయలేను", "పంపలేను", "యాక్సెస్ లేదు",
    # Hindi
    "देखता हूँ", "देखती हूँ", "देख लेती हूँ", "देख लेता हूँ", "करूँगी", "करूँगा", "भेजूँगी", "भेजूँगा", "बताऊँगी", "बताऊँगा", "नहीं देख सकती", "नहीं देख सकता", "नहीं कर सकती", "नहीं कर सकता", "एक्सेस नहीं",
    # Kannada
    "ನೋಡುತ್ತೇನೆ", "ನೋಡ್ತೀನಿ", "ಮಾಡುತ್ತೇನೆ", "ಕಳುಹಿಸುತ್ತೇನೆ", "ಹೇಳುತ್ತೇನೆ", "ನೋಡಲಾಗುವುದಿಲ್ಲ", "ಮಾಡಲಾಗುವುದಿಲ್ಲ", "ಪ್ರವೇಶವಿಲ್ಲ",
)

NOTHING_DONE: dict[Language, str] = {
    "en": "I have not looked anything up or done anything in this answer. Ask it as an instruction, for example: \"Is Kalyani in my contacts?\" or \"Send Kalyani: how are you?\"",
    "te": "ఈ జవాబులో నేను ఏమీ చూడలేదు, ఏమీ చేయలేదు. ఇలా అడగండి: \"Kalyani నా కాంటాక్ట్స్ లో ఉందా?\" లేదా \"Kalyani కి పంపు: ఎలా ఉన్నారు?\"",
    "hi": "इस जवाब में मैंने कुछ देखा या किया नहीं है। ऐसे पूछिए: \"क्या Kalyani मेरे contacts में है?\" या \"Kalyani को भेजो: कैसे हैं?\"",
    "kn": "ಈ ಉತ್ತರದಲ್ಲಿ ನಾನು ಏನೂ ನೋಡಿಲ್ಲ, ಏನೂ ಮಾಡಿಲ್ಲ. ಹೀಗೆ ಕೇಳಿ: \"Kalyani ನನ್ನ contacts ನಲ್ಲಿ ಇದೆಯಾ?\" ಅಥವಾ \"Kalyani ಗೆ ಕಳುಹಿಸು: ಹೇಗಿದ್ದೀರಿ?\"",
    "ta": "இந்த பதிலில் நான் எதையும் பார்க்கவில்லை, எதுவும் செய்யவில்லை. இப்படிக் கேளுங்கள்: \"Kalyani என் contacts இல் இருக்கிறாரா?\"",
    "ml": "ഈ ഉത്തരത്തിൽ ഞാൻ ഒന്നും നോക്കിയിട്ടില്ല, ഒന്നും ചെയ്തിട്ടില്ല. ഇങ്ങനെ ചോദിക്കൂ: \"Kalyani എന്റെ contacts ൽ ഉണ്ടോ?\"",
    "mr": "या उत्तरात मी काही पाहिलेलं किंवा केलेलं नाही. असं विचारा: \"Kalyani माझ्या contacts मध्ये आहे का?\"",
}


def promises_or_refuses(answer: str) -> bool:
    """Does a chat-only answer promise to look something up or do something, or say it cannot?"""
    # only what the assistant says ABOUT itself, in the first paragraph and outside quotation marks: a drafted message the owner asked for ("Hi Ravi, I\'ll call you tomorrow") is the owner\'s text, not a promise
    first = re.split(r"\n\s*\n|\n", (answer or "").strip(), maxsplit=1)[0]
    text = " ".join(re.sub(r"[\"“‘][^\"”’]*[\"”’]", " ", first).split())
    return bool(_PROMISE_EN.search(text) or _REFUSE_EN.search(text) or any(w in text for w in _INDIAN))


# A look-up that WAS done may still end on a promise to look again ("... so I cannot tell you his city. I will check again."): the turn is over, nothing more is coming (owner, 17 Nov 2026: a turn never ends with a
# promise to do something it has not done). Only a deferred look-up is cut, only when it is a sentence of its own and not conditional on what the person says next ("tell me his surname and I will look again" stays).
_DEFERRED = re.compile(r"(?i)\b(?:i\'?ll|i will|i shall|let me)\s+(?:now |just |quickly |also |then )?(?:check|look|search|find|verify|confirm|see|get back|come back)\b")
_CONDITIONAL = re.compile(r"(?i)\b(?:if|once|when|after|whenever|unless|tell me|send me|give me|share|let me know|and i|then i|so i|to i|can i|shall i|should i|want me|would you like|do you want)\b|\?")


def strip_deferred_promise(answer: str) -> str:
    """The answer without a sentence that promises a later look-up; the same text when there is none. Empty when nothing else was said."""
    text = (answer or "").strip()
    if not text:
        return text
    kept: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        plain = " ".join(re.sub(r"[\"“‘][^\"”’]*[\"”’]", " ", sentence).split())
        if _DEFERRED.search(plain) and not _CONDITIONAL.search(plain):
            continue
        kept.append(sentence)
    return " ".join(kept).strip()
