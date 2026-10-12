"""Web results are UNTRUSTED. Everything that comes back from a provider is reduced to plain, bounded text before anything else sees it: no markup, no control or direction characters, bounded lengths, and an
address only if it is a plain http(s) address without credentials."""

from __future__ import annotations

import html
import re
import unicodedata
from urllib.parse import urlsplit

from app.agents.web import SearchHit

_TAG = re.compile(r"<[^>]{0,500}>")
_BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏ -‮⁦-⁩﻿]")
MAX_TITLE, MAX_SNIPPET, MAX_URL = 200, 400, 500


def text(raw: object, limit: int) -> str:
    if not isinstance(raw, str):
        return ""
    value = html.unescape(_TAG.sub(" ", raw))
    value = _BAD.sub("", unicodedata.normalize("NFKC", value))
    return " ".join(value.split())[:limit]


def url(raw: object) -> str | None:
    if not isinstance(raw, str) or len(raw) > MAX_URL or any(ch.isspace() or ord(ch) < 32 for ch in raw):
        return None
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or "." not in parts.hostname:
        return None
    return raw


def hit(title: object, link: object, snippet: object) -> SearchHit | None:
    address = url(link)
    if address is None:
        return None
    return SearchHit(address, text(title, MAX_TITLE) or urlsplit(address).hostname or "", text(snippet, MAX_SNIPPET))
