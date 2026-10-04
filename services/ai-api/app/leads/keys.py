"""app.leads.keys: deterministic matching key and normalization.

Parity with SQL app.match_key (ADR 0010).
"""

from __future__ import annotations

import re
import unicodedata


def match_key(value: str | None) -> str:
    """Compute the comparison key of a name or location:

    NFKC normalise -> lower() (ICU collation parity) -> drop ZWNJ / ZWJ -> collapse whitespace
    -> trim.
    """
    if not value:
        return ""
    s = unicodedata.normalize("NFKC", value).lower()
    s = s.replace("\u200c", "").replace("\u200d", "")
    s = re.sub(r"[ \t\r\n\f\v]+", " ", s, flags=re.ASCII)
    return s.strip(" \t\r\n\f\v")
