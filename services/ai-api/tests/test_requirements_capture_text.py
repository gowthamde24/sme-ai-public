"""T008 owner review: capture strips invisible characters (it does not refuse), then scrubs; the stored text passes the database's hygiene rule."""

# ruff: noqa: E501, S311

from __future__ import annotations

import random
import re
import time

import pytest

from app.requirements import capture_text
from app.requirements.capture_text import prepare_body, prepare_subject, strip_invisible
from app.requirements.scrub import CONTACT_MARKER, has_contact, scrub

# the database's rule, as written in the migration (app.text_is_clean): the stored text must never match it
BLOCKED = re.compile(
    "[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​  ‪-‮⁠-⁤⁦-⁩﻿\U000e0000-\U000e007f]"
)
ZWNJ, ZWJ, LRM, RLM = "‌", "‍", "‎", "‏"

TELUGU = "క్" + ZWNJ + "ష"  # ka + virama + ZWNJ + ssa
KANNADA = "ಕ್" + ZWJ + "ಷ"
DEVANAGARI = "क्" + ZWJ + "ष"
DEVANAGARI_ZWNJ = "क्" + ZWNJ + "ष"


MALAYALAM_CHILLU = (
    "\u0d15\u0d4a\u0d1a\u0d4d\u0d1a\u0d3f\u0d28\u0d4d" + ZWJ
)  # a chillu typed with ZWJ at the END of a word
KANNADA_END = "\u0cae\u0cc8\u0cb8\u0cc2\u0cb0\u0cc1" + ZWNJ  # a ZWNJ after a word, before a space


@pytest.mark.parametrize(
    "raw", [TELUGU, KANNADA, DEVANAGARI, DEVANAGARI_ZWNJ, MALAYALAM_CHILLU, KANNADA_END]
)
def test_indic_joiners_are_kept_where_an_indic_letter_or_mark_precedes_them(raw: str) -> None:
    """Owner decision 2026-10-06: a pasted enquiry KEEPS U+200C and U+200D that follow a letter or mark of an Indic script (they spell real words)."""
    assert capture_text.KEEP_INDIC_JOINERS is True
    assert strip_invisible(raw) == raw
    assert strip_invisible(f"{raw} {raw}\n{raw}.") == f"{raw} {raw}\n{raw}."


@pytest.mark.parametrize(
    "raw", [TELUGU, KANNADA, DEVANAGARI, DEVANAGARI_ZWNJ, MALAYALAM_CHILLU, KANNADA_END]
)
def test_an_enquiry_with_joiners_is_stored_with_them_and_passes_the_databases_hygiene_rule(
    raw: str,
) -> None:
    prepared = prepare_body(
        f"\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02. 20 {raw} \u0c15\u0c3e\u0c35\u0c3e\u0c32\u0c3f. Deliver to Hyderabad by 15 November."
    )
    assert (ZWJ in prepared.text) or (ZWNJ in prepared.text)
    assert not BLOCKED.search(prepared.text), "the database accepts exactly these two joiners"
    assert (
        "Hyderabad" in prepared.text and "20" in prepared.text and prepared.truncated_from is None
    )
    assert raw in prepared.text


def test_a_joiner_anywhere_else_is_still_removed_so_it_cannot_hide_a_number_from_the_scrubber() -> (
    None
):
    assert strip_invisible("a" + ZWJ + "b") == "ab"  # between Latin letters
    assert strip_invisible("98765" + ZWNJ + "43210") == "9876543210"  # inside a number
    assert (
        strip_invisible(ZWJ + "\u0915") == "\u0915" and strip_invisible(" " + ZWNJ + "x") == " x"
    )  # at the start, after a space
    assert (
        strip_invisible("\u0915" + ZWJ + ZWJ + ZWNJ) == "\u0915" + ZWJ
    )  # a run of joiners keeps one
    assert (
        strip_invisible("\u0967" + ZWJ + "\u0968") == "\u0967\u0968"
    )  # an Indic DIGIT is not a letter or mark
    assert prepare_body("call 98765" + ZWNJ + "43210 now").text == f"call {CONTACT_MARKER} now"
    assert prepare_body(
        "call \u0c2b\u0c4b\u0c28\u0c4d" + ZWJ + " 98765" + ZWJ + "43210"
    ).text.endswith(CONTACT_MARKER)


@pytest.mark.parametrize(
    "ch",
    [
        "\u200b",
        LRM,
        RLM,
        "\u202a",
        "\u202b",
        "\u202c",
        "\u202d",
        "\u202e",
        "\u2060",
        "\u2061",
        "\u2066",
        "\u2067",
        "\u2068",
        "\u2069",
        "\ufeff",
        "\u00ad",
        "\U000e0041",
        "\U000e007f",
        "\u061c",
    ],
)
def test_bidi_tag_and_other_format_characters_are_still_removed_even_right_after_an_indic_letter(
    ch: str,
) -> None:
    assert strip_invisible("\u0c15" + ch + "\u0c37") == "\u0c15\u0c37"
    assert strip_invisible("a" + ch + "b") == "ab"


def test_the_removal_follows_the_one_shared_rule() -> None:
    """Everything the shared rule (app/text_rules.py) calls hidden is removed here, apart from the two joiners the rule allows and the whitespace capture keeps."""
    from app.text_rules import has_hidden_characters

    for code in list(range(0x0, 0x3000)) + [0xFEFF, 0xE0001, 0xE0041, 0xE000, 0xFFFF]:
        ch = chr(code)
        if ch in "\t\n\r" or ch in (ZWNJ, ZWJ) or ch in "\u2028\u2029":
            continue
        out = strip_invisible("a" + ch + "b")
        assert (out == "ab") is has_hidden_characters(ch), hex(code)


