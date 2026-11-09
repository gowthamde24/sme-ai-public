"""The company's own name is never translated and never read as a number (owner, 6 Nov 2026: a Telugu call said "Stack పంతొమ్మిది").

Before ANY text goes to a voice engine (Cartesia or Sarvam), in every language: "Stack19", "Stack 19", "stack-19", the name written in an Indian script ("స్టాక్ 19", "स्टैक 19") or with the number spelled
out in a language ("Stack పంతొమ్మిది", "स्टैक उन्नीस") all become "Stack Nineteen" in Latin letters, which every voice says in English. This runs FIRST, before the numbers are spelled out.
Captions and the transcript keep the written text."""

# ruff: noqa: E501

from __future__ import annotations

import re

BRAND_SPOKEN = "Stack Nineteen"

_STACK = r"(?:(?<![A-Za-z])stack|స్టాక్|स्टैक|स्टॅक|स्टेक|ಸ್ಟಾಕ್|ಸ್ಟ್ಯಾಕ್|ಸ್ಟೇಕ್|ஸ்டாக்|സ്റ്റാക്ക്|സ്റ്റാക്)"
_NINETEEN = (r"(?:19(?!\d)|१९|౧౯|೧೯|௧௯|൧൯|nineteen|పంతొమ్మిది|పందొమ్మిది|నైన్[\u200c\u200d]?టీన్|నైంటీన్|उन्नीस|नाइनटीन|एकोणीस|ಹತ್ತೊಂಬತ್ತು|ಹತ್ತೊಂಭತ್ತು|ನೈನ್[\u200c\u200d]?ಟೀನ್|ನೈಂಟೀನ್|பத்தொன்பது|நைன்டீன்|പത്തൊമ്പത്|പത്തൊൻപത്|നൈൻറീൻ)")
_BRAND = re.compile(rf"{_STACK}[\s\-]*{_NINETEEN}", re.IGNORECASE)


def speak_brand(text: str) -> str:
    """Every way of writing the brand -> "Stack Nineteen" (Latin letters, said in English by every voice)."""
    return _BRAND.sub(BRAND_SPOKEN, text)
