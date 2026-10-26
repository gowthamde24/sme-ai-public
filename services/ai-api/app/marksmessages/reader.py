"""Read a school's marks file for ONE send (job DP part 2, owner decision: the platform never stores children's marks).

Pure: bytes in, lines out. It reads no network, writes no file and keeps nothing between calls (module-level state: the closed header words only). It uses the same defensive spreadsheet reader as every import
(`app.integrations.sheet`: size and shape limits, formula cells reported never trusted), and every problem it finds is a CLOSED code with a line number and, at most, the NAME of the column at fault, never a cell.

The columns (English names; the aliases below are accepted too, any capitalisation, spaces or hyphens for underscores):
  phone      the guardian's WhatsApp number (matched to a contact of the school; a number nobody holds is reported, not invented)
  student    the child's first name or initials, as the school's records have it (goes into the message, nowhere else)
  subject    marks only        marks   the marks      out_of   the maximum (marks only)
  term       the exam or term (or one value for the whole file, given with the request)
  language   optional: en, te, hi or kn for that line (otherwise the language given with the request)"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass

from app.education import progress
from app.integrations.sheet import Grid, SheetRefused, load_grid
from app.suppression.keys import normalise_phone

ALIASES: dict[str, tuple[str, ...]] = {
    "phone": ("phone", "phone_number", "mobile", "mobile_number", "whatsapp", "whatsapp_number", "guardian_phone", "parent_phone", "contact", "फ़ोन", "फोन", "मोबाइल", "ఫోన్", "మొబైల్", "ಫೋನ್", "ಮೊಬೈಲ್"),
    "student": ("student", "student_name", "child", "child_name", "pupil", "name", "first_name", "विद्यार्थी", "छात्र", "బిడ్డ", "విద్యార్థి", "ಮಗು", "ವಿದ್ಯಾರ್ಥಿ"),
    "subject": ("subject", "विषय", "సబ్జెక్ట్", "విషయం", "ವಿಷಯ"),
    "marks": ("marks", "mark", "score", "marks_obtained", "obtained", "अंक", "మార్కులు", "ಅಂಕ", "ಅಂಕಗಳು"),
    "out_of": ("out_of", "outof", "max", "max_marks", "maximum", "total", "total_marks", "full_marks", "कुल", "మొత్తం", "ಒಟ್ಟು"),
    "term": ("term", "exam", "test", "exam_name", "परीक्षा", "పరీక్ష", "ಪರೀಕ್ಷೆ"),
    "language": ("language", "lang", "भाषा", "భాష", "ಭಾಷೆ"),
}
REQUIRED: dict[str, tuple[str, ...]] = {
    "marks": ("phone", "student", "subject", "marks", "out_of"),
    "report_ready": ("phone", "student"),
}
MAX_ROWS = 5_000
_SEP = re.compile(r"[\s\-]+")


class FileProblem(Exception):
    """The file as a whole cannot be used. `code` is closed; `fields` are column NAMES that are missing."""

    def __init__(self, code: str, fields: tuple[str, ...] = ()) -> None:
        super().__init__(code)
        self.code = code
        self.fields = fields


@dataclass(frozen=True)
class Line:
    """One message to make. Lives only inside one request."""

    seq: int
    phone: str
    language: str
    fields: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class Bad:
    line: int
    code: str
    field: str | None = None


@dataclass(frozen=True)
class Reading:
    sha256: str
    rows: int
    lines: list[Line]
    bad: list[Bad]
    duplicates: int


def _norm_header(text: str) -> str:
    return _SEP.sub("_", unicodedata.normalize("NFKC", text).strip().lower())


def _columns(header: list[str]) -> dict[str, int]:
    found: dict[str, int] = {}
    wanted = {alias: field for field, names in ALIASES.items() for alias in names}
    for index, raw in enumerate(header):
        field = wanted.get(_norm_header(raw))
        if field is not None and field not in found:
            found[field] = index
    return found


def read(data: bytes, kind: str, default_language: str, default_term: str | None) -> Reading:
    """The lines of the file, ready to be turned into messages, and the lines that cannot be."""
    if kind not in REQUIRED or default_language not in progress.LANGUAGES:
        raise FileProblem("bad_request")
    try:
        grid: Grid = load_grid(data)
    except SheetRefused as exc:
        raise FileProblem(f"file_{exc.code}") from None
    cols = _columns(grid.header)
    missing = tuple(f for f in REQUIRED[kind] if f not in cols)
    if "term" not in cols and not default_term:
        missing = (*missing, "term")
    if missing:
        raise FileProblem("missing_column", missing)
    lines: list[Line] = []
    bad: list[Bad] = []
    seen: set[str] = set()
    duplicates = 0
    for index, row in enumerate(grid.rows):
        number = grid.lines[index]
        if any((index, ci) in grid.formulas for ci in cols.values()):
            bad.append(Bad(number, "formula_cell"))
            continue
        cell = {field: row[ci].strip() for field, ci in cols.items()}
        phone = normalise_phone(cell["phone"])
        if phone is None or len(phone) > 15:
            bad.append(Bad(number, "bad_phone", "phone"))
            continue
        language = (cell.get("language") or default_language).strip().lower()
        if language not in progress.LANGUAGES:
            bad.append(Bad(number, "bad_language", "language"))
            continue
        values: dict[str, object] = {f: cell[f] for f in progress.FIELDS[kind] if f in cell}
        values["term"] = cell.get("term") or default_term or ""
        problem = _first_problem(kind, language, values)
        if problem is not None:
            bad.append(Bad(number, "bad_value", problem))
            continue
        key = hashlib.sha256("\x1f".join([phone, *(str(values[f]).casefold() for f in progress.FIELDS[kind])]).encode()).hexdigest()
        if key in seen:
            duplicates += 1
            bad.append(Bad(number, "duplicate_row"))
            continue
        seen.add(key)
        lines.append(Line(number, phone, language, tuple((f, str(values[f])) for f in progress.FIELDS[kind])))
    return Reading(hashlib.sha256(data).hexdigest(), len(grid.rows), lines, bad, duplicates)


def _first_problem(kind: str, language: str, values: dict[str, object]) -> str | None:
    """The NAME of the first field the fixed template would refuse, or None. The template itself decides (education/progress.py); this only names the field."""
    fields = {f: values[f] for f in progress.FIELDS[kind]}
    try:
        progress.render(kind, language, "School", fields)
    except progress.ProgressMessageError as exc:
        text = str(exc)
        for name in progress.FIELDS[kind]:
            if text.startswith(name + " ") or text.startswith(name + ","):
                return name
        if "marks cannot be above" in text:
            return "marks"
        return "value"
    return None
