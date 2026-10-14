"""A spreadsheet upload as a grid of text: CSV (UTF-8 with or without a byte-order mark, or UTF-16 with one) or XLSX (the first sheet). Google Sheets > File > Download > CSV or Microsoft Excel works.

Everything about the file is untrusted. Size and shape are bounded (the limits below); a CSV is parsed strictly; an XLSX goes through the defensive reader (app/integrations/xlsx.py); a cell that is a
formula in an XLSX is reported, never evaluated or trusted. The result never contains a cell that is longer than MAX_CELL (it is cut and counted). A refusal is a closed CODE, never a message that echoes
the file."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

from app.integrations.xlsx import MAX_COLS, MAX_ROWS, XlsxRefused, read_xlsx

# job CK (blueprint section 6): 5,000 data rows. The database takes at most 500 per call (the lead import's own batch limit), so the import runs a larger file in PARTS of 500 (routes_import.py)
MAX_UPLOAD_BYTES = 3_000_000
MAX_CSV_BYTES = 2_000_000
MAX_DATA_ROWS = 5_000
PART_ROWS = 500
MAX_CELL = 500

REFUSALS = (
    "empty", "too_large", "not_utf8", "malformed_csv", "too_many_rows", "too_many_columns", "no_header",
    "not_xlsx", "too_many_parts", "encrypted", "unsafe_xml", "unreadable", "no_sheet",
)  # fmt: skip


class SheetRefused(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class Grid:
    kind: str  # csv | xlsx
    header: list[str]
    rows: list[list[str]]  # data rows, padded to the header width
    lines: list[int]  # the 1-based line (row) number each data row had in the file
    formulas: set[tuple[int, int]] = field(default_factory=set)  # (index into rows, column index) of an XLSX formula cell
    cut_cells: int = 0


def _decode(data: bytes) -> str:
    try:
        if data.startswith((b"\xff\xfe", b"\xfe\xff")):
            return data.decode("utf-16")
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise SheetRefused("not_utf8") from None


def _delimiter(first_line: str) -> str:
    return "\t" if first_line.count("\t") > first_line.count(",") else ","


def _clean(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    cut = 0
    out: list[list[str]] = []
    for r in rows:
        row = []
        for c in r:
            c = c.strip()
            if len(c) > MAX_CELL:
                c = c[:MAX_CELL]
                cut += 1
            row.append(c)
        out.append(row)
    return out, cut


def load_grid(data: bytes) -> Grid:
    if not data or not data.strip():
        raise SheetRefused("empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise SheetRefused("too_large")
    formulas: set[tuple[int, int]] = set()
    if data[:2] == b"PK":
        try:
            sheet = read_xlsx(data)
        except XlsxRefused as exc:
            raise SheetRefused(exc.code if exc.code in REFUSALS else "unreadable") from None
        table = [list(r) for r in sheet.rows]
        kind = "xlsx"
        xlsx_formulas = sheet.formulas
    else:
        if len(data) > MAX_CSV_BYTES:
            raise SheetRefused("too_large")
        text = _decode(data)
        first = text.lstrip("\r\n").split("\n", 1)[0]
        try:
            table = [list(r) for r in csv.reader(io.StringIO(text, newline=""), delimiter=_delimiter(first), strict=True)]
        except csv.Error:
            raise SheetRefused("malformed_csv") from None
        kind = "csv"
        xlsx_formulas = set()
        if len(table) > MAX_ROWS:
            raise SheetRefused("too_many_rows")
    keep = [i for i, r in enumerate(table) if any(c.strip() for c in r)]  # blank lines are not rows
    if not keep:
        raise SheetRefused("empty")
    table_clean, cut = _clean([table[i] for i in keep])
    width = len(table_clean[0])
    while width and not table_clean[0][width - 1]:
        width -= 1  # trailing empty header cells
    if width == 0:
        raise SheetRefused("no_header")
    if width > MAX_COLS:
        raise SheetRefused("too_many_columns")
    header = table_clean[0][:width]
    body = table_clean[1:]
    if len(body) > MAX_DATA_ROWS:
        raise SheetRefused("too_many_rows")
    rows = [(r + [""] * width)[:width] for r in body]
    lines = [keep[i + 1] + 1 for i in range(len(body))]
    for (ri, ci) in xlsx_formulas:
        if ri in keep and keep.index(ri) >= 1 and ci < width:
            formulas.add((keep.index(ri) - 1, ci))
    return Grid(kind, header, rows, lines, formulas, cut)
