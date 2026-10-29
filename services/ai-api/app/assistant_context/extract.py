"""Text out of an uploaded file (job EB part A). Everything about the file is untrusted: size and shape are bounded, a spreadsheet goes through the defensive reader, a Word file is read with a plain pattern from one
member of its zip (no XML parser, so no entity tricks), and a refusal is a closed CODE, never a message that echoes the file. A PDF or a picture is not turned into text here: it becomes an ATTACHMENT for the model, which reads it (scanned pages and photos too).
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field

from app.agents.llm.interface import Attachment
from app.integrations.sheet import MAX_UPLOAD_BYTES, SheetRefused, load_grid

MAX_TEXT = 60_000
MAX_DOCX_XML = 6_000_000
MAX_PDF_PAGES = 25         # more than this and the owner is asked to send fewer pages
TOKENS_PER_PAGE = 3_000    # an upper bound of what reading one PDF page costs (text and picture of the page)
TOKENS_PER_IMAGE = 2_500
_PAGE = re.compile(rb"/Type\s*/Page(?![s\w])")
_IMAGES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


class Unreadable(Exception):
    """`code`: file_too_large | file_too_long | file_unreadable | sheet_refused."""

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
    if data[:4] == b"%PDF" or _image_type(data) is not None or name.endswith((".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif")):
        raise Unreadable("file_unreadable")   # (read_file handles these; reaching here means a name that lies about its content)
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


@dataclass
class Read:
    """What a file gave: its text (spreadsheets, Word, text files) or an attachment for the model (a PDF, a picture; `text` is then empty), and plain warnings."""

    text: str
    warnings: list[str] = field(default_factory=list)
    attachment: Attachment | None = None


def _image_type(data: bytes) -> str | None:
    for magic, media in _IMAGES:
        if data.startswith(magic):
            return media
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def read_file(filename: str | None, data: bytes) -> Read:
    """A PDF or a picture becomes an attachment (by what it IS, not by its name); anything else is read as text by text_from_file."""
    if not data:
        raise Unreadable("file_unreadable")
    if len(data) > MAX_UPLOAD_BYTES:
        raise Unreadable("file_too_large")
    media = _image_type(data)
    if media is not None:
        return Read("", [], Attachment("image", media, data, TOKENS_PER_IMAGE))
    if data.startswith(b"%PDF"):
        if b"/Encrypt" in data[-4096:] or b"/Encrypt" in data[:4096]:
            raise Unreadable("file_unreadable")
        pages = max(len(_PAGE.findall(data)), -(-len(data) // 30_000), 1)   # page objects counted; a compressed file falls back on its size
        if pages > MAX_PDF_PAGES:
            raise Unreadable("file_too_long")
        return Read("", [], Attachment("document", "application/pdf", data, pages * TOKENS_PER_PAGE + 1_000))
    text, warnings = text_from_file(filename, data)
    return Read(text, warnings)
