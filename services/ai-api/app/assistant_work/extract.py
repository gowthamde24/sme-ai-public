"""The extraction step: a PDF, a Word file or a photo dropped in the chat, turned into text and tables (job assistant-does-the-work A3; owner decisions 5 Nov 2026).

  * a Word file (.docx): its tables and paragraphs, read with plain patterns from one member of its zip (no XML parser, so no entity tricks);
  * a PDF with a text layer: `pdftotext -layout` (poppler) when the image has it, else the standard-library reader of About my business;
  * a scanned PDF or a photo: LOCAL OCR first (Tesseract on our own server, nothing leaves it). Only when local OCR finds neither a table nor a name with a phone or an e-mail, the AI model reads the page
    images (`Vision`, under the day's spending cap, and never for a school: owner rule 3, children's details). The model is asked to write out what is on the page, nothing else: no correction, no guess.
Everything here is untrusted content: the words are data, never instructions. A refusal is a closed code, never a message that echoes the file. Tables and people are found by code, and every value is
a piece of the text as read: nothing is invented (a field the file does not have stays empty)."""

# ruff: noqa: E501

from __future__ import annotations

import html
import io
import logging
import os
import re
import shutil
import subprocess  # noqa: S404  the local readers (poppler, tesseract) are fixed binaries run with fixed arguments on a file in a private temporary folder
import tempfile
import zipfile
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger("app.assistant_work.extract")

How = Literal["docx", "text_layer", "local_ocr", "ai_vision"]
Grid = list[list[str]]

MAX_PAGES = 10              # a scanned PDF: the first ten pages are read (OCR and the model alike)
MAX_DOCX_XML = 6_000_000
MAX_UNZIPPED = 20_000_000
MAX_PIXELS = 40_000_000     # a photo bigger than this is refused (a decompression bomb)
MAX_SIDE = 2_400            # the longest side a page image is scaled to before it is read
MAX_TEXT = 200_000
OCR_TIMEOUT_S = 40
MIN_TEXT_LAYER = 40
OCR_LANGUAGES = ("eng", "tel", "hin", "kan")

_PHONE = re.compile(r"(?<![\w@])\+?[0-9०-९౦-౯೦-೯][0-9०-९౦-౯೦-೯ ().-]{7,18}[0-9०-९౦-౯೦-೯](?![\w@])")
_EMAIL = re.compile(r"[^\s@,;|<>()]+@[^\s@,;|<>()]+\.[A-Za-z]{2,}")
_LABEL = re.compile(r"(?i)\b(?:(?:mob(?:ile)?|ph(?:one)?|tel|cell|off(?:ice)?|whatsapp|contact|e-?mail|mail|res)\b\s*(?:no\.?|number)?\s*[:.\-]*|[mopw]\s*:)")
_COMPANY = re.compile(r"(?i)\b(pvt|private|ltd|limited|llp|traders?|trading|enterprises?|industries|agenc(?:y|ies)|stores?|silks?|sarees?|textiles?|fabrics|emporium|& ?co|company|associates|exports?|imports?|mart|bazaar|centre|center|solutions|technologies|school|academy|travels|caterers)\b")
_ROLE = re.compile(r"(?i)\b(proprietor|propr?\.|owner|manager|director|partner|ceo|md|sales|executive|founder|marketing|dealer|distributor|wholesale|retail)\b")
_SIGN_OFF = re.compile(r"(?i)\b(regards|best regards|warm regards|thanks|thank you|thanking you|yours (?:sincerely|faithfully|truly)|sincerely|from|name)\b[\s,:.-]*")
_SPLIT = re.compile(r"\s*\|\s*|\t+| {2,}")


