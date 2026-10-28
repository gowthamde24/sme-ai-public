"""(b) Mid-call language switch and (j) Marathi and Bengali: detect the language the customer is speaking from the script of what they said, and decide whether to switch. The voice persona never changes on a
switch ("same voice"). Marathi shares Devanagari with Hindi: a few very common Marathi words decide. Pure."""

from __future__ import annotations

import re
from dataclasses import dataclass

SCRIPTS = (
    ("te", re.compile(r"[ఀ-౿]")),
    ("kn", re.compile(r"[ಀ-೿]")),
    ("ta", re.compile(r"[஀-௿]")),
    ("ml", re.compile(r"[ഀ-ൿ]")),
    ("bn", re.compile(r"[ঀ-৿]")),
)
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
MARATHI_WORDS = re.compile(r"(आहे|आहेत|नाही|काय|तुम्ही|मला|आम्ही|करा|होय|कुठे|किती)")
LATIN = re.compile(r"[A-Za-z]")


def detect_language(text: str) -> str | None:
    """The language of the words, or None when there is too little to tell. English words inside another script (the everyday mixing) do not change the answer: the other script wins."""
    counts = {lang: len(rx.findall(text)) for lang, rx in SCRIPTS}
    dev = len(DEVANAGARI.findall(text))
    latin = len(LATIN.findall(text))
    best = max(counts, key=lambda k: counts[k])
    if counts[best] >= 3 and counts[best] >= dev:
        return best
    if dev >= 3:
        return "mr" if MARATHI_WORDS.search(text) else "hi"
    if latin >= 8 and not any(counts.values()) and not dev:
        return "en"
    return None


@dataclass(frozen=True)
class Switch:
    language: str
    switched: bool
    voice_persona_changed: bool = False


def switch_decision(current: str, heard: list[str], *, auto_switch: bool) -> Switch:
    """Switch after the customer's last TWO turns are in the same other language (one stray sentence is not a switch). `heard` is the detected language of each customer turn, newest last."""
    if auto_switch and len(heard) >= 2 and heard[-1] == heard[-2] and heard[-1] is not None and heard[-1] != current:
        return Switch(heard[-1], True)
    return Switch(current, False)
