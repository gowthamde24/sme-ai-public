"""The CSV adapter for lead import (app/leads/csv_rows.py): shape, limits, the header, untrusted cells (formula-like and hidden characters), the line numbers of refusals, and that NO error
ever repeats a cell value."""

# ruff: noqa: E501

from __future__ import annotations

from pathlib import Path

import pytest

from app.leads.csv_rows import (
    COLUMNS,
    FATAL_CODES,
    MAX_BYTES,
    MAX_CELL,
    MAX_ROWS,
    ROW_CODES,
    rows_from_csv,
)
from app.leads.models import ImportRowInput

CANARY = "CANARY-77c1de"
HEADER = "company_name,contact_name,contact_email,contact_phone,city\n"
DATA = Path(__file__).resolve().parents[3] / "tests" / "rehearsal" / "data" / "leads.csv"


def issues(text: str) -> list[tuple[int, str, str | None]]:
    return [(i.line, i.code, i.column) for i in rows_from_csv(text).issues]


# ---------------------------------------------------------------------------------------------- the happy path
def test_a_simple_file_becomes_import_rows_in_order_with_their_line_numbers() -> None:
    r = rows_from_csv(
        HEADER
        + "Kaveri Silks,A Rao,a@kaveri.example.com,+00 90000 10001,Hyderabad\nLakshmi,,,,Chennai\n"
    )
    assert r.ok and r.issues == [] and r.lines == [2, 3]
    assert r.rows == [
        {
            "company_name": "Kaveri Silks",
            "contact_name": "A Rao",
            "contact_email": "a@kaveri.example.com",
            "contact_phone": "+00 90000 10001",
            "city": "Hyderabad",
        },
        {"company_name": "Lakshmi", "city": "Chennai"},  # empty cells are omitted, never invented
    ]


def test_every_accepted_row_is_a_valid_import_row() -> None:
    r = rows_from_csv(HEADER + "A,B,c@d.example.com,+00 1,E\n")
    for row in r.rows:
        ImportRowInput.model_validate(row)


def test_the_rehearsal_data_file_parses_to_nineteen_rows_and_one_refusal() -> None:
    r = rows_from_csv(DATA.read_text(encoding="utf-8"))
    assert r.ok
    assert len(r.rows) == 19 and [(i.line, i.code) for i in r.issues] == [
        (8, "company_name_missing")
    ]
    assert set(r.rows[0]) <= set(COLUMNS)
    for row in r.rows:
        ImportRowInput.model_validate(row)


def test_a_bom_crlf_quotes_commas_and_newlines_in_cells_are_handled() -> None:
    text = '﻿"company_name","city"\r\n"Acme, ""Silk"" & Co","Pune\nWest"\r\n'
    r = rows_from_csv(text)
    assert r.rows == [{"company_name": 'Acme, "Silk" & Co', "city": "Pune\nWest"}]


def test_header_names_are_trimmed_and_case_insensitive_and_blank_lines_are_not_rows() -> None:
    r = rows_from_csv(" Company_Name , CITY \nAcme,Pune\n\n   ,  \nBeta,Surat\n")
    assert r.rows == [
        {"company_name": "Acme", "city": "Pune"},
        {"company_name": "Beta", "city": "Surat"},
    ] and r.lines == [2, 5]


def test_categories_are_split_on_semicolons() -> None:
    r = rows_from_csv("company_name,categories\nAcme,silk; cotton ;; linen\n")
    assert r.rows == [{"company_name": "Acme", "categories": ["silk", "cotton", "linen"]}]
    assert issues(
        "company_name,categories\nAcme," + ";".join(f"c{i}" for i in range(11)) + "\n"
    ) == [(2, "too_many_categories", "categories")]
    assert issues("company_name,categories\nAcme," + "x" * 41 + "\n") == [
        (2, "category_too_long", "categories")
    ]


