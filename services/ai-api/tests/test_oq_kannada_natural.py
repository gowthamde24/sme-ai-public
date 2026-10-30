"""Kannada the way people speak it (owner, 30 Oct 2026): colloquial endings (ಮಾಡ್ತೀನಿ, ಹೇಳ್ತೀನಿ), Kanglish where it is natural, short sentences, no sir / madam. The lines are DRAFTS for a native reader
(native_lines/kn.md); these tests pin what the owner asked for so a rewrite cannot drift back to the written register."""

# ruff: noqa: E501

from __future__ import annotations

import re

import pytest

from app.agents import register
from app.agents.register.address import gendered_words
from app.conversation.fillers import BANK_LINES, FILLERS

WRITTEN_ENDINGS = ("ಮಾಡುತ್ತೇನೆ", "ಹೇಳುತ್ತೇನೆ", "ಕಳುಹಿಸುತ್ತೇನೆ", "ತಿಳಿಸುತ್ತೇನೆ", "ದಯವಿಟ್ಟು", "ಧನ್ಯವಾದಗಳು", "ಮಾತನಾಡುತ್ತೇನೆ")
SPOKEN = ("ಮಾಡ್ತೀನಿ", "ಹೇಳ್ತೀನಿ", "ಕಳಿಸ್ತೀನಿ", "ಮಾಡ್ಲಾ", "ಕಳಿಸ್ಲಾ", "ಇದೆ", "ಬರುತ್ತೆ")


def kn_lines() -> list[str]:
    return [text for _, text in register.examples("kn")]


def test_the_kannada_examples_are_spoken_not_written() -> None:
    lines = kn_lines()
    assert len(lines) >= 15
    assert not [t for t in lines if any(w in t for w in WRITTEN_ENDINGS)], "a written ending in a spoken example"
    assert not [t for t in lines if register.formal_forms_in("kn", t)]
    assert sum(any(w in t for w in SPOKEN) for t in lines) >= 8, "the examples use the colloquial endings"


def test_kanglish_is_used_where_people_say_the_english_word() -> None:
    joined = " ".join(kn_lines())
    for word in ("call", "photos", "WhatsApp", "stock", "price", "order", "minute", "check", "confirm", "sorry", "Thank you", "owner"):
        assert word.lower() in joined.lower(), word


def test_sentences_are_short() -> None:
    for line in kn_lines():
        for sentence in re.split(r"[.?!]\s*", line):
            assert len(sentence.split()) <= 12, (sentence, "more than twelve words")


def test_no_sir_or_madam_and_no_name_of_a_retired_assistant() -> None:
    for line in kn_lines():
        assert not gendered_words(line), line
        assert not re.search(r"ವಿಜಯ|ವಾಣಿ|(?<![ಀ-೿])ತಾರಾ?(?![ಀ-೿])", line), line


def test_the_rules_the_model_reads_say_the_same_things() -> None:
    block = register.register_block("kn")
    assert "ಮಾಡ್ತೀನಿ" in block and "Kanglish" in block and "Do not use 'ಸರ್' or 'ಮೇಡಂ'" in block and "ಅವರೇ" in block
    assert "ಮಾಡುತ್ತೇನೆ" in block, "the written form is named only as the thing to avoid"
    for form in ("ಮಾಡುತ್ತೇನೆ", "ಹೇಳುತ್ತೇನೆ", "ತಿಳಿಸುತ್ತೇನೆ"):
        assert form in register.data()["formal_forms"]["kn"]


@pytest.mark.parametrize("line", BANK_LINES["kn"] + FILLERS["kn"])
def test_the_kannada_fillers_are_short_neutral_and_colloquial(line: str) -> None:
    assert len(line.split()) <= 5 and not gendered_words(line) and not register.formal_forms_in("kn", line)
