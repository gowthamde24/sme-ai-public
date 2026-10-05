"""What capture stores (T008, owner review of commit 3): the pasted text with every invisible character removed, then scrubbed of contacts.

The database refuses invisible characters in free text (`app.text_is_clean`: zero-width space, bidi embeddings / overrides / isolates, word
joiner, BOM, tag characters, control characters) and, deliberately, ACCEPTS the zero-width joiner and non-joiner (U+200D / U+200C) and the
direction marks LRM / RLM, because Indic and Persian scripts use them to spell words. Capture does not refuse an enquiry for any of this: it
STRIPS, and stores the stripped text. Every offset (the runtime's quote finder, the database's verification) is against the STORED text.

Stripped: every control character except tab, line feed and carriage return; every format character (Unicode category Cf: zero-width
space / non-joiner / joiner, LRM / RLM, bidi embeddings, overrides and isolates, word joiner and invisible operators, BOM, soft hyphen, tag
characters); private-use, unassigned and surrogate code points. U+2028 / U+2029 become a line feed.

The cost, stated plainly (owner decision pending): ZWJ and ZWNJ are functional in Devanagari, Telugu, Kannada, Malayalam and Persian text.
Without them a conjunct or a half form can render differently (the letters and their order are unchanged, so the text stays readable and
searchable). Set KEEP_INDIC_JOINERS = True to keep a joiner that sits between two letters or marks of an Indic script; it is False by default.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from app.requirements.scrub import scrub

KEEP_INDIC_JOINERS = False
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
    for i, ch in enumerate(text):
        if ch in _KEEP_WHITESPACE:
            out.append(ch)
        elif ch in "  ":
            out.append("\n")
        elif (
            KEEP_INDIC_JOINERS
            and ch in _JOINERS
            and out
            and _indic(out[-1])
            and i + 1 < len(text)
            and _indic(text[i + 1])
        ):
            out.append(ch)
        elif unicodedata.category(ch) in {"Cc", "Cf", "Cs", "Co", "Cn"}:
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
