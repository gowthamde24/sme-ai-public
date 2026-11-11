"""The never-say list as a HARD rule (owner, 5 Nov 2026): every line the assistant is about to speak is checked by code before it reaches the voice. A line that holds a never-say phrase is not spoken;
a short safe line is said instead and the block is counted (never the phrase or the line in the log)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import AsyncIterator, Sequence
from typing import Any

logger = logging.getLogger("app.talk_training.guard")

SAFE = {
    "en": "Let me check that with the team and get back to you.",
    "te": "దాని గురించి మా టీమ్‌తో కనుక్కుని మీకు చెప్తానండీ.",
    "hi": "इसके बारे में मैं टीम से पूछकर आपको बताती हूँ।",
    "kn": "ಅದರ ಬಗ್ಗೆ ಟೀಮ್ ಜೊತೆ ಕೇಳಿ ನಿಮಗೆ ಹೇಳುತ್ತೇನೆ.",
    "ta": "அதைப் பற்றி டீமிடம் கேட்டு உங்களுக்குச் சொல்கிறேன்.",
    "ml": "അതിനെക്കുറിച്ച് ടീമിനോട് ചോദിച്ച് നിങ്ങളോട് പറയാം.",
    "mr": "याबद्दल मी टीमला विचारून तुम्हाला सांगते.",   # job M1: a draft for a native reader
}


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"[^\w%₹]+", " ", text)
    return f" {' '.join(text.split())} "


def violates(text: str, never_say: Sequence[str]) -> bool:
    """True when the line holds a never-say phrase as whole words (case, spaces and punctuation do not matter)."""
    line = _norm(text)
    return any(p.strip() and _norm(p) in line for p in never_say)


def safe_line(text: str, never_say: Sequence[str], language: str) -> str:
    if never_say and violates(text, never_say):
        logger.info("never_say blocked a line: language=%s", language)
        return SAFE.get(language, SAFE["en"])
    return text


class GuardedTts:
    """The voice, with the never-say check in front of it: each sentence sent to be spoken is checked first."""

    def __init__(self, inner: Any, never_say: Sequence[str], *, goal_tone: str | None = None) -> None:
        self._inner, self._never = inner, list(never_say)
        self._goal_tone = goal_tone   # set on an OUTBOUND goal call: no promise is spoken, and the tone's particles are taken out (app/telephony/promises.py, tone.py)
        self.sample_rate = getattr(inner, "sample_rate", 24000)
        self.blocked = 0
        self.promises_blocked = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def stream(self, text: str, language: str, *args: Any, **kwargs: Any) -> AsyncIterator[bytes]:
        said = safe_line(text, self._never, language)
        if said != text:
            self.blocked += 1
            if self._goal_tone is not None:   # (the usual safe line says "I will check with the team and get back to you": a promise a goal call cannot keep)
                from app.telephony import promises

                said = promises.safe_line(language, self._goal_tone)
        elif self._goal_tone is not None:
            from app.telephony import promises, tone

            word = promises.find(text)
            if word is not None:
                self.promises_blocked += 1
                logger.info("promise blocked: kind=%s language=%s tone=%s", word, language, self._goal_tone)   # the closed word only, never the line
                said = promises.safe_line(language, self._goal_tone)
            else:
                said = tone.soften(text, self._goal_tone, language)
        result: AsyncIterator[bytes] = self._inner.stream(said, language, *args, **kwargs)
        return result
