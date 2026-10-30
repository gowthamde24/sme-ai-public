"""From written text to what an engine is given (job pronunciation-quality): normalise (numbers, money, dates, times, units, abbreviations, links, emoji) -> the lexicon (script of the voice's language, a workspace's
own words, phoneme forms) -> for an ENGLISH voice only, the older English respellings of app/conversation/pronounce.py ("Kannada" -> "Kun-nuh-dah"). The caller's string is never changed in place; captions and the chat keep the
written text."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Iterable

from app.conversation.pronounce import Pronunciations, default_pronunciations
from app.pronunciation.lexicon import Lexicon, OwnerWord, shared
from app.pronunciation.normalise import normalise


class SpeechText:
    def __init__(self, legacy: Pronunciations | None = None, lexicon: Lexicon | None = None) -> None:
        self._legacy = legacy or default_pronunciations()
        self._lexicon = lexicon or shared()

    def with_owner_words(self, words: Iterable[OwnerWord]) -> SpeechText:
        return SpeechText(self._legacy, self._lexicon.with_owner_words(words))

    @property
    def lexicon(self) -> Lexicon:
        return self._lexicon

    def prepare(self, text: str, language: str, engine: str | None = None) -> str:
        """The text for `engine` (cartesia | sarvam_v4 | None) in a voice of `language`."""
        out = normalise(text, language)
        out = self._lexicon.apply(out, language, engine)
        return self._legacy.apply(out, language, engine) if language == "en" else out
