"""The joiner rule lives in TWO places that must never drift apart: `app.requirements.capture_text.strip_invisible` (what an enquiry stores) and the renderer's `_unsafe` (what a customer text refuses).
The renderer is a pure package that imports nothing, so it carries its own copy (docs/checklist-notes/C.md, "What lane A must change to adopt 1.1.0", item 3). This test imports both and compares them on
EVERY string up to length 4 over an alphabet that holds each kind of character the rule distinguishes.

The statement proved: capture changes a string exactly when the renderer refuses it. So (1) whatever capture stores, the renderer accepts (a stored enquiry can never make a customer text fail because of a joiner),
and (2) capture keeps a joiner exactly where the renderer accepts one.

Known, deliberate differences are kept OUT of the alphabet and are not pinned here: a line feed or tab (capture keeps them, and turns U+2028/U+2029 into one; the renderer refuses them), and private-use or unassigned code points (capture removes
them, the renderer, like the database, accepts them: docs/checklist-notes/C.md, "Decision to confirm")."""

# ruff: noqa: E501

from __future__ import annotations

import itertools
import unicodedata

from app.quotes import text_port
from app.requirements.capture_text import strip_invisible

ZWJ, ZWNJ = "\u200d", "\u200c"
ALPHABET = [
    "a",  # a Latin letter
    "5",  # an ASCII digit
    " ",  # a space
    "\u0c15",  # Telugu KA: a letter inside the range
    "\u0c4d",  # Telugu virama: a mark inside the range
    "\u0c67",  # Telugu digit one: a number inside the range
    "\u0964",  # danda: punctuation inside the range
    "\u0900",  # first code point of the range (a mark)
    "\u0df2",  # last assigned code point of the range (a mark)
    "\u08ff",  # just below the range (an Arabic mark)
    "\u0e01",  # just above the range (a Thai letter)
    "\u200b",  # zero-width space: always hidden
    "\u2060",  # word joiner: always hidden
    ZWJ,
    ZWNJ,
]


def _renderer_unsafe(value: str) -> bool:
    module = text_port._import()
    return bool(module._unsafe(value))


def test_the_alphabet_is_what_it_says_it_is() -> None:
    assert unicodedata.category("\u0c15")[0] == "L" and unicodedata.category("\u0c4d")[0] == "M"
    assert unicodedata.category("\u0c67") == "Nd" and unicodedata.category("\u0964") == "Po"
    assert unicodedata.category("\u0900")[0] == "M" and unicodedata.category("\u0df2")[0] == "M"
    assert unicodedata.category("\u08ff")[0] == "M" and unicodedata.category("\u0e01")[0] == "L"
    assert all(unicodedata.category(c) not in ("Cn", "Co") for c in ALPHABET)
    assert "\n" not in ALPHABET and "\t" not in ALPHABET


def test_capture_changes_a_string_exactly_when_the_renderer_refuses_it() -> None:
    checked = 0
    for length in range(1, 5):
        for chars in itertools.product(ALPHABET, repeat=length):
            value = "".join(chars)
            assert _renderer_unsafe(value) == (strip_invisible(value) != value), repr(value)
            checked += 1
    assert checked == sum(len(ALPHABET) ** n for n in range(1, 5)) > 50_000


def test_whatever_capture_stores_the_renderer_accepts() -> None:
    for length in range(1, 5):
        for chars in itertools.product(ALPHABET, repeat=length):
            assert not _renderer_unsafe(strip_invisible("".join(chars))), repr("".join(chars))


def test_the_named_cases() -> None:
    kept = ["\u0c15\u0c4d\u200d\u0c37", "\u0d28\u0d4d\u200d", "\u0915\u200c", "\u0c15\u200d "]
    for value in kept:
        assert strip_invisible(value) == value and not _renderer_unsafe(value), repr(value)
    removed = {
        "Syn\u200dthetic": "Synthetic",
        "\u200dabc": "abc",
        "a \u200d b": "a  b",
        "5\u200d5": "55",
        "\u0c67\u200d": "\u0c67",
        "\u0c15\u200d\u200d": "\u0c15\u200d",
    }
    for value, stripped in removed.items():
        assert strip_invisible(value) == stripped, repr(value)
        assert _renderer_unsafe(value), repr(value)
