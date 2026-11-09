"""A space where a Latin word meets an Indian-script word (owner, 7 Nov 2026: "నుంచిAI assistant ని" must read "నుంచి AI assistant ని").

Only a Latin LETTER next to an Indian letter or vowel sign is separated. A zero-width joiner or non-joiner (the way "AI అసిస్టెంట్\u200cని" joins its ending), digits ("2వ") and punctuation are left alone."""

# ruff: noqa: E501

from __future__ import annotations

import re

_INDIC = "\u0900-\u0DFF"
_LATIN_THEN_INDIC = re.compile(f"([A-Za-z])([{_INDIC}])")
_INDIC_THEN_LATIN = re.compile(f"([{_INDIC}])([A-Za-z])")


def space_scripts(text: str) -> str:
    return _INDIC_THEN_LATIN.sub(r"\1 \2", _LATIN_THEN_INDIC.sub(r"\1 \2", text))
