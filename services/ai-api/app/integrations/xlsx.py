"""A small XLSX writer and a defensive XLSX reader, with the standard library only (zipfile + xml). No new dependency: a workbook here is a few sheets of text and numbers.

WRITER: strings are written as inline strings (a cell is TEXT, never a formula; one that starts with = + - @ tab or CR also gets a leading apostrophe), numbers as numbers; a bold header row, a frozen first row, column widths. The zip is
written with a fixed timestamp, so the same input gives the same bytes.

READER (untrusted input): the file is checked before anything is parsed. At most MAX_ZIP_BYTES compressed and MAX_UNCOMPRESSED bytes in all, at most MAX_MEMBERS parts, no encrypted part, no
XML that declares a DOCTYPE or an ENTITY (an OOXML part never does; this closes entity-expansion attacks), at most MAX_ROWS rows and MAX_COLS columns, cells cut off at MAX_CELL characters. A cell
that holds a FORMULA is reported (its cached value is never trusted). Only the cell values are read: no macros, links, images or external data are ever followed."""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.etree import ElementTree as ET  # noqa: S405 - input is screened for DOCTYPE / ENTITY first
from xml.sax.saxutils import escape

MAX_ZIP_BYTES = 3_000_000
MAX_UNCOMPRESSED = 20_000_000
MAX_MEMBERS = 100
MAX_ROWS = 5_200  # job CK: 5,000 data rows, the header and a few formatted blank rows
MAX_COLS = 60
MAX_CELL = 2_000

_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
_XML_BAD = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.I)
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


# ----------------------------------------------------------------------------------------------------------------------------- writer
def _col(n: int) -> str:
    name = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        name = chr(65 + r) + name
    return name


