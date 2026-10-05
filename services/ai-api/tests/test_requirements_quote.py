"""T008 owner change C: the runtime finds the quote's offsets (first occurrence, whitespace-normalised)."""

# ruff: noqa: E501, S311

from __future__ import annotations

import random

from app.requirements.quote import MAX_QUOTE_CHARS, find_quote, normalise_ws, verify

BODY = "Hello,\nNeed  20 kanjivaram   sarees\tby 15 November.\n\nAlso 20 kanjivaram sarees in red."


def test_normalise_ws_collapses_only_space_tab_cr_lf() -> None:
    assert normalise_ws("  a \t b\r\n\nc  ") == "a b c"
    assert normalise_ws("a b") == "a b"  # a no-break space is a character, not whitespace
    assert normalise_ws("a b") == "a b"
    assert normalise_ws("   ") == ""


def test_the_first_occurrence_wins_and_offsets_cover_the_original_text() -> None:
    start, end = find_quote(BODY, "20 kanjivaram sarees") or (-1, -1)
    assert BODY[start:end] == "20 kanjivaram   sarees"
    assert start == BODY.index("20")
    assert verify(BODY, start, end, "20 kanjivaram sarees")


def test_whitespace_differences_are_ignored_both_ways() -> None:
    assert find_quote(BODY, "Need 20\nkanjivaram sarees by 15 November.") is not None
    assert find_quote("a   b", "a b") == (0, 5)
    assert find_quote("a b", "a   b") == (0, 3)


def test_matching_is_otherwise_exact() -> None:
    assert find_quote(BODY, "need 20 kanjivaram") is None  # case
    assert find_quote(BODY, "20 kanjivaram sarees by 16 November") is None
    assert find_quote(BODY, "20 Kanjivaram") is None
    assert find_quote(BODY, "") is None
    assert find_quote(BODY, "   ") is None
    assert find_quote("", "x") is None


def test_a_quote_over_300_characters_is_refused() -> None:
    body = "x" * 400
    assert find_quote(body, "x" * MAX_QUOTE_CHARS) is not None
    assert find_quote(body, "x" * (MAX_QUOTE_CHARS + 1)) is None


def test_verify_is_what_the_database_checks() -> None:
    assert verify(BODY, 0, 5, "Hello")
    assert not verify(BODY, 0, 5, "Hell")
    assert not verify(BODY, 5, 5, "")
    assert not verify(BODY, -1, 5, "Hello")
    assert not verify(BODY, 0, len(BODY) + 1, BODY)
    assert not verify(BODY, 3, 2, "x")


def test_property_every_found_span_verifies_and_is_the_first() -> None:
    rng = random.Random(11)
    alphabet = ["a", "b", "c", " ", "  ", "\n", "\t", "20", "x", "é"]
    for _ in range(2000):
        body = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 60)))
        i = rng.randint(0, len(body) - 1)
        j = rng.randint(i + 1, len(body))
        quote = body[i:j]
        found = find_quote(body, quote)
        if not normalise_ws(quote):
            assert found is None
            continue
        assert found is not None, (body, quote)
        assert verify(body, *found, quote)
        first_char = i + len(quote) - len(quote.lstrip(" \t\r\n"))
        assert found[0] <= first_char  # never later than the occurrence we cut it from
