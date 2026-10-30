"""The round trip that catches gross pronunciation errors (job pronunciation-quality): speak a sentence, let the speech recogniser write down what it heard, compare it with what was meant. Pure functions here (no network, no key);
scripts/pronunciation_qa.py does the speaking and listening.

A recogniser cannot hear accent or vowel quality, so this finds the big errors (a place read as another word, a number said wrongly, a word dropped) and ranks the rest for the weekly human review (scripts/pronunciation_review_*.py)."""

# ruff: noqa: E501

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field

_PUNCT = re.compile(r"[^\wऀ-෿\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")
_JOINERS = dict.fromkeys(map(ord, "‌‍"))
PASS_SCORE = 0.82   # a recogniser spells the same sounds in slightly different ways; below this the clip is listed for a human


def canon(text: str) -> str:
    """Words only, lower-case, no punctuation, no joiners, one space between words."""
    t = unicodedata.normalize("NFC", text).translate(_JOINERS).casefold()
    return _SPACES.sub(" ", _PUNCT.sub(" ", t)).strip()


_LATIN_WORD = re.compile(r"[a-z]+", re.IGNORECASE)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _script_of(text: str) -> str:
    """The Indian script a text is mostly written in, or 'latin'."""
    for ch in text:
        o = ord(ch)
        for lo, hi, name in ((0x0900, 0x097F, "hi"), (0x0C00, 0x0C7F, "te"), (0x0C80, 0x0CFF, "kn"), (0x0B80, 0x0BFF, "ta"), (0x0D00, 0x0D7F, "ml")):
            if lo <= o <= hi:
                return name
    return "latin"


def _native(text: str) -> str:
    """Without the Latin words: a recogniser writes the English words of a code-mixed sentence in the language's script ("check" -> "చెక్"), so they are not compared."""
    return canon(_LATIN_WORD.sub(" ", text))


def similarity(expected: str, heard: str, *, native_only: bool = False) -> float:
    """0..1: how much of what was meant was heard. Letter-level (not word-level) so that a spelling variant of the same word still scores high. `native_only` leaves out the Latin words of both sides."""
    a, b = (_native(expected), _native(heard)) if native_only else (canon(expected), canon(heard))
    a, b = a.replace(" ", ""), b.replace(" ", "")
    if not a:
        return 1.0
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    if native_only:   # what was meant must be heard; the recogniser's own transliteration of the English words is extra, not a fault
        return sum(block.size for block in matcher.get_matching_blocks()) / len(a)
    return matcher.ratio()


def numbers_heard(written: str, heard: str) -> float:
    """The share of the numbers of the WRITTEN text that the recogniser wrote back (it writes spoken numbers as digits: "one lakh twenty thousand" -> 120000). 1.0 when the text has no number."""
    want = _NUMBER.findall(written.replace(",", ""))
    if not want:
        return 1.0
    got = set(_NUMBER.findall(heard.replace(",", "")))
    flat = heard.replace(",", "").replace(" ", "")
    return sum(1 for n in want if n in got or n in flat) / len(want)


def word_heard(spellings: list[str], heard: str, threshold: float = 0.8) -> bool:
    """Does the transcript contain the word, written in ANY of its accepted spellings (aliases, the Latin form, the language's own script)? An ending the recogniser added ("ಧಾರವಾಡದಿಂದ" for "ಧಾರವಾಡ") does not matter."""
    flat = canon(heard).replace(" ", "")
    for spelling in spellings:
        target = canon(spelling).replace(" ", "")
        if not target:
            continue
        size = len(target)
        windows = [flat[i : i + size] for i in range(max(1, len(flat) - size + 1))] + ([flat[i : i + size - 1] for i in range(max(1, len(flat) - size + 2))] if size > 4 else [])
        if any(difflib.SequenceMatcher(None, target, w, autojunk=False).ratio() >= threshold for w in windows if w):
            return True
    return False


@dataclass
class Result:
    id: str
    language: str
    voice: str
    kind: str                 # lexicon | sentence | normaliser
    written: str              # what the product would show
    spoken: str               # what the engine was given
    heard: str                # what the recogniser wrote
    score: float
    key_ok: bool | None = None            # a lexicon entry: was the word itself heard
    spellings: list[str] = field(default_factory=list)
    chars: int = 0
    clip: str = ""

    @property
    def ok(self) -> bool:
        return self.score >= PASS_SCORE and self.key_ok is not False


def score(item_id: str, language: str, voice: str, kind: str, written: str, spoken: str, heard: str, spellings: list[str] | None = None) -> Result:
    """One clip. A sentence is compared without its Latin words; a text with numbers by the numbers the recogniser wrote back; a lexicon word by its accepted spellings IN THE SCRIPT THE VOICE'S LANGUAGE USES (a Hindi voice that was
    given a Latin name has no Devanagari spelling to look for: the word is then not checked on its own, the sentence score stands)."""
    own = [sp for sp in (spellings or []) if _script_of(sp) == ("latin" if language == "en" else language) or (language != "en" and _script_of(sp) == "latin" and _script_of(heard) == "latin")]
    base = similarity(spoken, heard, native_only=language != "en")
    if kind == "normaliser":
        base = max(base, numbers_heard(written, heard) * 0.95 if _NUMBER.search(written) else base)
    return Result(item_id, language, voice, kind, written, spoken, heard, round(base, 3), word_heard(own, heard) if own else None, list(spellings or []), len(spoken))


def rank(results: list[Result]) -> list[Result]:
    """The riskiest first: a missed key word, then the lowest score."""
    return sorted(results, key=lambda r: (r.key_ok is not False, r.score))


def report(results: list[Result], *, title: str, chars_sent: int) -> str:
    languages = sorted({r.language for r in results})
    lines = [f"# {title}", "", f"{len(results)} clips, {sum(r.ok for r in results)} passed, {sum(not r.ok for r in results)} listed below. Characters sent to Cartesia: {chars_sent}.", "",
             "The recogniser (Sarvam) cannot hear accent or vowel quality: a pass means the right words were heard, not that the sound is perfect. The ranked list is what a native listener should hear first.", ""]
    for lang in languages:
        rows = [r for r in results if r.language == lang]
        lines += [f"## {lang}: {sum(r.ok for r in rows)} of {len(rows)} passed (voice {rows[0].voice})", ""]
        bad = rank([r for r in rows if not r.ok])
        if not bad:
            lines += ["No gross errors.", ""]
        for r in bad:
            lines += [f"- **{r.id}** ({r.kind}, score {r.score}{', the word itself was not heard' if r.key_ok is False else ''})", f"  - meant: {r.spoken}", f"  - heard: {r.heard}"]
        lines.append("")
    return "\n".join(lines)
