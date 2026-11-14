"""What a file dropped in the chat is (job assistant-does-the-work A2). The kind is decided by code from its name, its declared type and its first bytes; nothing in the file is run or believed
(it is untrusted content: a sheet's cells are text, a document's words are never instructions)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Literal

FileKind = Literal["sheet", "pdf", "image", "doc", "contacts", "text"]

# the API's request limit is 20 MB and the bytes arrive as base64 (4/3 bigger): 15 MB of file fits (14 Nov 2026: was 10)
MAX_FILE_BYTES = 15_000_000
MAX_FILES_PER_MESSAGE = 5
MAX_ROWS = 5_000
# the lead import's own limit for one file (app/lead_sources/models.py MAX_FILE_BYTES)
MAX_LEADS_FILE_BYTES = 3_000_000

_BY_EXTENSION: dict[str, FileKind] = {
    "csv": "sheet", "tsv": "sheet", "xlsx": "sheet", "xls": "sheet", "ods": "sheet",
    "vcf": "contacts", "vcard": "contacts",
    "pdf": "pdf",
    "png": "image", "jpg": "image", "jpeg": "image", "webp": "image", "heic": "image", "gif": "image",
    "doc": "doc", "docx": "doc", "odt": "doc", "rtf": "doc",
    "txt": "text", "text": "text", "md": "text",
}
_BY_TYPE: dict[str, FileKind] = {
    "text/csv": "sheet", "text/tab-separated-values": "sheet", "application/vnd.ms-excel": "sheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
    "application/vnd.oasis.opendocument.spreadsheet": "sheet", "text/vcard": "contacts", "text/x-vcard": "contacts", "application/pdf": "pdf",
    "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc", "text/plain": "text",
}
_TYPE = re.compile(r"^[a-z0-9.+-]+/[a-z0-9.+-]+$")


def content_type_of(raw: str) -> str:
    value = (raw or "").split(";", 1)[0].strip().lower()
    return value if _TYPE.fullmatch(value) and len(value) <= 100 else "application/octet-stream"


def kind_of(name: str, content_type: str, head: bytes) -> FileKind | None:
    """The kind, or None when it is none of the kinds the chat takes. The first bytes win over a wrong name (a PDF named .csv is a PDF)."""
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF8")) or (head.startswith(b"RIFF") and head[8:12] == b"WEBP") or (head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"heif", b"mif1", b"avif")):
        return "image"
    if head.startswith((b"RIFF", b"ID3", b"OggS", b"fLaC", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")) or head[4:8] == b"ftyp":
        return None   # audio (a WAV, MP3, Ogg, FLAC, M4A) or a video: never kept here, whatever its name says
    if head.lstrip(b"\xef\xbb\xbf \r\n\t").upper().startswith(b"BEGIN:VCARD"):
        return "contacts"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    by_name = _BY_EXTENSION.get(ext)
    if by_name is not None:
        return by_name
    if content_type.startswith("image/"):
        return "image"
    return _BY_TYPE.get(content_type)


def clean_name(name: str) -> str:
    """The file's name as shown back (a path is cut to its last part; control characters become spaces)."""
    base = re.split(r"[\\/]", name or "")[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", " ", base).strip()
    return base[:200] or "file"


_EXECUTABLE_HEADS = (b"MZ", b"\x7fELF", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa", b"\xcf\xfa\xed\xfe", b"#!", b"<?php", b"<script", b"<html", b"<!DOCTYPE html")
_ZIP_KINDS = ("sheet", "doc")
_MACRO_PARTS = (b"vbaProject.bin", b"macros/", b"ActiveX", b"oleObject")


def looks_unsafe(kind: str, data: bytes) -> bool:
    """A file that is not what its kind says, or that carries code: a program, a script or a web page under any name; a Word or Excel file with macros or embedded objects; a zip that is not an Office file.
    Pure code on the first bytes and the zip's own table of names: nothing is opened or run (the chat's second check, 422 `file_unsafe`)."""
    head = data[:16].lstrip(b"\xef\xbb\xbf \r\n\t")
    if head.startswith(_EXECUTABLE_HEADS):
        return True
    if kind in _ZIP_KINDS and data[:2] == b"PK":
        window = data[-65536:] + data[:65536]   # the zip's central directory lists every part's name
        return any(part in window for part in _MACRO_PARTS)
    if kind == "pdf" and (b"/JavaScript" in data[:200_000] or b"/Launch" in data[:200_000] or b"/EmbeddedFile" in data[:200_000]):
        return True
    return False
