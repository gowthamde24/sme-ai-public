"""Which language an owner wrote in, and whether a reply is in it. Pure functions, decided by SCRIPT (the Unicode block of the letters), not by a model.

The assistant answers in the language of the owner's message: English, Telugu, Hindi, Kannada or Tamil. A message that mixes English words with an Indian script
(very common) counts as that script's language when at least two fifths of its words are in it. A message in Latin letters only is English (a romanised sentence
gets an English reply: the reply's script is what the check looks at). The code checks the reply too: a reply whose letters are not in the script of its stated
language is refused and asked for again, whatever the model says it wrote in."""

from __future__ import annotations

import unicodedata
from typing import Literal

Language = Literal["en", "te", "hi", "kn", "ta"]
LANGUAGES: tuple[Language, ...] = ("en", "te", "hi", "kn", "ta")

_BLOCKS: dict[Language, tuple[int, int]] = {
    "hi": (0x0900, 0x097F),  # Devanagari
    "ta": (0x0B80, 0x0BFF),  # Tamil
    "te": (0x0C00, 0x0C7F),  # Telugu
    "kn": (0x0C80, 0x0CFF),  # Kannada
}
INDIAN_SHARE = 0.25  # of all the letters of a REPLY (names and product words stay in Latin letters)


def _counts(text: str) -> tuple[dict[Language, int], int]:
    per: dict[Language, int] = {"en": 0, "hi": 0, "ta": 0, "te": 0, "kn": 0}
    letters = 0
    for ch in text:
        category = unicodedata.category(ch)
        if not (category.startswith("L") or category in ("Mn", "Mc")):
            continue
        code = ord(ch)
        placed = False
        for lang, (low, high) in _BLOCKS.items():
            if low <= code <= high:
                per[lang] += 1
                placed = True
                break
        if not placed and category.startswith("L"):
            per["en"] += 1
        if category.startswith("L") or placed:
            letters += 1
    return per, letters


def _tokens(text: str) -> list[Language]:
    """The script of each word of a text (a word = a run of letters and marks), by the script of most of its letters; digits and punctuation are not words."""
    words: list[Language] = []
    current: list[str] = []

    def flush() -> None:
        if not current:
            return
        per, _ = _counts("".join(current))
        words.append(max(per, key=lambda lang: per[lang]))
        current.clear()

    for ch in text:
        category = unicodedata.category(ch)
        if category.startswith("L") or category in ("Mn", "Mc"):
            current.append(ch)
        else:
            flush()
    flush()
    return words


INDIAN_WORD_SHARE = 0.4  # of all the words


def detect_language(text: str) -> Language:
    """The language of an owner's message, by WORDS: the Indian script that most words are written in, if those words are at least two fifths of all the words, else English.
    (Short questions mix an English product name with a few Indian-language words; counting words, not letters, keeps "Synthetic product ధర ఎంత?" Telugu, while an English
    sentence that merely contains one pasted Telugu name stays English.)"""
    words = _tokens(text)
    if not words:
        return "en"
    best: Language = max(("hi", "ta", "te", "kn"), key=lambda lang: words.count(lang))
    return best if words.count(best) / len(words) >= INDIAN_WORD_SHARE else "en"


def reply_matches(text: str, language: Language) -> bool:
    """Is a reply really written in `language`? English: letters are (almost) all Latin. An Indian language: its script is at least a quarter of the letters
    (the same share that makes a message count as that language; names and product words stay in Latin letters)."""
    per, letters = _counts(text)
    if letters == 0:
        return False
    if language == "en":
        return per["en"] / letters >= 0.9
    return per[language] / letters >= INDIAN_SHARE


# Fixed phrases, written once, in each language: what the assistant says when it will not guess, cannot do something, or has no answer to show. They are not model output.
NO_ANSWER: dict[Language, str] = {
    "en": "I could not find that in your records, so I will not guess.",
    "te": "ఇది మీ రికార్డుల్లో నాకు కనిపించలేదు, అందుకే ఊహించి చెప్పను.",
    "hi": "यह मुझे आपके रिकॉर्ड में नहीं मिला, इसलिए मैं अंदाज़ा नहीं लगाऊँगा।",
    "kn": "ಇದು ನಿಮ್ಮ ದಾಖಲೆಗಳಲ್ಲಿ ನನಗೆ ಸಿಗಲಿಲ್ಲ, ಹಾಗಾಗಿ ನಾನು ಊಹಿಸುವುದಿಲ್ಲ.",
    "ta": "இது உங்கள் பதிவுகளில் எனக்குக் கிடைக்கவில்லை, அதனால் நான் ஊகிக்க மாட்டேன்.",
}
