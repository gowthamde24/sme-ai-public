"""CSV to lead-import rows (the rehearsal's front door for leads; thin-slice plan, item 4).

Turns the TEXT of a CSV into the JSON rows `POST /leads/import` takes (`ImportRowInput`), and nothing else: it does not look at the database, does not decide what a duplicate or a bad
e-mail is (the import does, and says why per row), and never invents a value. What it DOES guard is the input itself:

  * size and shape: at most MAX_BYTES of text, at most MAX_ROWS data rows (the import's own batch limit), at most MAX_CELL characters a cell, one comma-separated table, UTF-8 text with
    one optional BOM; a row with a different number of cells than the header is refused;
  * the header: names are trimmed and compared case-insensitively; a column the import does not know, a repeated column or a missing `company_name` column refuses the whole file;
  * every cell is TREATED AS UNTRUSTED: a cell that would be read as a formula by a spreadsheet (it starts with `=` or `@`, a tab or a carriage return, or with `+` / `-` followed by
    anything but a phone-number character) refuses its row, and so does a cell with a control or invisible character (zero-width, bidirectional marks, NUL). A leading `+` is a phone
    number's, so `+00 90000 10001` passes;
  * a row without a company name cannot be an import row at all (the import's batch would be refused as a whole), so it is refused here, with its line number.

ERRORS NEVER ECHO A CELL VALUE (or a header name that is not on the known list): an issue is a line number, a closed code and, where one is meant, the name of a KNOWN column."""

from __future__ import annotations

import csv
import io
import unicodedata
from dataclasses import dataclass, field

MAX_BYTES = 1_000_000
MAX_ROWS = 500
MAX_CELL = 500
MAX_CATEGORIES = 10
MAX_CATEGORY = 40

COLUMNS: tuple[str, ...] = (
    "company_name", "website", "country", "city", "industry", "categories", "contact_name", "contact_email", "contact_phone", "contact_job_title",
    "source", "buyer_type", "size_band", "operating_status", "order_scale",
)  # fmt: skip
_PHONE_CHARS = frozenset("0123456789 ()-.")
_FORMULA_START = ("=", "@", "\t", "\r")

# the closed list of codes (an issue carries one of these and nothing from the input)
FATAL_CODES = (
    "empty",
    "too_large",
    "not_utf8",
    "malformed_csv",
    "unknown_column",
    "duplicate_column",
    "missing_company_column",
    "too_many_rows",
)
ROW_CODES = (
    "column_count",
    "cell_too_long",
    "formula_like",
    "hidden_characters",
    "company_name_missing",
    "too_many_categories",
    "category_too_long",
)


@dataclass(frozen=True)
class RowIssue:
    line: int  # the line number in the CSV (the header is line 1)
    code: str
    column: str | None = None  # a KNOWN column name, or None


@dataclass
class CsvRows:
    rows: list[dict[str, object]] = field(default_factory=list)
    lines: list[int] = field(
        default_factory=list
    )  # the CSV line number of each accepted row, in order
    issues: list[RowIssue] = field(default_factory=list)
    fatal: str | None = None

    @property
    def ok(self) -> bool:
        return self.fatal is None


def _formula_like(cell: str) -> bool:
    if cell.startswith(_FORMULA_START):
        return True
    if cell[:1] == "+":
        # a phone number: one leading plus, then digits and the usual separators only
        return not (len(cell) > 1 and all(c in _PHONE_CHARS for c in cell[1:]))
    return cell[:1] == "-"


def _hidden(cell: str) -> bool:
    for char in cell:
        category = unicodedata.category(char)
        if category in ("Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp") and char not in "\n":
            return True
    return False


def _fatal(code: str) -> CsvRows:
    return CsvRows(fatal=code)


def rows_from_csv(text: str) -> CsvRows:
    """Parse `text` (already decoded UTF-8) into import rows. Never raises on bad input: a refusal is in `fatal` or in `issues`."""
    if not isinstance(text, str):
        return _fatal("not_utf8")
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError:
        return _fatal("not_utf8")
    if size > MAX_BYTES:
        return _fatal("too_large")
    body = text[1:] if text.startswith("﻿") else text
    if not body.strip():
        return _fatal("empty")
    try:
        table = list(csv.reader(io.StringIO(body, newline=""), strict=True))
    except csv.Error:
        return _fatal("malformed_csv")
    if not table:
        return _fatal("empty")
    header = [h.strip().lower() for h in table[0]]
    if any(h not in COLUMNS for h in header):
        return _fatal("unknown_column")
    if len(set(header)) != len(header):
        return _fatal("duplicate_column")
    if "company_name" not in header:
        return _fatal("missing_company_column")
    data = [
        (n, r) for n, r in enumerate(table[1:], start=2) if any(c.strip() for c in r)
    ]  # blank lines are not rows
    if len(data) > MAX_ROWS:
        return _fatal("too_many_rows")
    result = CsvRows()
    for line, cells in data:
        if len(cells) != len(header):
            result.issues.append(RowIssue(line, "column_count"))
            continue
        row: dict[str, object] = {}
        issue: RowIssue | None = None
        for name, raw in zip(header, cells, strict=True):
            cell = raw.strip()
            if not cell:
                continue
            if len(cell) > MAX_CELL:
                issue = RowIssue(line, "cell_too_long", name)
            elif _hidden(cell):
                issue = RowIssue(line, "hidden_characters", name)
            elif _formula_like(raw.lstrip(" ")):
                issue = RowIssue(line, "formula_like", name)
            if issue is not None:
                break
            if name == "categories":
                parts = [p.strip() for p in cell.split(";") if p.strip()]
                if len(parts) > MAX_CATEGORIES:
                    issue = RowIssue(line, "too_many_categories", name)
                    break
                if any(len(p) > MAX_CATEGORY for p in parts):
                    issue = RowIssue(line, "category_too_long", name)
                    break
                row[name] = parts
            else:
                row[name] = cell
        if issue is None and not row.get("company_name"):
            issue = RowIssue(line, "company_name_missing", "company_name")
        if issue is not None:
            result.issues.append(issue)
            continue
        result.rows.append(row)
        result.lines.append(line)
    return result