# ---------------------------------------------------------------------------------------------- the whole file is refused
@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("", "empty"),
        ("   \n\n", "empty"),
        ("﻿", "empty"),
        ("company_name,bogus\nA,B\n", "unknown_column"),
        ("company_name,city,city\nA,B,C\n", "duplicate_column"),
        ("COMPANY_NAME,company_name\nA,B\n", "duplicate_column"),
        ("city,industry\nA,B\n", "missing_company_column"),
        ('company_name\n"unterminated\n', "malformed_csv"),
    ],
)
def test_a_file_that_cannot_be_read_is_refused_whole(text: str, code: str) -> None:
    r = rows_from_csv(text)
    assert r.fatal == code and r.rows == [] and r.issues == []


def test_too_large_and_too_many_rows_are_refused_whole() -> None:
    assert rows_from_csv("company_name\n" + "x" * MAX_BYTES).fatal == "too_large"
    assert rows_from_csv("company_name\n" + "a\n" * MAX_ROWS).fatal is None
    assert rows_from_csv("company_name\n" + "a\n" * (MAX_ROWS + 1)).fatal == "too_many_rows"
    assert (
        rows_from_csv("company_name\n" + "é" * (MAX_BYTES // 2 + 1)).fatal == "too_large"
    )  # the limit is in BYTES


def test_text_that_is_not_text_is_refused() -> None:
    assert rows_from_csv(b"company_name\nA\n").fatal == "not_utf8"  # type: ignore[arg-type]
    assert (
        rows_from_csv("company_name\n\ud800\n").fatal == "not_utf8"
    )  # a lone surrogate cannot be UTF-8


# ---------------------------------------------------------------------------------------------- one row is refused, the others go through
def test_a_ragged_row_is_refused_with_its_line_number_and_the_rest_continue() -> None:
    r = rows_from_csv("company_name,city\nA,B\nonly one\nC,D,E\nF,G\n")
    assert [(i.line, i.code) for i in r.issues] == [(3, "column_count"), (4, "column_count")]
    assert [row["company_name"] for row in r.rows] == ["A", "F"] and r.lines == [2, 5]


@pytest.mark.parametrize(
    "cell",
    [
        "=1+1",
        "=cmd|' /c calc'!A1",
        "@SUM(1)",
        "+cmd|x",
        "-1+2",
        "-x",
        "+",
        "-",
        "\tx",
        '=HYPERLINK("http://x")',
    ],
)
def test_a_cell_a_spreadsheet_would_run_refuses_its_row(cell: str) -> None:
    quoted = '"' + cell.replace('"', '""') + '"'
    r = rows_from_csv(f"company_name,city\nA,{quoted}\nB,ok\n")
    assert [(i.line, i.code, i.column) for i in r.issues] == [(2, "formula_like", "city")], cell
    assert [row["company_name"] for row in r.rows] == ["B"]


@pytest.mark.parametrize(
    "cell", ["+00 90000 10001", "+91 (98) 000-00001", "+0090000 10013", "+00-90000-10001"]
)
def test_a_phone_numbers_leading_plus_is_not_a_formula(cell: str) -> None:
    assert issues(f"company_name,contact_phone\nA,{cell}\n") == []


@pytest.mark.parametrize("cell", ["a​b", "a‎b", "a‮b", "a\x00b", "a\x07b", "a﻿b", "a b"])
def test_a_cell_with_a_hidden_or_control_character_refuses_its_row(cell: str) -> None:
    r = rows_from_csv(f'company_name,city\nA,"{cell}"\n')
    assert [(i.code, i.column) for i in r.issues] == [
        ("hidden_characters", "city")
    ] and r.rows == []


def test_a_cell_that_is_too_long_refuses_its_row() -> None:
    assert issues("company_name,city\nA," + "x" * MAX_CELL + "\n") == []
    assert issues("company_name,city\nA," + "x" * (MAX_CELL + 1) + "\n") == [
        (2, "cell_too_long", "city")
    ]


def test_a_row_without_a_company_name_is_refused_here_because_the_whole_batch_would_be() -> None:
    r = rows_from_csv("company_name,city\n,Pune\n   ,Surat\nReal,Agra\n")
    assert [(i.line, i.code) for i in r.issues] == [
        (2, "company_name_missing"),
        (3, "company_name_missing"),
    ] and [row["company_name"] for row in r.rows] == ["Real"]


# ---------------------------------------------------------------------------------------------- nothing from the input is ever echoed
def test_no_issue_and_no_fatal_ever_repeats_a_cell_or_a_header_name() -> None:
    samples = [
        f"company_name,{CANARY}\nA,B\n",
        f"company_name,city,city\nA,{CANARY},C\n",
        f'company_name,city\nA,"=1+{CANARY}"\nB,@{CANARY}\n{CANARY}\nC,"x​{CANARY}"\n,{CANARY}\n',
        f'company_name\n"{CANARY}\n',
        f"company_name,categories\nA,{';'.join(CANARY + str(i) for i in range(11))}\nB,{CANARY * 20}\n",
        f"{CANARY}\n{CANARY}\n",
    ]
    for text in samples:
        r = rows_from_csv(text)
        shown = repr(r.fatal) + repr(r.issues)
        assert CANARY not in shown, text
        assert r.fatal is None or r.fatal in FATAL_CODES
        assert all(
            i.code in ROW_CODES and (i.column is None or i.column in COLUMNS) for i in r.issues
        )


INDIC_CELLS = [
    "హైదరా\u200cబాద్ శ్రీ\u200dనివాస్ సిల్క్స్",  # Telugu (invented), with ZWNJ and ZWJ
    "ಮೈಸೂರು\u200c ರೇಷ್ಮೆ ಮನೆ\u200d",  # Kannada
    "കൊച്ചിന്\u200d കൈത്തറി\u200c",  # Malayalam (a chillu typed with ZWJ)
    "क्\u200dष साड़ी भवन\u200c",  # Devanagari
]


@pytest.mark.parametrize("cell", INDIC_CELLS)
def test_indic_text_with_a_joiner_or_non_joiner_is_accepted(cell: str) -> None:
    r = rows_from_csv(f'company_name,city,contact_name\n"{cell}",{cell},"{cell}"\n')
    assert r.issues == [] and r.rows[0]["company_name"] == cell and r.rows[0]["city"] == cell


@pytest.mark.parametrize(
    "char",
    [
        "\u200b",  # zero-width space
        "\ufeff",  # BOM / zero-width no-break space
        "\u200e",
        "\u200f",  # direction marks
        "\u202a",
        "\u202b",
        "\u202c",
        "\u202d",
        "\u202e",  # bidi embeddings and overrides
        "\u2066",
        "\u2067",
        "\u2068",
        "\u2069",  # bidi isolates
        "\u2028",
        "\u2029",  # line and paragraph separators
        "\u2060",  # word joiner
        "\x00",
        "\x07",
        "\x1b",
        "\x7f",
        "\x85",  # controls
        "\ue000",  # private use
        "\U000e0001",  # a tag character
        "\u0378",  # unassigned
    ],
)
def test_each_hidden_character_is_refused_with_the_closed_code_and_never_echoed(char: str) -> None:
    secret = f"Zeta{char}Plant"
    r = rows_from_csv(f'company_name,city\n"{secret}",Pune\n')
    assert [(i.line, i.code, i.column) for i in r.issues] == [
        (2, "hidden_characters", "company_name")
    ]
    assert r.rows == [] and "Zeta" not in repr(r.issues) and "Plant" not in repr(r.issues)
    # next to a joiner the verdict is the same: the joiner does not launder its neighbour
    mixed = rows_from_csv(f'company_name,city\n"Zeta\u200d{char}Plant",Pune\n')
    assert [i.code for i in mixed.issues] == ["hidden_characters"]


def test_the_shared_rule_is_one_function() -> None:
    from app.text_rules import has_hidden_characters

    assert not has_hidden_characters("plain \n text") and not has_hidden_characters(
        "a\u200cb\u200dc"
    )
    assert has_hidden_characters("a\tb") and has_hidden_characters("a\u200bb")
