"""Which language a phone call speaks (owner, 6 Nov 2026, after a Telugu call switched to English because the caller said "hello"):

  1. A call starts in the line's default language and STAYS in it.
  2. Greetings and fillers say nothing about the language: hello, hi, ok, okay, yes, no, haan, hmm, sorry, thank you, thanks (and "can you hear me", the phone's own hello).
  3. Code-mixed speech counts as its MAIN language: any Indian script in the turn wins over English words ("Price ఎంత?" is Telugu); romanised Telugu or Hindi counts as that language.
  4. The call switches only when the caller (a) asks for a language ("English lo matladandi", "please speak English", "हिंदी में बात करो"), or (b) says a full sentence (3 or more words
     after the fillers) in another language TWICE IN A ROW (owner's later rule, 6 Nov 2026).
  5. The assistant never says it cannot speak a supported language (the prompt says so; this rule makes the switch happen).

Pure: text in, a decision out. The turn's words are never logged; the decision is (codes and a reason word)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass

from app.assistant.language import ROMAN_WORDS, _counts

SUPPORTED = ("te", "kn", "ta", "ml", "hi", "en", "mr")

FILLERS = frozenset({"hello", "hallo", "helo", "hello?", "hi", "hey", "ok", "okay", "okey", "yes", "yeah", "yep", "no", "haan", "ha", "han", "hmm", "hm", "hmmm", "umm", "um", "sorry", "thanks",
                     "హలో", "హాయ్", "ఓకే", "సారీ", "థాంక్స్", "హా", "ఆ", "हेलो", "हैलो", "हाँ", "हां", "ओके", "सॉरी", "थैंक्स", "ಹಲೋ", "ಓಕೆ", "ஹலோ", "ஓகே", "ഹലോ", "ഓക്കെ"})
FILLER_PHRASES = ("thank you", "can you hear me", "are you there", "hello hello")

# a language named, in its own script, in Latin letters, or in the line's language
NAMES: dict[str, tuple[str, ...]] = {
    "te": ("telugu", "తెలుగు", "तेलुगु", "ತೆಲುಗು", "தெலுங்கு", "തെലുങ്ക്"),
    "en": ("english", "inglish", "ఇంగ్లీష్", "ఇంగ్లిష్", "अंग्रेजी", "अंग्रेज़ी", "इंग्लिश", "ಇಂಗ್ಲಿಷ್", "ஆங்கிலம்", "ഇംഗ്ലീഷ്"),
    "hi": ("hindi", "హిందీ", "हिंदी", "हिन्दी", "ಹಿಂದಿ", "இந்தி", "ഹിന്ദി"),
    "kn": ("kannada", "కన్నడ", "कन्नड़", "ಕನ್ನಡ", "கன்னடம்", "കന്നഡ"),
    "ta": ("tamil", "తమిళం", "తమిళ్", "तमिल", "ತಮಿಳು", "தமிழ்", "തമിഴ്"),
    "ml": ("malayalam", "మలయాళం", "मलयालम", "ಮಲಯಾಳಂ", "மலையாளம்", "മലയാളം"),
    "mr": ("marathi", "మరాఠీ", "मराठी", "ಮರಾಠಿ", "மராத்தி", "മറാഠി"),
}
# words that make a named language a REQUEST ("speak", "talk", "in", "lo", "matladandi", "बात करो", "ಮಾತನಾಡಿ", "பேசுங்க", "സംസാരിക്കൂ")
ASK = re.compile(r"speak|talk|\bin\b|\blo\b|matlad|maatlad|మాట్లాడ|లో\b|baat|bolo|boliye|बात|बोल|में|maatan|ಮಾತನಾಡ|ನಲ್ಲಿ|pesu|பேசு|ல\b|samsar|സംസാര|ൽ\b|please|plz|can you", re.IGNORECASE)
_WORD = re.compile(r"[^\W\d_]+(?:[ऀ-෿‌‍]*)", re.UNICODE)


@dataclass(frozen=True)
class Decision:
    switch_to: str | None   # the language to switch to now, or None (stay)
    why: str                # request | two_sentences | "" (stayed)
    heard: str | None       # the turn's main language after fillers (None: only fillers, or nothing)
    streak: tuple[str | None, int]   # (another language heard, how many turns in a row) to carry to the next turn


def content_words(text: str) -> list[str]:
    low = " ".join(text.casefold().split())
    for phrase in FILLER_PHRASES:
        low = low.replace(phrase, " ")
    return [w for w in _WORD.findall(low) if w not in FILLERS]


def requested(text: str) -> str | None:
    """A language the caller asked for ("please speak English", "Telugu lo matladandi", "हिंदी में बात करो"), else None."""
    low = text.casefold()
    named = [lang for lang, names in NAMES.items() if any(n in low for n in names)]
    if len(named) != 1:
        return None   # none, or two named ("not English, Telugu") is not a clear request: the sentence rule decides
    words = content_words(text)
    if ASK.search(low) or len(words) <= 2:
        return named[0]
    return None


def main_language(words: list[str]) -> str | None:
    """The turn's main language: an Indian script wins (code-mixed counts as it); else romanised words of one language; else English. None when nothing is left."""
    if not words:
        return None
    text = " ".join(words)
    per, _letters = _counts(text)
    indian = {lang: n for lang, n in per.items() if lang != "en" and n > 0}
    if indian:
        return max(indian, key=lambda k: indian[k])   # (Devanagari counts as Hindi; Marathi is reached by asking for it)
    latin = [w for w in words if w.isascii()]
    hits = {lang: sum(1 for w in latin if w in lexicon) for lang, lexicon in ROMAN_WORDS.items()}
    lang, n = max(hits.items(), key=lambda kv: kv[1])
    if n >= 1 and n / max(1, len(latin)) >= 0.25:
        return lang
    return "en"


def decide(current: str, text: str, streak: tuple[str | None, int] = (None, 0)) -> Decision:
    asked = requested(text)
    if asked is not None and asked in SUPPORTED:
        return Decision(asked if asked != current else None, "request" if asked != current else "", asked, (None, 0))
    words = content_words(text)
    heard = main_language(words)
    if heard is None:
        return Decision(None, "", None, streak)   # only greetings or fillers: says nothing, changes nothing
    if heard == current or heard not in SUPPORTED:
        return Decision(None, "", heard, (None, 0))   # the call's own language (code-mixed included): stay, and a run of another language ends
    if len(words) < 3:
        return Decision(None, "", heard, streak)   # a few words in another language are not a switch, and do not count towards one
    run = streak[1] + 1 if streak[0] == heard else 1
    if run >= 2:
        return Decision(heard, "two_sentences", heard, (None, 0))
    return Decision(None, "", heard, (heard, run))
