"""Quotes: whitespace-normalised, first-occurrence offsets (owner change C).

The model gives the quote as a STRING; the runtime finds where it is in the stored (scrubbed) enquiry text. A quote that is not
there is not a quote. The database verifies the same thing again (`agent_write_requirement_field`, next migration):
`normalise_ws(body[start:end]) = normalise_ws(quote)`. Whitespace is exactly space, tab, CR and LF in both places, so the two
cannot disagree about what "the same words" means. Matching is otherwise exact (case and characters).
"""

from __future__ import annotations

_WS = frozenset(" \t\r\n")
MAX_QUOTE_CHARS = 300


def normalise_ws(text: str) -> str:
    """Runs of space / tab / CR / LF become one space; leading and trailing whitespace goes."""
    out: list[str] = []
    pending = False
    for ch in text:
        if ch in _WS:
            pending = bool(out)
            continue
        if pending:
            out.append(" ")
            pending = False
        out.append(ch)
    return "".join(out)


def _index(text: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    origin: list[int] = []
    pending = False
    for i, ch in enumerate(text):
        if ch in _WS:
            pending = bool(chars)
            continue
        if pending:
            chars.append(" ")
            origin.append(i - 1)
            pending = False
        chars.append(ch)
        origin.append(i)
    return "".join(chars), origin


def find_quote(body: str, quote: str) -> tuple[int, int] | None:
    """(start, end) of the first occurrence of the quote in the body, whitespace-normalised, or None."""
    wanted = normalise_ws(quote)
    if not wanted or len(wanted) > MAX_QUOTE_CHARS:
        return None
    normalised, origin = _index(body)
    at = normalised.find(wanted)
    if at < 0:
        return None
    return origin[at], origin[at + len(wanted) - 1] + 1


def verify(body: str, start: int, end: int, quote: str) -> bool:
    """The database's check, in Python: the span of the body says the quote."""
    if not 0 <= start < end <= len(body):
        return False
    wanted = normalise_ws(quote)
    return bool(wanted) and normalise_ws(body[start:end]) == wanted
