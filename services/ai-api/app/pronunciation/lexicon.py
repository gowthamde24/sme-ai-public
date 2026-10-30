"""The pronunciation lexicon (job pronunciation-quality): words an engine gets wrong, in two layers. A SHARED layer ships with the product (districts and towns of Andhra Pradesh, Telangana, Karnataka, Tamil Nadu and Kerala,
common personal names, pack vocabulary, brand words; data/lexicon.json). A WORKSPACE layer is the owner's own words ("word" + "sounds like", Hear it), and wins over the shared one.

What it does for a voice speaking `language`:
  * SCRIPT: a place or name is written in the script of the voice's language when the lexicon knows that spelling (a Telugu voice that meets "Dharmavaram" in Latin letters hears ధర్మవరం; an English voice that meets
    ధర్మవరం hears "Dharmavaram"). Each spelling variant ("Ananthapuramu", "Bangalore") finds the same entry.
  * SOUND: an entry may carry a respelling (`sounds_like`) or an engine's own phoneme form (`phonemes`, Cartesia IPA) for a language; that is what the engine is given.
  * A workspace word is one respelling for one language (or for all of them).

One pass over the text with ONE pattern, longest spelling first, so nothing that was just written is rewritten again. Pure text in, text out: no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "lexicon.json"
LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml")
_LETTERS = r"\wऀ-෿‌‍"   # a letter of any script, its signs, and the joiners
SOUND_MAX = 80


@dataclass(frozen=True)
class Entry:
    word: str
    kind: str = "word"
    forms: Mapping[str, str] = field(default_factory=dict)         # the word in the script of each language (Latin for en)
    aliases: tuple[str, ...] = ()                                    # other spellings of it
    sounds_like: Mapping[str, str] = field(default_factory=dict)   # a respelling per voice language
    phonemes: Mapping[str, str] = field(default_factory=dict)      # an engine's phoneme form per voice language (cartesia)
    verified: bool = False

    def spellings(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(s for s in (self.word, *self.aliases, *self.forms.values()) if s and s.strip()))


@dataclass(frozen=True)
class OwnerWord:
    """A word the workspace added: how it should sound, for one language or (None) for all."""

    word: str
    sounds_like: str
    language: str | None = None


def _clean_entry(raw: Mapping[str, object]) -> Entry:
    def mapping(key: str) -> dict[str, str]:
        value = raw.get(key) or {}
        if not isinstance(value, dict) or not all(isinstance(k, str) and k in LANGUAGES and isinstance(v, str) and v.strip() for k, v in value.items()):
            raise ValueError(f"lexicon: {key} of {raw.get('word')!r} must map a language code to text")
        return dict(value)

    word = raw.get("word")
    if not isinstance(word, str) or not word.strip():
        raise ValueError("lexicon: every entry needs a word")
    aliases = raw.get("aliases") or []
    if not isinstance(aliases, list) or not all(isinstance(a, str) and a.strip() for a in aliases):
        raise ValueError(f"lexicon: aliases of {word!r} must be a list of words")
    return Entry(word=word, kind=str(raw.get("kind") or "word"), forms=mapping("forms"), aliases=tuple(aliases), sounds_like=mapping("sounds_like"), phonemes=mapping("phonemes"), verified=bool(raw.get("verified")))


def load(path: str | Path | None = None) -> tuple[Entry, ...]:
    data = json.loads(Path(path or DATA).read_text(encoding="utf-8"))
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise ValueError("lexicon: 'entries' must be a list")
    return tuple(_clean_entry(e) for e in entries)


def _fold(text: str) -> str:
    return text.casefold()


class Lexicon:
    def __init__(self, entries: Iterable[Entry] = (), owner: Iterable[OwnerWord] = ()) -> None:
        self.entries = tuple(entries)
        self.owner = tuple(owner)
        self._compiled: dict[tuple[str, str | None], tuple[re.Pattern[str] | None, dict[str, str]]] = {}

    def with_owner_words(self, owner: Iterable[OwnerWord]) -> Lexicon:
        """The shared entries plus a workspace's own words (replacing any earlier owner words)."""
        words = tuple(w for w in owner if w.word.strip() and w.sounds_like.strip())
        return Lexicon(self.entries, words) if words or self.owner else self

    def find(self, word: str) -> Entry | None:
        key = _fold(word)
        return next((e for e in self.entries if any(_fold(s) == key for s in e.spellings())), None)

    def _table(self, language: str, engine: str | None) -> tuple[re.Pattern[str] | None, dict[str, str]]:
        key = (language, engine)
        if key in self._compiled:
            return self._compiled[key]
        table: dict[str, str] = {}
        for entry in self.entries:
            target = self._target(entry, language, engine)
            for spelling in entry.spellings():
                # a spelling in ANOTHER Indian script than the voice's own, with no spelling known for the voice's language, is given in Latin letters (the engines read those; they do not read a foreign script)
                shown = target if target is not None else (entry.forms.get("en") if _foreign_script(spelling, entry, language) else None)
                if shown is not None and _fold(spelling) != _fold(shown):
                    table.setdefault(_fold(spelling), shown)
        for word in self.owner:   # the workspace's own word wins over the shared entry for the same spelling
            if word.language in (None, language):
                table[_fold(word.word.strip())] = word.sounds_like.strip()
        keys = sorted(table, key=len, reverse=True)
        pattern = re.compile(rf"(?<![{_LETTERS}])(" + "|".join(re.escape(k) for k in keys) + rf")(?![{_LETTERS}])", re.IGNORECASE) if keys else None
        self._compiled[key] = (pattern, table)
        return self._compiled[key]

    @staticmethod
    def _target(entry: Entry, language: str, engine: str | None) -> str | None:
        """What an engine is given for this entry in a voice of `language`: its phoneme form, else a respelling, else the spelling in the language's own script; None = leave the text alone."""
        if engine == "cartesia" and language in entry.phonemes:
            return f"<<{entry.phonemes[language]}>>"
        if language in entry.sounds_like:
            return entry.sounds_like[language]
        form = entry.forms.get(language)
        if form:
            return form
        # a word with no spelling in this language stays as it is, except that an English voice is given the Latin spelling of a word it met in another script
        return entry.forms.get("en") if language == "en" else None

    def apply(self, text: str, language: str = "en", engine: str | None = None) -> str:
        pattern, table = self._table(language, engine)
        if pattern is None:
            return text
        return pattern.sub(lambda m: table[_fold(m.group(1))], text)


def _foreign_script(spelling: str, entry: Entry, language: str) -> bool:
    return any(ord(c) >= 0x0900 for c in spelling) and spelling != entry.forms.get(language)


@lru_cache(maxsize=1)
def shared() -> Lexicon:
    return Lexicon(load())