def test_the_joiners_can_still_be_switched_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(capture_text, "KEEP_INDIC_JOINERS", False)
    assert strip_invisible(TELUGU) == "\u0c15\u0c4d\u0c37" and strip_invisible(
        MALAYALAM_CHILLU
    ) == MALAYALAM_CHILLU.replace(ZWJ, "")


@pytest.mark.parametrize(
    "ch",
    [
        "​",
        ZWNJ,
        ZWJ,
        LRM,
        RLM,
        "‪",
        "‫",
        "‬",
        "‭",
        "‮",
        "⁠",
        "⁡",
        "⁢",
        "⁣",
        "⁤",
        "⁦",
        "⁧",
        "⁨",
        "⁩",
        "﻿",
        "­",
        "\U000e0041",
        "\x00",
        "\x01",
        "\x08",
        "\x0b",
        "\x0c",
        "\x1f",
        "\x7f",
        "\x85",
        "\u009f",
        "",
        "\ud800",
    ],
)
def test_every_zero_width_bidi_control_and_tag_character_is_removed(ch: str) -> None:
    assert strip_invisible(f"a{ch}b") == "ab"


def test_whitespace_and_line_breaks_survive_and_separators_become_line_feeds() -> None:
    assert strip_invisible("a\tb\r\nc\nd") == "a\tb\r\nc\nd"
    assert strip_invisible("a b c") == "a\nb\nc"


def test_prices_quantities_dates_gstins_and_pincodes_are_untouched() -> None:
    text = (
        "1,00,00,000 sarees, Rs 5,00,000, 50000000, GSTIN 29ABCDE1234F1Z5, PIN 560001, 2026-11-15"
    )
    assert prepare_body(text).text == text
    assert (
        prepare_body(text.replace(" ", "​ ")).text == text
    )  # even when zero-width characters were sprinkled in


def test_hidden_characters_cannot_hide_a_phone_number_or_an_address_from_the_scrubber() -> None:
    assert prepare_body("call 98765​43210 now").text == f"call {CONTACT_MARKER} now"
    assert (
        prepare_body("mail a" + ZWJ + "@" + ZWNJ + "b.in please").text
        == f"mail {CONTACT_MARKER} please"
    )
    assert prepare_body("call +91‮ 98765 43210").text == f"call {CONTACT_MARKER}"


def test_the_stored_text_is_trimmed_and_cut_at_the_limit_and_says_how_long_it_was() -> None:
    out = prepare_body("  " + "x" * 6001 + "  ")
    assert len(out.text) == 6000 and out.truncated_from == 6001
    assert prepare_body("x" * 6000).truncated_from is None
    assert prepare_body("​ ​").text == ""  # nothing left: the API refuses an empty enquiry


def test_subject_is_one_line_and_short() -> None:
    assert prepare_subject("Re:\n\tOrder ‮ enquiry") == "Re: Order enquiry"
    assert prepare_subject("​") is None
    assert len(prepare_subject("s" * 500) or "") == 200
    assert prepare_subject("call 9876543210") == f"call {CONTACT_MARKER}"


_POOL = [
    "a",
    "b",
    "7",
    " ",
    "\n",
    "\t",
    "क्",
    ZWJ,
    ZWNJ,
    "క్",
    LRM,
    RLM,
    "​",
    "‮",
    "﻿",
    "\U000e0041",
    "\x00",
    "\x7f",
    "😀",
    "é",
    "9876543210",
    "a@b.in",
    "Rs 5,00,000",
    " ",
]


def test_property_the_stored_text_always_passes_the_database_hygiene_rule_and_the_contact_guard() -> (
    None
):
    rng = random.Random(20261007)
    for _ in range(3000):
        raw = "".join(rng.choice(_POOL) for _ in range(rng.randint(1, 40)))
        stored = prepare_body(raw).text
        assert not BLOCKED.search(stored), (raw, stored)
        assert not has_contact(stored), (raw, stored)
        assert prepare_body(stored).text == stored  # stable
        if stored:
            assert stored == stored.strip(" \t\r\n")


# ---- the guard stays fast on adversarial 6,000-character inputs (the database's own timing is pgTAP 55)
_ADVERSARIAL = {
    "letters": "a" * 6000,
    "digits": "1" * 6000,
    "nines": "9" * 6000,
    "rs": "rs " * 2000,
    "plus91": "+91" * 2000,
    "plus91_space": "+91 " * 1500,
    "phone_halves": "98765 " * 1000,
    "at_pairs": "a@" * 3000,
    "long_local_part": "a" * 5999 + "@",
    "dotted_local_part": "a." * 3000 + "@",
    "long_dotted_domain": "a@" + "b." * 2998,
    "many_phones": "9876543210 " * 545,
    "pluses": "+" * 6000,
    "digit_space": "9 " * 3000,
    "huge_paste": "a" * 200_000,
}


@pytest.mark.parametrize("text", list(_ADVERSARIAL.values()), ids=list(_ADVERSARIAL))
def test_the_scrubber_and_the_guard_finish_well_under_a_second_on_adversarial_input(
    text: str,
) -> None:
    started = time.perf_counter()
    has_contact(text)
    scrub(text)
    prepare_body(text)
    assert time.perf_counter() - started < 1.0
