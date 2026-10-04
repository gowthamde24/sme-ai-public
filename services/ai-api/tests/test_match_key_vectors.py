"""The Python half of app.match_key (supabase/migrations/..._t005_match_keys.sql).

Both sides run the same operations: NFKC normalise, lower() (NOT casefold), drop ZWNJ / ZWJ,
collapse [ \\t\\r\\n\\f\\v] runs to one blank, trim. The golden vectors live in the pgTAP test; this
test reads THAT file and checks the Python function against the very same rows, so the two
implementations cannot drift apart unnoticed. (In milestone 2 this reference moves to
app/leads/keys.py and the API imports it.)"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

SQL = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "tests"
    / "database"
    / "27_match_key.test.sql"
)
TEXT = SQL.read_text(encoding="utf-8")


def match_key(value: str) -> str:
    s = unicodedata.normalize("NFKC", value).lower()
    s = s.replace("‌", "").replace("‍", "")
    s = re.sub(r"[ \t\r\n\f\v]+", " ", s, flags=re.ASCII)
    return s.strip(" \t\r\n\f\v")


LIT = r"(U&'(?:[^']|'')*'|'(?:[^']|'')*')"


def sql_literal(lit: str) -> str:
    lit = lit.strip()
    if lit.startswith("U&'"):
        body = lit[3:-1]
        body = re.sub(r"\\\+([0-9A-Fa-f]{6})", lambda m: chr(int(m.group(1), 16)), body)
        return body.replace("''", "'")
    return lit[1:-1].replace("''", "'")


def vectors() -> list[tuple[str, str, str]]:
    block = TEXT.split("insert into vectors values", 1)[1].split(";\nselect", 1)[0]
    rows = []
    for line in block.strip().splitlines():
        m = re.fullmatch(rf"\s*\({LIT}, {LIT}, {LIT}\),?", line)
        assert m, f"unparsed vector line: {line[:80]}"
        rows.append((sql_literal(m.group(1)), sql_literal(m.group(2)), sql_literal(m.group(3))))
    return rows


def test_the_vector_table_was_parsed() -> None:
    rows = vectors()
    assert len(rows) >= 40
    assert any("శ్రీ" in r[1] for r in rows), "Telugu vectors"
    assert any("ಸಿಲ್ಕ್" in r[1] for r in rows), "Kannada vectors"
    assert any("साड़ी" in r[1] for r in rows), "Devanagari vectors"


def test_python_gives_every_expected_key_of_the_sql_vectors() -> None:
    wrong = [
        (label, match_key(raw), expected)
        for label, raw, expected in vectors()
        if match_key(raw) != expected
    ]
    assert wrong == []


def test_joiners_are_ignored_for_matching_only() -> None:
    assert match_key("క్ష‍త") == match_key("క్షత")
    assert match_key("می‌خواهم") == "میخواهم"
    assert match_key("a‎b") != match_key("ab"), "LRM is not a joiner"


def test_lower_not_casefold() -> None:
    assert match_key("Straße") == "straße"  # casefold would give "strasse"
    assert match_key("ΟΔΟΣ") == "οδος"  # the final sigma is handled the same way on both sides
