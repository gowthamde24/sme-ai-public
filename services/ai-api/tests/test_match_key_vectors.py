"""The Python half of app.match_key, tested against the PRODUCTION function.

ONE vectors file (tests/vectors/match_key.json) is read by two suites:
  * this one runs every row through app.leads.keys.match_key, the function the scoring engine and
    (via the API) matching actually use. There is deliberately no copy of the algorithm in this
    file;
  * supabase/tests/database/27_match_key.test.sql carries a copy GENERATED from the same file
    (scripts/gen_match_key_fixture.py), because pgTAP cannot read files. A drift test below fails
    when that copy is stale.

SQL and Python must give the same key for the same name, or de-duplication quietly diverges: SQL
uses lower() (ICU), Python str.lower() (NOT casefold). The vectors are chosen so that every
plausible slip (casefold, no NFKC, no lower-casing, joiners kept, blanks not collapsed, no trim)
changes at least one key: `test_every_mutant_is_caught_by_the_vectors` proves that for the vector
set itself.
"""

from __future__ import annotations

import importlib.util
import json
import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.leads import keys, scoring

ROOT = Path(__file__).resolve().parents[3]
VECTORS_FILE = ROOT / "tests" / "vectors" / "match_key.json"
GENERATOR = ROOT / "scripts" / "gen_match_key_fixture.py"

DOC = json.loads(VECTORS_FILE.read_text(encoding="utf-8"))
VECTORS: list[dict[str, Any]] = DOC["vectors"]


def expected_python(vector: dict[str, Any]) -> str:
    return str(vector.get("python_expected", vector["expected"]))


def generator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("gen_match_key_fixture", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------- the production function
@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["label"])
def test_the_production_function_gives_the_golden_key(vector: dict[str, Any]) -> None:
    assert keys.match_key(vector["input"]) == expected_python(vector)


def test_the_function_under_test_is_the_one_the_engine_uses_and_there_is_no_copy_here() -> None:
    assert keys.match_key.__module__ == "app.leads.keys"
    assert vars(scoring)["match_key"] is keys.match_key
    source = Path(__file__).read_text(encoding="utf-8")
    assert not re.search(r"^def match_key\b", source, re.MULTILINE)


def test_python_differs_from_sql_only_where_the_vector_file_says_so() -> None:
    for vector in VECTORS:
        if "python_expected" in vector:
            assert vector["input"] is None, (
                "only a missing value may differ (NULL vs the empty key)"
            )
    assert keys.match_key(None) == "" and keys.match_key("") == ""


# ---------------------------------------------------------------- the vector set is strong
def mutant_casefold(s: str) -> str:
    return _finish(unicodedata.normalize("NFKC", s).casefold())


def mutant_no_nfkc(s: str) -> str:
    return _finish(s.lower())


def mutant_nfc_instead_of_nfkc(s: str) -> str:
    return _finish(unicodedata.normalize("NFC", s).lower())


def mutant_no_lowercase(s: str) -> str:
    return _finish(unicodedata.normalize("NFKC", s))


def mutant_upper(s: str) -> str:
    return _finish(unicodedata.normalize("NFKC", s).upper())


def mutant_keeps_joiners(s: str) -> str:
    return _finish(unicodedata.normalize("NFKC", s).lower(), joiners=False)


def mutant_no_collapse(s: str) -> str:
    return _finish(unicodedata.normalize("NFKC", s).lower(), collapse=False)


def mutant_no_trim(s: str) -> str:
    return _finish(unicodedata.normalize("NFKC", s).lower(), trim=False)


def mutant_unicode_whitespace(s: str) -> str:
    """str.split() treats NEL, line separator, ... as blanks; the SQL class is ASCII only."""
    return " ".join(
        unicodedata.normalize("NFKC", s).lower().replace("‌", "").replace("‍", "").split()
    )


def _finish(s: str, *, joiners: bool = True, collapse: bool = True, trim: bool = True) -> str:
    if joiners:
        s = s.replace("‌", "").replace("‍", "")
    if collapse:
        s = re.sub(r"[ \t\r\n\f\v]+", " ", s, flags=re.ASCII)
    return s.strip(" \t\r\n\f\v") if trim else s


MUTANTS: list[Callable[[str], str]] = [
    mutant_casefold,
    mutant_no_nfkc,
    mutant_nfc_instead_of_nfkc,
    mutant_no_lowercase,
    mutant_upper,
    mutant_keeps_joiners,
    mutant_no_collapse,
    mutant_no_trim,
    mutant_unicode_whitespace,
]


@pytest.mark.parametrize("mutant", MUTANTS, ids=lambda f: f.__name__)
def test_every_mutant_is_caught_by_the_vectors(mutant: Callable[[str], str]) -> None:
    caught = [
        v["label"]
        for v in VECTORS
        if v["input"] is not None and mutant(v["input"]) != expected_python(v)
    ]
    assert caught, f"no vector distinguishes {mutant.__name__} from the real algorithm"


def test_the_vectors_cover_the_cases_that_matter() -> None:
    labels = [str(v["label"]) for v in VECTORS]
    for prefix in (
        "casefold:",
        "NFKC:",
        "joiner:",
        "blank:",
        "Telugu",
        "Kannada",
        "Devanagari",
        "empty",
        "null:",
    ):
        assert any(label.startswith(prefix) for label in labels), prefix
    inputs = [v["input"] for v in VECTORS]
    assert None in inputs and "" in inputs
    assert any(i and "ß" in i for i in inputs), "German sharp s"
    assert any(i and "İ" in i for i in inputs), "Turkish dotted capital I"
    assert any(i and "ﬃ" in i for i in inputs), "a ligature"
    assert any(i and "Ａ" <= i[0] <= "Ｚ" for i in inputs), "full-width Latin"
    assert any(i and "‌" in i for i in inputs) and any(i and "‍" in i for i in inputs)
    assert len(VECTORS) >= 60


def test_labels_are_unique_and_values_are_strings_or_null() -> None:
    labels = [v["label"] for v in VECTORS]
    assert len(set(labels)) == len(labels)
    for v in VECTORS:
        assert isinstance(v["input"], str | None) and isinstance(v["expected"], str | None)
        assert (v["input"] is None) == (v["expected"] is None), "NULL in <=> NULL out (SQL)"


# ---------------------------------------------------------------- the pgTAP copy
def test_the_pgtap_copy_of_the_vectors_is_not_stale() -> None:
    gen = generator()
    text = gen.TARGET.read_text(encoding="utf-8")
    assert gen.current_block(text) == gen.render_block(gen.load_vectors()), (
        "supabase/tests/database/27_match_key.test.sql is out of date: "
        "run python3 scripts/gen_match_key_fixture.py"
    )


def test_the_generator_escapes_what_must_not_travel_raw() -> None:
    lit = generator().sql_literal
    assert lit(None) == "null"
    assert lit("plain 'quote'") == "'plain ''quote'''"
    assert lit("a‌b") == "U&'a\\+00200Cb'"
    assert lit("tab\there") == "U&'tab\\+000009here'"
    assert lit("back\\slash and é") == "U&'back\\\\slash and \\+0000E9'"
    assert lit("it's శ") == "U&'it''s \\+000C36'"
