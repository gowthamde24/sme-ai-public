"""Matching a spoken or typed name to the workspace's contacts, whatever the script (owner, 14 Nov 2026: "Yashwanth Reddy ki call cheyyi" said in Telugu is "యశ్వంత్ రెడ్డి").

A name is reduced to its CONSONANT SKELETON, the sounds that carry it: the vowels, the soft "h" and "y" and the doubled letters fall away, and Telugu, Hindi and Kannada letters are mapped to the same few
sounds as the Latin ones ( శ ష స and "sh" and "s" are one sound, ట త and "t" and "th" too, వ and "w" and "v"). "Yashwanth" and "యశ్వంత్" both become "svnt"; "Reddy" and "రెడ్డి" both become "rd".
Two names match when every word of the asked name matches a word of the contact's name (exactly, or very nearly: a spelling slip in a longer word). One word is enough ("Yashwanth" finds "Yashwanth Reddy").
Pure code, no model, no database: the same words always give the same answer."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

_LATIN_DIGRAPHS = (("sh", "s"), ("ch", "C"), ("th", "t"), ("dh", "d"), ("kh", "k"), ("gh", "g"), ("bh", "b"), ("ph", "p"), ("jh", "j"), ("ck", "k"), ("ee", "i"), ("oo", "u"))
_LATIN_SOUND = {"w": "v", "z": "s", "q": "k", "f": "p", "c": "k"}
_LATIN_DROP = set("aeiouyh")   # vowels and the soft sounds carry no weight

# the 33 consonants of each script in their fixed order (velar, palatal, retroflex, dental, labial, then y r l v sh ss s h) and the sound each one is; aspirates fold into their plain letter, dental and retroflex into one
_ORDER = ("k", "k", "g", "g", "n", "C", "C", "j", "j", "n", "t", "t", "d", "d", "n", "t", "t", "d", "d", "n", "p", "p", "b", "b", "m", "", "r", "l", "v", "s", "s", "s", "")
_SCRIPTS = ("కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరలవశషసహ", "ಕಖಗಘಙಚಛಜಝಞಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಲವಶಷಸಹ", "कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह")
_INDIC: dict[str, str] = {}
for _script in _SCRIPTS:
    for _ch, _sound in zip(_script, _ORDER, strict=True):
        _INDIC[_ch] = _sound
_INDIC.update({"ళ": "l", "ಳ": "l", "ळ": "l", "ఱ": "r", "ಱ": "r"})
_INDIC_NASAL = {"ం", "ಂ", "ं", "ँ"}


def _skeleton_latin(word: str) -> str:
    w = word.lower()
    for a, b in _LATIN_DIGRAPHS:
        w = w.replace(a, b)
    out: list[str] = []
    for ch in w:
        ch = _LATIN_SOUND.get(ch, ch)
        if ch in _LATIN_DROP or not ch.isalpha():
            continue
        out.append(ch)
    return _collapse("".join(out))


def _collapse(text: str) -> str:
    return re.sub(r"(.)\1+", r"\1", text)


def _skeleton_indic(word: str) -> str:
    out: list[str] = []
    for ch in word:
        if ch in _INDIC_NASAL:
            out.append("n")
        elif ch in _INDIC:
            out.append(_INDIC[ch])
    return _collapse("".join(out))


def _has_indic(word: str) -> bool:
    return any(0x0900 <= ord(ch) <= 0x0DFF for ch in word)


def words_of(name: str) -> list[str]:
    cleaned = unicodedata.normalize("NFC", name or "")
    return [p for p in re.split(r"[\s.,'’\-_/]+", cleaned) if p]


def skeleton(word: str) -> str:
    """The consonant skeleton of ONE word, in any of the scripts above."""
    if _has_indic(word):
        # a mixed word ("Reddyకి": the Latin name with a Telugu ending) keeps its Latin part only
        latin = "".join(ch for ch in word if ch.isascii() and ch.isalpha())
        return _skeleton_latin(latin) if len(latin) >= 2 else _skeleton_indic(word)
    return _skeleton_latin(word)


# a trailing "ki/ku/gaaru/garu" glued to a name in Latin Telugu ("Ravi ki call cheyyi") is not part of it; and the polite words are not names
_NOISE = {"ki", "ku", "ni", "garu", "gaaru", "gari", "mr", "mrs", "ms", "shri", "sri", "smt", "అన్న", "గారు", "గారికి"}
_SUFFIXES = ("కి", "కు", "ని", "గారికి", "గారు", "ಗೆ", "ಅವರಿಗೆ", "को")


def _strip_suffix(word: str) -> str:
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) > len(suffix) + 1:
            return word[: -len(suffix)]
    return word


def keys_of(name: str) -> list[str]:
    keys = []
    for word in words_of(name):
        word = _strip_suffix(word)
        if word.lower() in _NOISE:
            continue
        key = skeleton(word)
        if key:
            keys.append(key)
    return keys


def _near(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < 4:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.8


def matches(asked: str, name: str) -> bool:
    """Is `name` (a contact) the person `asked` for? Every word asked for must be one of the contact's words."""
    wanted = keys_of(asked)
    have = keys_of(name)
    if not wanted or not have:
        return False
    return all(any(_near(w, h) for h in have) for w in wanted)


def score(asked: str, name: str) -> float:
    """How close (0 to 1): 1 for the same words, lower when the contact has more words than were asked."""
    wanted, have = keys_of(asked), keys_of(name)
    if not wanted or not have or not matches(asked, name):
        return 0.0
    return len(wanted) / max(len(have), len(wanted))
