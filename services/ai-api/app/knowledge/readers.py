"""Reading what the Owner uploads (job DR / A1): a brochure, a price list, an FAQ. Only the TEXT is kept; the file is read in memory and dropped.

  * plain text, Markdown, CSV and HTML are decoded;
  * a Word document (.docx) is read with the standard library (a zip of XML; the paragraphs and table cells in order);
  * a PDF with real text is read with the standard library (best effort: the text operators of the page streams); a scanned PDF or a PDF whose fonts hide the text gives too little and is treated as an image;
  * an image (png, jpeg, webp) and a scanned PDF need an OCR/vision reader: a `DocumentReader` that is configured separately (none today: 503 `reader_unavailable`, "type or paste it instead").

The file type is decided by its first bytes, not by the name or the type the browser claimed. A zip bigger than 20 MB once opened is refused (a decompression bomb). Nothing here reads the network."""

from __future__ import annotations

import html
import io
import re
import zipfile
import zlib
from typing import Protocol

from app.knowledge.models import MAX_FILE_BYTES, MAX_PASTE_CHARS

MIN_PDF_TEXT = 40
MAX_UNZIPPED = 20 * 1024 * 1024


class ReaderError(Exception):
    """A constant `code`; never file content."""

    code = "unreadable_file"


class TooLarge(ReaderError):
    code = "source_too_large"


class Unsupported(ReaderError):
    code = "unsupported_type"


class Unreadable(ReaderError):
    code = "unreadable_file"


class NoText(ReaderError):
    code = "no_text_found"


class ReaderUnavailable(ReaderError):
    code = "reader_unavailable"


class DocumentReader(Protocol):
    """Reads text out of an image or a scanned PDF (OCR or a vision model). Behind an interface: none is configured today."""

    name: str

    def read(self, data: bytes, kind: str) -> str: ...


class FakeDocumentReader:
    """For tests and local runs: 'reads' a fixed text from any image or scanned PDF."""

    name = "fake"

    def __init__(self, text: str = "Sample brochure. Open every day from 10 am to 6 pm. Site visits are free.") -> None:
        self.text, self.calls = text, 0

    def read(self, data: bytes, kind: str) -> str:
        self.calls += 1
        return self.text


def sniff(data: bytes) -> str:
    """text | docx | pdf | image | unknown, from the first bytes."""
    head = data[:8]
    if data.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"PK\x03\x04"):
        return "docx" if _is_docx(data) else "unknown"
    if head.startswith(b"\x89PNG") or head.startswith(b"\xff\xd8\xff") or (head.startswith(b"RIFF") and data[8:12] == b"WEBP"):
        return "image"
    if b"\x00" in data[:2048] and not (data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff")):
        return "unknown"
    return "text"


def _is_docx(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return "word/document.xml" in z.namelist()
    except zipfile.BadZipFile:
        return False


def _decode(data: bytes) -> str:
    # UTF-16 only when it says so (a byte-order mark): otherwise Windows text (cp1252) would be misread as UTF-16
    order = ("utf-16",) if data[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig", "cp1252", "latin-1")
    for encoding in order:
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise Unreadable


def _strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", text)
    text = re.sub(r"(?i)</(p|div|li|tr|h[1-6]|br)\s*>|<br\s*/?>", "\n", text)
    return html.unescape(re.sub(r"(?s)<[^>]+>", " ", text))


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
                raise TooLarge
            xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError):
        raise Unreadable from None
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"</w:tc>", " | ", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    xml = re.sub(r"<w:br\s*/?>", "\n", xml)
    pieces = re.sub(r"<(?!/?w:t[ >/])[^>]*>", "", xml)   # drop every tag except the text runs
    return html.unescape(re.sub(r"</?w:t[^>]*>", "", pieces))


_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
_TEXT_BLOCK = re.compile(rb"BT(.*?)ET", re.DOTALL)
_LITERAL = re.compile(rb"\(((?:\\.|[^\\()])*)\)")
_ARRAY = re.compile(rb"\[(.*?)\]\s*TJ", re.DOTALL)
_SHOW = re.compile(rb"\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|\")")
_ESCAPES = {ord("n"): b"\n", ord("r"): b"\n", ord("t"): b"\t", ord("b"): b"", ord("f"): b"", ord("("): b"(", ord(")"): b")", ord("\\"): b"\\"}


def _unescape(raw: bytes) -> bytes:
    out, i = bytearray(), 0
    while i < len(raw):
        c = raw[i]
        if c == 0x5C and i + 1 < len(raw):
            n = raw[i + 1]
            if n in _ESCAPES:
                out += _ESCAPES[n]
                i += 2
                continue
            if 0x30 <= n <= 0x37:
                j = i + 1
                octal = b""
                while j < len(raw) and len(octal) < 3 and 0x30 <= raw[j] <= 0x37:
                    octal += raw[j : j + 1]
                    j += 1
                out.append(int(octal, 8) & 0xFF)
                i = j
                continue
            i += 1
            continue
        out.append(c)
        i += 1
    return bytes(out)


def _pdf_text(data: bytes) -> str:
    """Best effort with the standard library: inflate the page streams and read the text-showing operators. A PDF whose fonts do not map characters plainly (most Indian-language PDFs) yields little: the caller then treats it as a scan."""
    chunks: list[str] = []
    for match in _STREAM.finditer(data):
        raw = match.group(1)
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            pass
        for block in _TEXT_BLOCK.finditer(raw):
            body = block.group(1)
            line: list[bytes] = []
            for shown in _SHOW.finditer(body):
                line.append(_unescape(shown.group(1)))
            for arr in _ARRAY.finditer(body):
                line.append(b"".join(_unescape(s) for s in _LITERAL.findall(arr.group(1))))
            if line:
                chunks.append(b" ".join(line).decode("latin-1"))
    text = "\n".join(chunks)
    return re.sub(r"[^\S\n]+", " ", text)


def _readable(text: str) -> bool:
    letters = sum(ch.isalpha() for ch in text)
    return len(text.strip()) >= MIN_PDF_TEXT and letters / max(1, len(text.replace(" ", "").replace("\n", ""))) > 0.6


def clean(text: str) -> str:
    """The text as it is kept: no zero-width or control characters the database refuses, blank lines folded, at most 60,000 characters."""
    text = re.sub(r"[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​  ‪-‮⁠-⁤⁦-⁩﻿]", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:MAX_PASTE_CHARS]


def read_document(data: bytes, ocr: DocumentReader | None = None) -> str:
    """The text of an uploaded file. Raises a ReaderError with a constant code."""
    if len(data) > MAX_FILE_BYTES:
        raise TooLarge
    if not data:
        raise Unreadable
    kind = sniff(data)
    if kind == "unknown":
        raise Unsupported
    if kind == "text":
        text = _decode(data)
        if "<html" in text[:2000].lower() or "</p>" in text.lower()[:20000]:
            text = _strip_html(text)
    elif kind == "docx":
        text = _docx_text(data)
    elif kind == "pdf":
        text = _pdf_text(data)
        if not _readable(text):
            if ocr is None:
                raise ReaderUnavailable
            text = ocr.read(data, "pdf")
    else:
        if ocr is None:
            raise ReaderUnavailable
        text = ocr.read(data, "image")
    text = clean(text)
    if not text:
        raise NoText
    return text
