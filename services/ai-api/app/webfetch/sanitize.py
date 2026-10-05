"""From a fetched document to the VISIBLE text a model may be shown (T007 M1).

Dropped: scripts, styles, templates, `noscript`, `svg`, frames, form controls, comments, `meta`
and every attribute (alt text, titles, data-*), and any element a reader would not see (the
`hidden` attribute, `aria-hidden`, `display:none`, `visibility:hidden`, zero size or opacity,
off-screen offsets, screen-reader-only classes). Then the text is normalised (NFKC), stripped of
control, bidi-override, zero-width and tag characters, and e-mail addresses and phone numbers are
replaced by a marker, BEFORE anything reaches a model or a stored snippet. Finally it is cut to a
character limit.

This is a filter, not a proof: a page can still say anything in plain sight. The prompt builder
treats the result as untrusted data. White-on-white text is not detectable here.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser

CONTACT_MARKER = "[contact removed]"

_VOID = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
_SKIP = frozenset(
    {
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "iframe",
        "object",
        "embed",
        "select",
        "textarea",
        "math",
        "canvas",
        "audio",
        "video",
        "datalist",
    }
)
_BLOCK = frozenset(
    {
        "p",
        "div",
        "br",
        "li",
        "ul",
        "ol",
        "tr",
        "table",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "section",
        "article",
        "header",
        "footer",
        "nav",
        "main",
        "aside",
        "blockquote",
        "pre",
        "address",
        "dl",
        "dt",
        "dd",
        "form",
        "figure",
        "figcaption",
        "hr",
        "title",
    }
)
_HIDDEN_CLASSES = frozenset(
    {"hidden", "sr-only", "visually-hidden", "screen-reader-text", "d-none", "invisible"}
)
_HIDDEN_STYLE = re.compile(
    r"display\s*:\s*none"
    r"|visibility\s*:\s*(hidden|collapse)"
    r"|font-size\s*:\s*0(\.0+)?(px|pt|em|rem|%)?\s*(!important)?\s*(;|$)"
    r"|opacity\s*:\s*0(\.0+)?\s*(!important)?\s*(;|$)"
    r"|(^|;)\s*(width|height|max-height|max-width)\s*:\s*0(px|pt|em|rem|%)?\s*(!important)?\s*(;|$)"
    r"|text-indent\s*:\s*-\s*\d{3,}"
    r"|(^|;)\s*(left|top|right|bottom|margin-left|margin-top)\s*:\s*-\s*\d{3,}"
    r"|clip\s*:\s*rect\(\s*0"
    r"|clip-path\s*:\s*inset\(\s*(50|100)%",
    re.IGNORECASE,
)
# Format characters legitimate in Indic and right-to-left text: joiners and direction marks.
_KEEP_FORMAT = {chr(0x200C), chr(0x200D), chr(0x200E), chr(0x200F)}
_LOCAL_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._%+-")
_DOMAIN = re.compile(r"[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63})+")
# Bounded repetition everywhere: an unbounded `+` rescans a long run from every start and is
# quadratic (a megabyte of "1 1 1 1 ..." must not hold a worker for minutes).
_PHONE = re.compile(r"(?<![\w.])\+?\(?\d[\d\s().\-]{6,24}\d(?!\w)")
MIN_PHONE_DIGITS = 9  # a year range such as 2019-2024 has 8 digits and must survive


@dataclass(frozen=True)
class Sanitized:
    text: str
    truncated: bool
    hidden_elements: int  # elements dropped (scripts, styles, hidden ones) plus comments


def _is_hidden(attrs: list[tuple[str, str | None]]) -> bool:
    names = {name.lower(): (value or "") for name, value in attrs}
    if "hidden" in names:
        return True
    if names.get("aria-hidden", "").strip().lower() == "true":
        return True
    if _HIDDEN_STYLE.search(names.get("style", "")):
        return True
    classes = set(names.get("class", "").lower().split())
    return bool(classes & _HIDDEN_CLASSES)


class _Extractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.stack: list[tuple[str, bool]] = []
        self.hidden_depth = 0
        self.dropped = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID:
            if tag in _BLOCK and not self.hidden_depth:
                self.parts.append("\n")
            return
        hides = tag in _SKIP or _is_hidden(attrs)
        self.stack.append((tag, hides))
        if hides:
            self.hidden_depth += 1
            self.dropped += 1
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                for _, hides in self.stack[index:]:
                    if hides:
                        self.hidden_depth -= 1
                del self.stack[index:]
                if tag in _BLOCK and not self.hidden_depth:
                    self.parts.append("\n")
                return
        # an end tag nobody opened: ignored

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)

    def handle_comment(self, data: str) -> None:
        self.dropped += 1


def clean_characters(text: str) -> str:
    """NFKC, then drop control characters (newline and tab become spaces), surrogates, private
    use, unassigned code points and format characters (zero-width, bidi overrides, tag characters)
    except the joiners and direction marks Indic scripts need."""
    out: list[str] = []
    for ch in unicodedata.normalize("NFKC", text):
        category = unicodedata.category(ch)
        if ch in "\n\t":
            out.append(ch)
        elif category in {"Cc", "Cs", "Co", "Cn"} or (category == "Cf" and ch not in _KEEP_FORMAT):
            continue
        else:
            out.append(ch)
    return "".join(out)


def _scrub_emails(text: str) -> str:
    out: list[str] = []
    done = 0
    at = text.find("@")
    while at != -1:
        start = at
        while start > done and text[start - 1] in _LOCAL_CHARS:
            start -= 1
        domain = _DOMAIN.match(text, at + 1)
        if start < at and domain is not None:
            out.append(text[done:start])
            out.append(CONTACT_MARKER)
            done = domain.end()
            at = text.find("@", done)
        else:
            at = text.find("@", at + 1)
    out.append(text[done:])
    return "".join(out)


def scrub_contacts(text: str) -> str:
    def phone(match: re.Match[str]) -> str:
        digits = sum(ch.isdigit() for ch in match.group(0))
        return CONTACT_MARKER if digits >= MIN_PHONE_DIGITS else match.group(0)

    return _PHONE.sub(phone, _scrub_emails(text))


def _tidy(text: str) -> str:
    """One line per block, single spaces, no empty lines."""
    return "\n".join(line for line in (" ".join(raw.split()) for raw in text.split("\n")) if line)


def sanitize_html(html: str, *, max_chars: int) -> Sanitized:
    extractor = _Extractor()
    extractor.feed(html)
    extractor.close()
    return _finish("".join(extractor.parts), max_chars, extractor.dropped)


def sanitize_plain(text: str, *, max_chars: int) -> Sanitized:
    return _finish(text, max_chars, 0)


def _finish(raw: str, max_chars: int, dropped: int) -> Sanitized:
    text = _tidy(scrub_contacts(clean_characters(raw)))
    truncated = len(text) > max_chars
    return Sanitized(text=text[:max_chars].rstrip(), truncated=truncated, hidden_elements=dropped)
