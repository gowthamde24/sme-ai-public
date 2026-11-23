"""Apologising naturally after a mishearing (humanness audit item 4, 23 Nov 2026).

The caller spoke for a real stretch (>= MIN_SPEECH_MS) but the recogniser returned NO words: a person would say "sorry, I didn't catch that, could you say it again?", not stay silent.
A pure rule, so it is tested without a call: once per SPACING_S, at most MAX_PER_CALL a call, never twice in a row (a real turn must come in between), and the two lines per language
alternate so a second apology is not the same sentence. The wording is in the spoken style of each language (English business words kept); DRAFTS for native review (owner's wording rule).
"""

# ruff: noqa: E501
from __future__ import annotations

from dataclasses import dataclass, field

MIN_SPEECH_MS = 800      # shorter sounds are noise, a cough, a breath: no apology
SPACING_S = 30.0         # at most one apology in this time
MAX_PER_CALL = 3         # a line this bad is not helped by a fourth "sorry"

LINES: dict[str, tuple[str, str]] = {
    "en": ("Sorry, I didn't catch that. Could you say it again?", "Sorry, the line is a bit unclear. One more time please?"),
    "te": ("సారీ అండీ, సరిగ్గా వినపడలేదు. మళ్ళీ చెప్తారా?", "సారీ, లైన్ కొంచెం క్లియర్ గా లేదు. ఇంకోసారి చెప్పండి?"),
    "hi": ("सॉरी, ठीक से सुनाई नहीं दिया। फिर से बताइए?", "सॉरी, लाइन थोड़ी साफ़ नहीं है। एक बार और बोलिए?"),
    "kn": ("ಸಾರಿ, ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ಮತ್ತೊಮ್ಮೆ ಹೇಳ್ತೀರಾ?", "ಸಾರಿ, ಲೈನ್ ಸ್ವಲ್ಪ ಕ್ಲಿಯರ್ ಇಲ್ಲ. ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ?"),
    "ta": ("சாரி, சரியா கேக்கலை. மறுபடி சொல்றீங்களா?", "சாரி, லைன் கொஞ்சம் தெளிவா இல்ல. இன்னொரு தடவை சொல்லுங்க?"),
    "ml": ("സോറി, ശരിയായി കേട്ടില്ല. ഒന്നുകൂടി പറയാമോ?", "സോറി, ലൈൻ വ്യക്തമല്ല. ഒരിക്കൽ കൂടി പറയൂ?"),
    "mr": ("सॉरी, नीट ऐकू आलं नाही. पुन्हा सांगाल का?", "सॉरी, लाइन थोडी क्लिअर नाही. एकदा परत सांगा?"),
}


def lines_of(language: str) -> tuple[str, str]:
    return LINES.get(language) or LINES["en"]


@dataclass
class Apology:
    enabled: bool = True
    said: int = 0
    _last_at: float | None = None
    _last_was_apology: bool = False
    _history: list[float] = field(default_factory=list)

    def should(self, speech_ms: int, text: str | None, now: float) -> bool:
        """True when this empty turn deserves an apology; call `spoke()` once it is said."""
        if not self.enabled or (text or "").strip() or speech_ms < MIN_SPEECH_MS:
            return False
        if self.said >= MAX_PER_CALL or self._last_was_apology:
            return False
        return self._last_at is None or now - self._last_at >= SPACING_S

    def spoke(self, now: float) -> None:
        self.said += 1
        self._last_at = now
        self._last_was_apology = True

    def heard(self) -> None:
        """A real turn came in: the next mishearing may be apologised for again (after the spacing)."""
        self._last_was_apology = False

    def line(self, language: str) -> str:
        return lines_of(language)[self.said % 2]
