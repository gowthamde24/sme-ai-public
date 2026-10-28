"""Text out of an uploaded file (job EB part A). Everything about the file is untrusted: size and shape are bounded, a spreadsheet goes through the defensive reader, a Word file is read with a plain pattern from one
member of its zip (no XML parser, so no entity tricks), and a refusal is a closed CODE, never a message that echoes the file. PDF and pictures are NOT read yet (no PDF library and no image input in the model interface)."""

from __future__ import annotations

import io
import re
import zipfile

from app.integrations.sheet import MAX_UPLOAD_BYTES, SheetRefused, load_grid

MAX_TEXT = 60_000
MAX_DOCX_XML = 6_000_000


class Unreadable(Exception):
    """`code`: file_too_large | file_unreadable | sheet_refused | not_supported_yet."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise Unreadable("file_unreadable")


def _sheet_text(data: bytes) -> tuple[str, bool]:
    try:
        grid = load_grid(data)
    except SheetRefused:
        raise Unreadable("sheet_refused") from None
    lines = [" | ".join(h or f"column {i + 1}" for i, h in enumerate(grid.header))]
    for row in grid.rows:
        lines.append(" | ".join(row))
    return "\n".join(lines), grid.cut_cells > 0


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML:
                raise Unreadable("file_too_large")
            xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError, RuntimeError):
        raise Unreadable("file_unreadable") from None
    if "<!DOCTYPE" in xml or "<!ENTITY" in xml:
        raise Unreadable("file_unreadable")
    xml = re.sub(r"</w:p>|<w:br\s*/>|<w:tab\s*/>", "\n", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    return re.sub(r"&amp;", "&", re.sub(r"&lt;", "<", re.sub(r"&gt;", ">", text)))


def text_from_file(filename: str | None, data: bytes) -> tuple[str, list[str]]:
    """(the text, warnings) of an uploaded file, by what it IS (its first bytes), not by what its name says."""
    if not data:
        raise Unreadable("file_unreadable")
    if len(data) > MAX_UPLOAD_BYTES:
        raise Unreadable("file_too_large")
    warnings: list[str] = []
    name = (filename or "").lower()
    if data[:4] == b"%PDF" or data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n" or name.endswith((".pdf", ".jpg", ".jpeg", ".png")):
        raise Unreadable("not_supported_yet")
    if data[:2] == b"PK":
        if name.endswith(".docx") or b"word/" in data[:2000]:
            text = _docx_text(data)
        else:
            text, cut = _sheet_text(data)
            if cut:
                warnings.append("cells_cut")
    elif name.endswith((".csv", ".tsv", ".xlsx")):
        text, cut = _sheet_text(data)
        if cut:
            warnings.append("cells_cut")
    else:
        text = _decode(data)
    text = text.strip()
    if not text:
        raise Unreadable("file_unreadable")
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT]
        warnings.append("illegible_part")   # (the rest was left out)
    return text, warnings
