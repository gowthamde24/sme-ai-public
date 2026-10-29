"""Job EH: the owner's chat follows the language of their last turn (also romanised Telugu), the nothing-found answer is no longer a refusal, a placeholder customer has no id, and the owner chat stays open."""

# ruff: noqa: E501

from __future__ import annotations

import re

import pytest

from app.assistant.language import NO_ANSWER, NO_RECORD_HELP, detect_owner_language
from app.assistant.tools import friendly_names
from app.browser_voice import limits, session


@pytest.mark.parametrize(
    ("text", "language"),
    [
        ("Eeroju edaina kotha leads find chesaava?", "te"),
        ("aaj kitne naye leads aaye hain", "hi"),
        ("ivattu yaava leads bandide, torisi", "kn"),
        ("inniku enna leads vandhuchu, sollunga", "ta"),
        ("ఈ రోజు కొత్త లీడ్స్ ఏమైనా ఉన్నాయా", "te"),
        ("How many new leads came today?", "en"),
        ("What needs me today?", "en"),
        ("ok", "en"),
        ("send the quote to Ramesh", "en"),
        ("", "en"),
    ],
)
def test_the_owner_language_is_the_one_they_wrote_even_in_latin_letters(text: str, language: str) -> None:
    assert detect_owner_language(text) == language


def test_an_english_sentence_with_one_indian_word_stays_english() -> None:
    assert detect_owner_language("Please send the kotha price list to the dealer tomorrow morning") == "en"


def test_no_fixed_refusal_is_left_in_any_language() -> None:
    for table in (NO_ANSWER, NO_RECORD_HELP):
        for language, text in table.items():
            assert "not guess" not in text.lower() and "ఊహించి" not in text and "अंदाज़ा" not in text, language
    assert NO_RECORD_HELP["en"].startswith("I looked")


def test_a_customer_without_a_name_is_never_shown_with_an_id() -> None:
    assert friendly_names("WhatsApp customer 84407a asked about pavers") == "a WhatsApp customer asked about pavers"
    assert friendly_names("Enquiry 0a1b2c is new") == "an enquiry is new"
    assert friendly_names("Ravi Kumar asked") == "Ravi Kumar asked"
    assert not re.search(r"[0-9a-f]{6}", friendly_names("WhatsApp customer 84407a"))


def test_the_owner_chat_stays_open_for_long_silences_and_an_hour() -> None:
    assert session.IDLE_S >= 1800
    assert limits.Limits().session_seconds >= 3600 and limits.Limits().day_seconds >= 7200
