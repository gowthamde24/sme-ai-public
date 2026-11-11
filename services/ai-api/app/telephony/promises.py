"""No promise the assistant cannot keep (owner, 11 Nov 2026, after his brother's test calls: "my team will call you", "I'll note that down", "should they call this number?").

On an OUTBOUND goal call the assistant cannot do anything after the call: nothing is noted, passed on, sent or arranged, no team calls back, no number is shared. So a spoken line that PROMISES such an action is never spoken: it is replaced by one
short true line, and only a closed word (never the text) is logged. This is code, not a request to the model; the prompt says the same (persona.outbound_goal_prompt), and the tests scan every fixed line we ship for the same words.

`find(text)` returns the closed word of the first promise it finds, else None: `callback` (a team / someone / I will call, contact, get back), `note` (I will note / write down / take a note), `pass_on` (I will pass / forward / share / give / send your number, details, message),
`arrange` (I will arrange / book / confirm / make sure). English, Telugu, Hindi and Kannada, as people say them on the phone (English words inside the script are matched too). A question ("should they call this number?") is also caught
as `ask_number`: the assistant does not offer a callback at all."""

# ruff: noqa: E501

from __future__ import annotations

import re
import unicodedata

from app.telephony import tone as tone_mod

SAFE_EN = "I can't arrange that on this call."
SAFE = {
    "en": {t: SAFE_EN for t in tone_mod.TONES},
    "te": {"respectful": "అది నేను ఈ కాల్ లో చేయలేనండీ.", "friendly": "అది నేను ఈ కాల్ లో చేయలేను.", "casual": "అది నేను ఈ కాల్ లో చేయలేను."},
    "hi": {t: "यह मैं इस कॉल में नहीं कर सकती।" for t in tone_mod.TONES},
    "kn": {t: "ಅದನ್ನು ನಾನು ಈ ಕಾಲ್‌ನಲ್ಲಿ ಮಾಡಲಾಗುವುದಿಲ್ಲ." for t in tone_mod.TONES},
}

