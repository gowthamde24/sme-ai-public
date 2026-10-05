"""T008: the Python vocabulary equals the database's (`app.requirement_vocab`), and synonyms behave."""

# ruff: noqa: E501, S311

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.requirements import vocabulary as V

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20261015090000_t008_enquiries_requirements.sql"
).read_text()


def sql_vocab(key: str) -> tuple[str, ...]:
    body = MIGRATION[MIGRATION.index("create function app.requirement_vocab") :]
    m = re.search(rf"when '{key}' then array\[(.*?)\]", body, re.S)
    assert m, key
    return tuple(re.findall(r"'([a-z_]+)'", m.group(1)))


@pytest.mark.parametrize("key", sorted(V.VOCAB))
def test_the_python_vocabulary_equals_the_database_vocabulary(key: str) -> None:
    assert V.VOCAB[key] == sql_vocab(key)


def test_the_database_has_no_vocabulary_for_other_keys() -> None:
    body = MIGRATION[MIGRATION.index("create function app.requirement_vocab") :]
    keys = set(re.findall(r"when '([a-z_]+)' then array\[", body.split("$$;")[0]))
    assert keys == set(V.VOCAB)


def test_every_code_but_other_has_synonyms_and_every_synonym_belongs_to_a_code() -> None:
    for key, codes in V.VOCAB.items():
        for code in codes:
            if code != "other":
                assert V.SYNONYMS[key][code], (key, code)
        assert set(V.SYNONYMS[key]) <= set(codes)


def test_dharmavaram_pattu_is_a_saree_type_with_its_synonyms() -> None:
    assert "dharmavaram_pattu" in V.VOCAB["saree_type"]
    for word in ("pattu", "Dharmavaram silk", "Dharmavaram"):
        assert V.code_for("saree_type", word) == "dharmavaram_pattu"
        assert V.supports("saree_type", "dharmavaram_pattu", f"Need 20 {word} sarees")


def test_field_keys_and_caps_match_the_plan() -> None:
    assert set(V.FIELD_KEYS) == {
        "saree_type", "fabric", "colour", "quantity", "budget", "deadline", "delivery_city", "payment_terms",
    }  # fmt: skip
    assert V.MAX_QUANTITY == 10_000
    assert V.MAX_UNIT_BUDGET_PAISE == 100_000_000
    assert V.MAX_TOTAL_BUDGET_PAISE == 1_000_000_000
    assert V.MAX_NET_DAYS == 180
    assert V.MAX_LINES == 5


@pytest.mark.parametrize(
    ("key", "text", "code"),
    [
        ("saree_type", "Kanchipuram", "kanjivaram"),
        ("saree_type", "Banaras silk saree", "banarasi"),
        ("fabric", "Cotton Silk", "cotton_silk"),
        ("fabric", "pure cotton silk saree", "cotton_silk"),
        ("colour", "mehendi green", "green"),
        ("colour", "laal", "red"),
        ("colour", "red and blue", None),
        ("colour", "tie dye", None),
        ("payment_terms", "cod", "cash_on_delivery"),
    ],
)
def test_code_for(key: str, text: str, code: str | None) -> None:
    assert V.code_for(key, text) == code


def test_supports_is_whole_word_and_case_insensitive() -> None:
    assert V.supports("colour", "red", "We want RED sarees")
    assert not V.supports("colour", "red", "We want bored sarees")
    assert not V.supports("colour", "red", "We want blue sarees")
    assert V.supports("colour", "other", "turquoise")
    assert not V.supports("colour", "other", "   ")
    assert V.supports("fabric", "silk", "pure silk")
