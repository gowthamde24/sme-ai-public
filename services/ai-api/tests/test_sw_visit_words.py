"""The visit messages name no place (4 Nov 2026, C2's request on the owner's list).

"our shop" reached a school's parents and a builder's customers; every business type is visited,
so the words fit them all."""

from __future__ import annotations

import pytest

from app.visits.texts import TEMPLATES

PLACE_WORDS = ("shop", "store", "showroom", "షాపు", "దుకాణ", "दुकान", "ಅಂಗಡಿ", "கடை", "കട")


@pytest.mark.parametrize("language", sorted(TEMPLATES))
def test_no_visit_message_names_a_place(language: str) -> None:
    for kind in ("confirmation", "reminder", "offer"):
        text = TEMPLATES[language][kind]
        assert not any(w in text.casefold() for w in PLACE_WORDS), (language, kind, text)