class ReadRefused(Exception):
    """`code`: unreadable | doc_format | scanned_school | no_reader | heic | too_big."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class Extracted:
    how: How
    text: str
    grids: list[Grid] = field(default_factory=list)
    pages: int = 0


# ---------------------------------------------------------------------------------------------------------------------------------- the local readers
def _limits() -> None:   # pragma: no cover  (runs in the child process)
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (1_500_000_000, 1_500_000_000))
        resource.setrlimit(resource.RLIMIT_CPU, (OCR_TIMEOUT_S, OCR_TIMEOUT_S))
    except (ImportError, ValueError, OSError):
        pass


class LocalTools:
    """poppler (pdftotext, pdftoppm) and Tesseract, when the server has them (deploy/Dockerfile.api installs them; a laptop may not). Nothing here reads the network."""

    def __init__(self, *, tesseract: str | None = None, pdftotext: str | None = None, pdftoppm: str | None = None, languages: Sequence[str] | None = None) -> None:
        self.tesseract = tesseract if tesseract is not None else shutil.which("tesseract")
        self.pdftotext = pdftotext if pdftotext is not None else shutil.which("pdftotext")
        self.pdftoppm = pdftoppm if pdftoppm is not None else shutil.which("pdftoppm")
        self._languages = list(languages) if languages is not None else None

    @property
    def can_ocr(self) -> bool:
        return bool(self.tesseract)

    def languages(self) -> str:
        if self._languages is None:
            found: list[str] = []
            if self.tesseract:
                try:
                    out = subprocess.run([self.tesseract, "--list-langs"], capture_output=True, timeout=10, check=False)  # noqa: S603
                    have = set(out.stdout.decode("utf-8", "replace").split())
                    found = [lang for lang in OCR_LANGUAGES if lang in have]
                except (OSError, subprocess.SubprocessError):
                    found = []
            self._languages = found or ["eng"]
        return "+".join(self._languages)

    def _run(self, args: list[str], timeout: int = OCR_TIMEOUT_S) -> bytes | None:
        try:
            out = subprocess.run(args, capture_output=True, timeout=timeout, check=False, preexec_fn=_limits if os.name == "posix" else None)  # noqa: S603, PLW1509
        except (OSError, subprocess.SubprocessError) as exc:
            logger.warning("local reader did not run: %s", exc.__class__.__name__)
            return None
        if out.returncode != 0:
            logger.warning("local reader failed: exit=%d", out.returncode)
            return None
        return out.stdout

    def pdf_text(self, data: bytes) -> str | None:
        if not self.pdftotext:
            return None
        with tempfile.TemporaryDirectory(prefix="awx-") as tmp:
            src = os.path.join(tmp, "in.pdf")
            with open(src, "wb") as f:
                f.write(data)
            out = self._run([self.pdftotext, "-layout", "-enc", "UTF-8", "-l", str(MAX_PAGES * 2), "-q", src, "-"])
        return out.decode("utf-8", "replace") if out is not None else None

    def pdf_pages(self, data: bytes) -> list[bytes]:
        """The first pages as PNG images (150 dpi, grey), for OCR or the model."""
        if not self.pdftoppm:
            return []
        with tempfile.TemporaryDirectory(prefix="awx-") as tmp:
            src = os.path.join(tmp, "in.pdf")
            with open(src, "wb") as f:
                f.write(data)
            if self._run([self.pdftoppm, "-r", "150", "-gray", "-png", "-l", str(MAX_PAGES), "-scale-to", str(MAX_SIDE), "-q", src, os.path.join(tmp, "p")], timeout=OCR_TIMEOUT_S * 2) is None:
                return []
            names = sorted((n for n in os.listdir(tmp) if n.startswith("p") and n.endswith(".png")), key=lambda n: int(re.sub(r"\D", "", n) or 0))
            pages = []
            for n in names[:MAX_PAGES]:
                with open(os.path.join(tmp, n), "rb") as f:
                    pages.append(f.read())
            return pages

    def ocr(self, png: bytes) -> str:
        if not self.tesseract:
            return ""
        with tempfile.TemporaryDirectory(prefix="awx-") as tmp:
            src = os.path.join(tmp, "in.png")
            with open(src, "wb") as f:
                f.write(png)
            out = self._run([self.tesseract, src, "stdout", "-l", self.languages(), "--psm", "4", "-c", "preserve_interword_spaces=1"])
        return out.decode("utf-8", "replace") if out is not None else ""


def prepare_image(data: bytes) -> bytes:
    """A photo as a grey PNG the readers take: turned upright (the phone's EXIF), at most MAX_SIDE on its longest side, small ones doubled. EXIF and location data are not carried over."""
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.width * img.height > MAX_PIXELS:
                raise ReadRefused("too_big")
            img.load()
            upright = ImageOps.exif_transpose(img) or img
            grey = upright.convert("L")
    except ReadRefused:
        raise
    except Exception:   # Pillow names the reason in its message, which may echo the file: a closed code only
        raise ReadRefused("unreadable") from None
    side = max(grey.width, grey.height)
    if side > MAX_SIDE:
        scale = MAX_SIDE / side
        grey = grey.resize((max(1, int(grey.width * scale)), max(1, int(grey.height * scale))))
    elif side < 1000:
        grey = grey.resize((grey.width * 2, grey.height * 2))
    out = io.BytesIO()
    grey.save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------------------------------------------------------------------------- a Word file
def _cell_text(xml: str) -> str:
    xml = re.sub(r"</w:p>|<w:br\s*/?>|<w:tab\s*/>", " ", xml)
    runs = re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", xml)
    return " ".join(html.unescape("".join(runs)).split())


def read_docx(data: bytes) -> tuple[str, list[Grid]]:
    """(the paragraphs' text, the tables) of a .docx. A table's rows are padded to its widest row."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
                raise ReadRefused("too_big")
            info = z.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML:
                raise ReadRefused("too_big")
            xml = z.read(info).decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError, RuntimeError, OSError):
        raise ReadRefused("doc_format") from None
    if "<!DOCTYPE" in xml or "<!ENTITY" in xml:
        raise ReadRefused("unreadable")
    grids: list[Grid] = []
    for table in re.findall(r"<w:tbl>.*?</w:tbl>", xml, re.DOTALL):
        rows = []
        for tr in re.findall(r"<w:tr[ >].*?</w:tr>", table, re.DOTALL):
            cells = [_cell_text(tc) for tc in re.findall(r"<w:tc[ >].*?</w:tc>", tr, re.DOTALL)]
            if any(cells):
                rows.append(cells)
        if len(rows) >= 2:
            width = max(len(r) for r in rows)
            grids.append([r + [""] * (width - len(r)) for r in rows])
    outside = re.sub(r"<w:tbl>.*?</w:tbl>", "\n", xml, flags=re.DOTALL)
    lines = [_cell_text(p) for p in re.findall(r"<w:p[ >].*?</w:p>", outside, re.DOTALL)]
    return "\n".join(line for line in lines if line)[:MAX_TEXT], grids


# ---------------------------------------------------------------------------------------------------------------------------------- tables and people in text
def _digits(s: str) -> int:
    return sum(ch.isdigit() for ch in s)


def phones_in(line: str) -> list[str]:
    return [m.group(0).strip() for m in _PHONE.finditer(line) if 10 <= _digits(m.group(0)) <= 13]


def grids_of_text(text: str) -> list[Grid]:
    """Tables in read text: consecutive lines that split into the same number (2 or more) of cells, on ' | ', tabs or two spaces. At least a header and two rows."""
    grids: list[Grid] = []
    block: list[list[str]] = []

    def close() -> None:
        if len(block) >= 3:
            width = Counter(len(r) for r in block).most_common(1)[0][0]
            rows = [r for r in block if len(r) == width]
            if len(rows) >= 3:
                grids.append(rows)
        block.clear()

    for raw in text.splitlines():
        line = raw.strip().strip("|").strip()
        cells = [c.strip() for c in _SPLIT.split(line) if c.strip()] if line else []
        if len(cells) >= 2:
            block.append(cells)
        elif line:
            close()
    close()
    return grids


def _strip(line: str, *, phones: Sequence[str], emails: Sequence[str]) -> str:
    for p in phones:
        line = line.replace(p, " ")
    for e in emails:
        line = line.replace(e, " ")
    line = _LABEL.sub(" ", line)
    line = _SIGN_OFF.sub(" ", line)
    return " ".join(re.sub(r"[|:;,/]+", " ", line).split()).strip(" -.")


def _name_like(line: str) -> bool:
    letters = sum(ch.isalpha() for ch in line)
    return letters >= 3 and _digits(line) == 0 and "@" not in line and len(line.split()) <= 6 and not _COMPANY.search(line) and not _ROLE.search(line) and not re.search(r"(?i)www\.|https?:", line)


PEOPLE_HEADER = ["Name", "Company", "Phone", "Email"]


def people_of_text(text: str) -> Grid:
    """People in read text (a register page, a list, a visiting card), header first. A line with a phone and a name is one person; a phone alone joins the nearest name above it. One card (every
    phone on it without a name of its own) is one person: its first name-like line, its company line, its first phone and e-mail. Every value is a piece of the text."""
    lines = [" ".join(raw.split()) for raw in text.splitlines()]
    lines = [line for line in lines if line]
    found: list[tuple[int, list[str], list[str], str]] = []   # (line index, phones, emails, what is left)
    for i, line in enumerate(lines):
        phones, emails = phones_in(line), _EMAIL.findall(line)
        if phones or emails:
            found.append((i, phones, emails, _strip(line, phones=phones, emails=emails)))
    if not found:
        return []
    named = [f for f in found if f[1] and sum(ch.isalpha() for ch in f[3]) >= 3]
    rows: Grid = []
    if not named and len(lines) <= 30:   # one visiting card
        phone = next((p for f in found for p in f[1]), "")
        email = next((e for f in found for e in f[2]), "")
        name = next((line for line in lines if _name_like(line)), "")
        company = next((line for line in lines if _COMPANY.search(line) and _digits(line) == 0), "")
        if phone or email:
            rows.append([name, company, phone, email])
        return [PEOPLE_HEADER, *rows] if rows else []
    used: set[int] = set()
    for i, phones, emails, rest in found:
        if not phones:
            continue
        name = rest if sum(ch.isalpha() for ch in rest) >= 3 else ""
        if not name:
            for j in range(i - 1, max(-1, i - 4), -1):
                if j not in used and _name_like(lines[j]):
                    name = lines[j]
                    used.add(j)
                    break
        email = emails[0] if emails else ""
        if not email and i + 1 < len(lines):
            nxt = _EMAIL.findall(lines[i + 1])
            if nxt and not phones_in(lines[i + 1]):
                email = nxt[0]
        rows.append([name[:200], "", phones[0], email])
    return [PEOPLE_HEADER, *rows] if rows else []


def useful(text: str, grids: Sequence[Grid]) -> bool:
    """Did a reading find something to work with: a table, or a phone or an e-mail."""
    return any(len(g) >= 3 for g in grids) or bool(phones_in(text)) or bool(_EMAIL.search(text))


def _text_layer_readable(text: str | None) -> bool:
    if not text:
        return False
    body = "".join(text.split())
    return len(body) >= MIN_TEXT_LAYER and sum(ch.isalnum() for ch in body) / max(1, len(body)) > 0.6


# ---------------------------------------------------------------------------------------------------------------------------------- the reader
@dataclass(frozen=True)
class Page:
    media_type: str
    data: bytes


Vision = Callable[[Sequence[Page]], str]


class FileReader:
    """One file -> Extracted, by the owner's order: the file's own text; local OCR; the AI model only if local OCR found nothing to work with, only when it is switched on, never for a school."""

    def __init__(self, local: LocalTools | None) -> None:
        self.local = local

    def read(self, kind: str, data: bytes, *, school: Callable[[], bool], vision: Vision | None) -> Extracted:
        """`school` is asked only for a scanned file (a database read)."""
        if kind == "doc":
            if data[:2] != b"PK":
                raise ReadRefused("doc_format")   # an old .doc, .odt or .rtf: "save it as .docx"
            words, tables = read_docx(data)
            return Extracted("docx", words, tables)
        if kind == "pdf":
            if b"/Encrypt" in data[:4096] or b"/Encrypt" in data[-4096:]:
                raise ReadRefused("unreadable")
            text = self.local.pdf_text(data) if self.local is not None else None
            if not _text_layer_readable(text):
                from app.knowledge.readers import _pdf_text

                text = _pdf_text(data)
            if text and _text_layer_readable(text):
                text = text[:MAX_TEXT]
                return Extracted("text_layer", text, grids_of_text(text))
            pages = self.local.pdf_pages(data) if self.local is not None else []
            return self._scanned(pages, data, school=school, vision=vision)
        if kind == "image":
            if data[4:8] == b"ftyp":
                raise ReadRefused("heic")   # an iPhone HEIC: neither reader takes it, "send it as a JPG"
            return self._scanned([prepare_image(data)], None, school=school, vision=vision)
        raise ReadRefused("unreadable")

    def _scanned(self, pages: list[bytes], pdf: bytes | None, *, school: Callable[[], bool], vision: Vision | None) -> Extracted:
        read = Extracted("local_ocr", "", [], len(pages))
        if self.local is not None and self.local.can_ocr and pages:
            text = "\n\n".join(self.local.ocr(p) for p in pages)[:MAX_TEXT]
            read = Extracted("local_ocr", text, grids_of_text(text), len(pages))
            logger.info("assistant file read locally: pages=%d useful=%s", len(pages), useful(read.text, read.grids))
            if useful(read.text, read.grids):
                return read
        if school():
            raise ReadRefused("scanned_school")   # owner rule 3: a school's pictures never go to the AI model
        if vision is None:
            if read.text.strip():
                return read
            raise ReadRefused("no_reader")
        sent = [Page("image/png", p) for p in pages] if pages else ([Page("application/pdf", pdf)] if pdf is not None else [])
        if not sent:
            raise ReadRefused("unreadable")
        text = vision(sent)[:MAX_TEXT]
        return Extracted("ai_vision", text, grids_of_text(text), len(sent))