def _cell(ref: str, value: Any, style: int) -> str:
    if value is None or value == "":
        return f'<c r="{ref}" s="{style}"/>' if style else ""
    if isinstance(value, bool):
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{"TRUE" if value else "FALSE"}</t></is></c>'
    if isinstance(value, int | float | Decimal):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    text = _CTRL.sub("", str(value))
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text  # defence in depth: stored as text already, but the cell may be copied into a CSV or another program
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def _sheet_xml(rows: list[list[Any]], widths: list[int] | None) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
    out.append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
    width = max((len(r) for r in rows), default=1)
    if widths or rows:
        out.append("<cols>")
        for i in range(width):
            w = (widths[i] if widths and i < len(widths) else 18)
            out.append(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>')
        out.append("</cols>")
    out.append("<sheetData>")
    for r, row in enumerate(rows, start=1):
        cells = "".join(_cell(f"{_col(c)}{r}", v, 1 if r == 1 else 0) for c, v in enumerate(row))
        out.append(f'<row r="{r}">{cells}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


def write_xlsx(sheets: list[tuple[str, list[list[Any]]]]) -> bytes:
    """`sheets`: [(name, rows)], the first row of each being its header. Returns the workbook bytes."""
    names = []
    for name, _ in sheets:
        clean = re.sub(r"[\[\]:*?/\\]", " ", name).strip()[:31] or "Sheet"
        names.append(clean)
    if len(set(n.lower() for n in names)) != len(names):
        raise ValueError("sheet names must be distinct")
    buf = io.BytesIO()
    fixed = (2026, 1, 1, 0, 0, 0)

    def put(zf: zipfile.ZipFile, path: str, text: str) -> None:
        info = zipfile.ZipInfo(path, date_time=fixed)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o600 << 16
        zf.writestr(info, text.encode("utf-8"))

    with zipfile.ZipFile(buf, "w") as zf:
        ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
              '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
              '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
        for i in range(len(sheets)):
            ct.append(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        ct.append("</Types>")
        put(zf, "[Content_Types].xml", "".join(ct))
        put(zf, "_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                               '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets_xml = "".join(f'<sheet name="{escape(n, {chr(34): "&quot;"})}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names))
        put(zf, "xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                                   f'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets_xml}</sheets></workbook>')
        rels = "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(sheets)))
        rels += f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        put(zf, "xl/_rels/workbook.xml.rels", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')
        put(zf, "xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                                 '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                                 '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                                 '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                                 '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                                 '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
                                 '</styleSheet>')
        for i, (_, rows) in enumerate(sheets):
            widths = [min(48, max(10, max((len(str(r[c])) if c < len(r) and r[c] is not None else 0) for r in rows[:200]) + 2)) for c in range(max((len(r) for r in rows), default=1))] if rows else None
            put(zf, f"xl/worksheets/sheet{i + 1}.xml", _sheet_xml(rows, widths))
    return buf.getvalue()


# ----------------------------------------------------------------------------------------------------------------------------- reader
class XlsxRefused(Exception):
    """The file cannot be read safely. `code` is one of: not_xlsx, too_large, too_many_parts, encrypted, unsafe_xml, unreadable, no_sheet, too_many_rows, too_many_columns."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class Sheet:
    name: str
    rows: list[list[str]] = field(default_factory=list)
    formulas: set[tuple[int, int]] = field(default_factory=set)  # (row index, column index), 0-based, of the cells that hold a formula
    truncated_cells: int = 0


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return "".join(t.text or "" for t in el.iter(f"{{{_NS['m']}}}t"))


def _num(raw: str) -> str:
    try:
        d = Decimal(raw)
    except InvalidOperation:
        return raw
    if d == d.to_integral_value():
        return str(int(d))
    return format(d.normalize(), "f")


def _parse(data: bytes) -> ET.Element:
    if _XML_BAD.search(data):
        raise XlsxRefused("unsafe_xml")
    try:
        return ET.fromstring(data)  # noqa: S314 - screened above
    except ET.ParseError:
        raise XlsxRefused("unreadable") from None


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref)
    if not letters:
        raise XlsxRefused("unreadable")
    n = 0
    for ch in letters.group(0):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx(data: bytes, sheet_index: int = 0) -> Sheet:
    if len(data) > MAX_ZIP_BYTES:
        raise XlsxRefused("too_large")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise XlsxRefused("not_xlsx") from None
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_MEMBERS:
            raise XlsxRefused("too_many_parts")
        if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
            raise XlsxRefused("too_large")
        if any(i.flag_bits & 0x1 for i in infos):
            raise XlsxRefused("encrypted")
        names = {i.filename for i in infos}
        if "xl/workbook.xml" not in names:
            raise XlsxRefused("not_xlsx")

        def part(path: str) -> bytes:
            if path not in names:
                raise XlsxRefused("unreadable")
            info = zf.getinfo(path)
            if info.file_size > MAX_UNCOMPRESSED:
                raise XlsxRefused("too_large")
            with zf.open(info) as fh:
                body = fh.read(MAX_UNCOMPRESSED + 1)
            if len(body) > MAX_UNCOMPRESSED:
                raise XlsxRefused("too_large")
            return body

        workbook = _parse(part("xl/workbook.xml"))
        sheets = workbook.findall("m:sheets/m:sheet", _NS)
        if not sheets or sheet_index >= len(sheets):
            raise XlsxRefused("no_sheet")
        chosen = sheets[sheet_index]
        rid = chosen.get(_REL)
        rels = _parse(part("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target") or ""
        if not target:
            raise XlsxRefused("no_sheet")
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        path = re.sub(r"[^/]+/\.\./", "", path)
        strings: list[str] = []
        if "xl/sharedStrings.xml" in names:
            for si in _parse(part("xl/sharedStrings.xml")).findall("m:si", _NS):
                strings.append(_text(si))
        sheet_el = _parse(part(path))
        out = Sheet(name=chosen.get("name") or "Sheet1")
        for row in sheet_el.findall("m:sheetData/m:row", _NS):
            r = int(row.get("r") or len(out.rows) + 1) - 1
            if r >= MAX_ROWS:
                raise XlsxRefused("too_many_rows")
            while len(out.rows) <= r:
                out.rows.append([])
            cells = out.rows[r]
            for c in row.findall("m:c", _NS):
                ci = _col_index(c.get("r") or "A1")
                if ci >= MAX_COLS:
                    raise XlsxRefused("too_many_columns")
                while len(cells) <= ci:
                    cells.append("")
                kind = c.get("t")
                v = c.find("m:v", _NS)
                if c.find("m:f", _NS) is not None:
                    out.formulas.add((r, ci))
                    continue
                if kind == "s":
                    idx = int(v.text) if v is not None and v.text is not None and v.text.isdigit() else -1
                    value = strings[idx] if 0 <= idx < len(strings) else ""
                elif kind == "inlineStr":
                    value = _text(c.find("m:is", _NS))
                elif kind in ("str", "e"):
                    value = (v.text or "") if v is not None else ""
                elif kind == "b":
                    value = "TRUE" if v is not None and v.text == "1" else "FALSE"
                else:
                    value = _num(v.text) if v is not None and v.text else ""
                if len(value) > MAX_CELL:
                    value = value[:MAX_CELL]
                    out.truncated_cells += 1
                cells[ci] = value
        return out