_TEAM_EN = r"(?:our|the|my)\s+(?:team|staff|people|colleagues?|manager|owner|sales\s*team)|someone|somebody|a\s+(?:person|colleague|team\s*member)|we|they|he|she"
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (word, re.compile(rx, re.IGNORECASE | re.DOTALL))
    for word, rx in (
        # ---- English
        ("callback", rf"\b(?:{_TEAM_EN})\b[^.?!]{{0,30}}\b(?:will|shall|'ll|going\s+to|gonna)\b[^.?!]{{0,25}}\b(?:call|ring|contact|reach\s+out|get\s+back|talk\s+to|speak\s+to|message|whatsapp|follow\s*up)\b"),
        ("callback", r"\bI(?:'ll|\s+will|\s+shall)\s+(?:call|ring|contact|get\s+back\s+to|follow\s+up\s+with)\s+you\b"),
        ("note", r"\bI(?:'ll|\s+will|\s+shall|'m\s+going\s+to)\s+(?:make\s+a\s+note|take\s+a\s+note|note|jot|write|put)\b[^.?!]{0,12}\b(?:down|that|it|this|your)\b"),
        ("note", r"\bI(?:'ll|\s+will)\s+note\b"),
        ("pass_on", r"\bI(?:'ll|\s+will|\s+shall)\s+(?:pass|forward|share|give|send|hand|relay|convey|tell|inform|let)\b[^.?!]{0,30}\b(?:number|details|message|request|info|information|them|team|owner|manager)\b"),
        ("arrange", r"\bI(?:'ll|\s+will|\s+shall)\s+(?:arrange|book|schedule|confirm|make\s+sure|take\s+care|organi[sz]e|set\s+up)\b"),
        ("ask_number", r"\b(?:should|shall|can|may|do)\b[^.?!]{0,12}\b(?:they|we|our\s+team|someone)\b[^.?!]{0,25}\b(?:call|contact|reach|ring)\b[^.?!]{0,25}\b(?:you|this\s+number|your\s+number|here)\b"),
        # ---- Telugu (script and the Latin words people mix in)
        ("callback", r"(?:మా\s*(?:టీమ్|team|స్టాఫ్|వాళ్ళు|వాళ్లు|ఓనర్|owner)|team|టీమ్|వాళ్ళు|వాళ్లు|ఎవరైనా)[^.?!]{0,40}(?:call|కాల్|ఫోన్|సంప్రదిస్|మాట్లాడ|మెసేజ్|message)[^.?!]{0,20}(?:చేస్తా|చేస్తారు|చేస్తాం|చేస్తాడు|చేస్తుంది|చేయిస్తా|పెడతా|పెడతారు|చేస్తాను|చేయిస్తాను|మాట్లాడతా|సంప్రదిస్తా)"),
        ("callback", r"(?:తిరిగి|మళ్ళీ|మళ్లీ|call\s*back|కాల్\s*బ్యాక్)[^.?!]{0,25}(?:call|కాల్|ఫోన్)?[^.?!]{0,15}(?:చేస్తా|చేస్తారు|చేస్తాం|చేస్తాను)"),
        ("note", r"(?:note|నోట్|రాసు|రాస్తా|రాసుకు)[^.?!]{0,25}(?:చేసుకుంటా|చేసుకుంటాను|చేసుకుంటాం|చేస్తా|చేస్తాను|పెట్టుకుంటా|పెట్టుకుంటాను|కుంటా|చేసి\s*పెడతా|వేసుకుంటా)"),
        ("pass_on", r"(?:మీ\s*(?:నంబర్|number|నెంబర్|details|డిటైల్స్|పేరు|message|మెసేజ్)|ఆ\s*విషయం|ఈ\s*విషయం|ఈ\s*details)[^.?!]{0,30}(?:ఇస్తా|ఇస్తాను|ఇస్తాం|షేర్|share|పంపిస్తా|పంపుతా|పంపిస్తాను|పాస్|pass|చెప్తా|చెబుతా|చెప్తాను|చెప్పేస్తా|ఫార్వర్డ్|forward)"),
        ("pass_on", r"(?:టీమ్|team|ఓనర్|owner)(?:కి|కు|తో|ke)?[^.?!]{0,25}(?:చెప్తా|చెబుతా|చెప్తాను|చెప్పేస్తా|ఇస్తా|పంపిస్తా|పాస్\s*చేస్తా|తెలియజేస్తా)"),
        ("arrange", r"(?:arrange|book|confirm|ఏర్పాటు|బుక్|కన్ఫర్మ్|confirm)[^.?!]{0,20}(?:చేస్తా|చేస్తాను|చేస్తాం|చేయిస్తా|చేయిస్తాను|చేసి\s*పెడతా|చేసి\s*పెడతాను)"),
        ("ask_number", r"(?:ఈ\s*నంబర్|ఈ\s*number|ఈ\s*నెంబర్|మీ\s*నంబర్)[^.?!]{0,20}(?:కి|కే|లో|కు)?[^.?!]{0,15}(?:call|కాల్|ఫోన్)[^.?!]{0,15}(?:చేయమంటారా|చేయమంటావా|చేయొచ్చా|చేయాలా|చేయమంటారు|చేయనా)"),
        # ---- giving up the goal (owner, 11 Nov 2026: "మీ సౌకర్యం ఎలాగో అలాగే ఉండండి"): not a promise, but a goal call never tells the person to carry on as they please
        ("gives_up", r"(?:మీ\s*సౌకర్యం|మీ\s*ఇష్టం|మీకు\s*ఎలా\s*వీలైతే)[^.?!]{0,20}(?:ఉండండి|చేయండి|ఉండొచ్చు|చేసుకోండి)"),
        ("gives_up", r"\b(?:as\s+you\s+(?:wish|like|please)|whatever\s+(?:is\s+)?(?:convenient|comfortable)|just\s+(?:stay|carry\s+on)\s+as\s+you\s+are|do\s+as\s+you\s+please)\b"),
        # ---- Hindi
        ("callback", r"(?:हमारी\s*टीम|हमारे\s*लोग|टीम|कोई)[^.?!।]{0,30}(?:कॉल|फोन|संपर्क|बात|मैसेज)[^.?!।]{0,15}(?:करेगी|करेंगे|करेगा|करेंगी|करवा\s*दूँगी|करवाऊँगी)"),
        ("note", r"(?:नोट|लिख)[^.?!।]{0,15}(?:कर\s*लूँगी|कर\s*लेती\s*हूँ|कर\s*लूँगा|कर\s*लूंगी|लूँगी|लूंगी|लूँगा)"),
        ("pass_on", r"(?:आपका\s*नंबर|आपकी\s*जानकारी|यह\s*बात|ये\s*बात)[^.?!।]{0,25}(?:दे\s*दूँगी|दे\s*दूंगी|भेज\s*दूँगी|भेज\s*दूंगी|बता\s*दूँगी|बता\s*दूंगी|शेयर)"),
        # ---- Kannada
        ("callback", r"(?:ನಮ್ಮ\s*ಟೀಮ್|ಟೀಮ್|ಯಾರಾದರೂ)[^.?!]{0,30}(?:ಕಾಲ್|ಫೋನ್|ಸಂಪರ್ಕ|ಮಾತಾಡ|ಮೆಸೇಜ್)[^.?!]{0,15}(?:ಮಾಡ್ತಾರೆ|ಮಾಡುತ್ತಾರೆ|ಮಾಡ್ತಾರ|ಮಾಡ್ತೀನಿ|ಮಾಡುತ್ತೇವೆ)"),
        ("note", r"(?:ನೋಟ್|ಬರೆ)[^.?!]{0,15}(?:ಮಾಡ್ಕೊಳ್ತೀನಿ|ಮಾಡಿಕೊಳ್ಳುತ್ತೇನೆ|ಮಾಡ್ಕೋತೀನಿ|ಕೊಳ್ತೀನಿ)"),
        ("pass_on", r"(?:ನಿಮ್ಮ\s*ನಂಬರ್|ನಿಮ್ಮ\s*ವಿವರ)[^.?!]{0,25}(?:ಕೊಡ್ತೀನಿ|ಕೊಡುತ್ತೇನೆ|ಕಳಿಸ್ತೀನಿ|ಶೇರ್)"),
    )
)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", text).replace("‌", "").replace("‍", "")


def find(text: str) -> str | None:
    """The closed word of the first promise in `text`, or None."""
    line = _norm(text)
    for word, rx in _PATTERNS:
        if rx.search(line):
            return word
    return None


def safe_line(language: str, tone: str) -> str:
    """The true line said instead of a promise: 'I can't arrange that on this call.' in the call's language and tone."""
    options = SAFE.get(language, SAFE["en"])
    return options.get(tone) or options["friendly"]
