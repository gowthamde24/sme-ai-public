"""The shared rule for hidden characters in imported text (app/text_rules.py)."""

from __future__ import annotations

import pytest

from app.text_rules import has_hidden_characters

CONTROLS = [
    "\x00",
    "\x07",
    "\t",
    "\r",
    "\x1b",
    "\x7f",
    "\x85",
]  # Cc, the tab and the carriage return too
INVISIBLE = [
    "\u200b",
    "\u200e",
    "\u200f",
    "\u202a",
    "\u202e",
    "\u2060",
    "\u2066",
    "\u2069",
    "\ufeff",
    "\u00ad",
    "\U000e0001",
]  # Cf
SURROGATES = ["\ud800", "\udfff"]  # Cs: a lone surrogate
PRIVATE = ["\ue000", "\U000f0000"]  # Co
UNASSIGNED = ["\u0378", "\U0010ffff"]  # Cn
SEPARATORS = ["\u2028", "\u2029"]  # Zl, Zp


@pytest.mark.parametrize(
    "char", CONTROLS + INVISIBLE + SURROGATES + PRIVATE + UNASSIGNED + SEPARATORS
)
def test_each_of_these_is_refused_alone_and_inside_a_word(char: str) -> None:
    assert has_hidden_characters(char)
    assert has_hidden_characters(f"Silk{char}House")
    assert has_hidden_characters(
        f"\u0c39\u200d{char}", allow_newline=False
    )  # a joiner next to it does not launder it


@pytest.mark.parametrize(
    "char",
    [
        "\u200c",
        "\u200d",
        "a",
        " ",
        "\u00e9",
        "\u0cae",
        "\u0d15",
        "\u0939",
        "\u0d4d",
        "\u0c4d",
        "\u20b9",
        "-",
        "'",
        "\u00a0",
    ],
)
def test_ordinary_text_and_the_two_joiners_are_not(char: str) -> None:
    assert not has_hidden_characters(char)
    assert not has_hidden_characters(f"x{char}y")


def test_the_newline_is_allowed_inside_a_cell_unless_the_caller_says_one_line() -> None:
    assert not has_hidden_characters("two\nlines")
    assert not has_hidden_characters("two\nlines", allow_newline=True)
    assert has_hidden_characters("two\nlines", allow_newline=False)
    assert not has_hidden_characters("one line", allow_newline=False)


def test_an_empty_text_has_nothing_hidden() -> None:
    assert not has_hidden_characters("") and not has_hidden_characters("", allow_newline=False)
