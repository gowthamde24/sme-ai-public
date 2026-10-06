"""What capture stores (T008, owner review of commit 3): the pasted text with every invisible character removed, then scrubbed of contacts.

The database refuses invisible characters in free text (`app.text_is_clean`: zero-width space, bidi embeddings / overrides / isolates, word
joiner, BOM, tag characters, control characters) and, deliberately, ACCEPTS the zero-width joiner and non-joiner (U+200D / U+200C) and the
direction marks LRM / RLM, because Indic and Persian scripts use them to spell words. Capture does not refuse an enquiry for any of this: it
STRIPS, and stores the stripped text. Every offset (the runtime's quote finder, the database's verification) is against the STORED text.

What is hidden is decided by the ONE shared rule (`app/text_rules.py`, also used by the CSV imports): control characters (but tab, line feed and
carriage return stay), every format character (Cf: zero-width space, LRM / RLM, bidi embeddings, overrides and isolates, word joiner and invisible
operators, BOM, soft hyphen, tag characters), private-use, unassigned and surrogate code points. U+2028 / U+2029 become a line feed.

Owner decision 2026-10-06: **a pasted enquiry KEEPS the zero-width joiner and non-joiner (U+200D / U+200C) where they spell a word**: a joiner that
FOLLOWS a letter or a mark of an Indic script (Devanagari to Sinhala), including at the end of a word (a Malayalam chillu, a Kannada word before a space).
Anywhere else a joiner is still removed: inside a number or between Latin letters it could hide a phone number or an address from the scrubber, and it spells
nothing. Set KEEP_INDIC_JOINERS = False to remove them everywhere.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from app.requirements.scrub import scrub
from app.text_rules import has_hidden_characters

KEEP_INDIC_JOINERS = True  # owner decision 2026-10-06
MAX_BODY_CHARS = 6000
MAX_SUBJECT_CHARS = 200
_KEEP_WHITESPACE = frozenset("\t\n\r")
_JOINERS = frozenset("‌‍")
# Devanagari .. Sinhala (the blocks of the Indic scripts the wholesale trade writes in)
_INDIC = (0x0900, 0x0DFF)


def _indic(ch: str) -> bool:
    return _INDIC[0] <= ord(ch) <= _INDIC[1] and unicodedata.category(ch)[0] in "LM"


def strip_invisible(text: str) -> str:
    out: list[str] = []
    for ch in text:
        if ch in _KEEP_WHITESPACE:
            out.append(ch)
        elif ch in "\u2028\u2029":
            out.append("\n")
        elif ch in _JOINERS:
            # kept only after a letter or a mark of an Indic script (and never twice in a row: the second follows a joiner, not a letter)
            if KEEP_INDIC_JOINERS and out and _indic(out[-1]):
                out.append(ch)
        elif has_hidden_characters(ch, allow_newline=False):
            continue
        else:
            out.append(ch)
    return "".join(out)


@dataclass(frozen=True)
class Prepared:
    text: str
    # the length before the cut when the text was longer than the limit (the screen says so); None otherwise
    truncated_from: int | None


def _prepare(raw: str, limit: int) -> Prepared:
    stripped = strip_invisible(raw).strip(" \t\r\n")
    # a paste of any size is handled in linear time: only a bounded head is scrubbed (the kept text is the first `limit` characters,
    # and scrubbing only ever shortens text, so nothing the cut keeps comes from beyond the head)
    head = stripped[: limit * 4]
    text = scrub(head).strip(" \t\r\n")
    if len(stripped) > limit:
        return Prepared(text[:limit].rstrip(" \t\r\n"), len(stripped))
    return Prepared(text, None)


def prepare_body(raw: str) -> Prepared:
    """The text to store for an enquiry body: invisible characters stripped, contacts scrubbed, cut at 6,000 characters."""
    return _prepare(raw, MAX_BODY_CHARS)


def prepare_subject(raw: str) -> str | None:
    """The subject to store: the same cleaning, one line, at most 200 characters; None when nothing is left."""
    text = " ".join(_prepare(raw, MAX_SUBJECT_CHARS).text.split())
    return text or None
