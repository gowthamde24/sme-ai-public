"""One rule for "hidden" characters in imported text cells (lead CSV, price-list CSV).

A cell is refused when it holds a control character, a format character that changes how text is read or hides itself (zero-width space U+200B, the BOM U+FEFF, the
bidirectional controls U+202A-U+202E and U+2066-U+2069, the direction marks U+200E and U+200F, the word joiner), a line or paragraph separator, a surrogate, a private-use or an
unassigned character. The ONE exception inside the "Cf" category is the zero-width non-joiner U+200C and the zero-width joiner U+200D: Devanagari, Telugu, Kannada, Malayalam
(and Persian) spell real words with them, so refusing them would refuse real names and cities. A newline inside a quoted cell is allowed; a tab or carriage return is not."""

from __future__ import annotations

import unicodedata

ZWNJ, ZWJ = "‌", "‍"
_REFUSED = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"})
_ALLOWED = frozenset({ZWNJ, ZWJ, "\n"})


def has_hidden_characters(text: str, *, allow_newline: bool = True) -> bool:
    """True when `text` holds a refused character. `allow_newline=False` also refuses the line feed (a name or a city is one line)."""
    allowed = _ALLOWED if allow_newline else _ALLOWED - {"\n"}
    return any(char not in allowed and unicodedata.category(char) in _REFUSED for char in text)
