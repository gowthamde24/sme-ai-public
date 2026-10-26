"""A Google Sheet as a file (job DR / A2). The owner pastes a link; the sheet must be readable without signing in ("Anyone with the link can view", or "Publish to the web"), so no Google key is
involved. Only docs.google.com is ever contacted, over https, and a redirect is followed only to a Google host; the answer must be CSV, never a sign-in page. A private sheet needs a service
account (the operator creates one; not set up yet): the interface below has room for it, `NotConfigured` says so.

NOTHING from a sheet is trusted: the bytes go through the same strict reader as an uploaded file (app/integrations/sheet.py)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import parse_qs, urlparse

import httpx

MAX_BYTES = 2_000_000
_ID = re.compile(r"^[A-Za-z0-9_-]{20,100}$")
_GOOGLE_HOSTS = ("docs.google.com", "googleusercontent.com")


class SheetError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code   # sheet_link_invalid | sheet_not_public | unreachable | too_large


@dataclass(frozen=True)
class SheetRef:
    sheet_id: str
    gid: str | None

    @property
    def published(self) -> bool:
        return self.sheet_id.startswith("2PACX-")

    def export_url(self) -> str:
        gid = f"&gid={self.gid}" if self.gid else ""
        if self.published:
            return f"https://docs.google.com/spreadsheets/d/e/{self.sheet_id}/pub?output=csv{gid}"
        return f"https://docs.google.com/spreadsheets/d/{self.sheet_id}/export?format=csv{gid}"


def parse_sheet_url(url: str) -> SheetRef:
    try:
        parts = urlparse(url.strip())
    except ValueError:
        raise SheetError("sheet_link_invalid") from None
    if parts.scheme != "https" or parts.hostname != "docs.google.com" or parts.username or parts.password or parts.port not in (None, 443):
        raise SheetError("sheet_link_invalid")
    m = re.match(r"^/spreadsheets/d/(?:e/)?([A-Za-z0-9_-]+)", parts.path)
    if not m or not _ID.fullmatch(m.group(1)):
        raise SheetError("sheet_link_invalid")
    gid = None
    for source in (parse_qs(parts.query).get("gid", []), parse_qs(parts.fragment).get("gid", [])):
        if source and re.fullmatch(r"[0-9]{1,20}", source[0]):
            gid = source[0]
    return SheetRef(m.group(1), gid)


class SheetFetcher(Protocol):
    def fetch(self, ref: SheetRef) -> bytes: ...


class HttpSheetFetcher:
    """The sheet's CSV export over https. Three redirects at most, each to a Google host."""

    def __init__(self, *, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0), follow_redirects=False)

    def fetch(self, ref: SheetRef) -> bytes:
        url = ref.export_url()
        for _ in range(4):
            host = urlparse(url).hostname or ""
            if urlparse(url).scheme != "https" or not any(host == h or host.endswith("." + h) for h in _GOOGLE_HOSTS):
                raise SheetError("sheet_not_public")
            try:
                with self._client.stream("GET", url) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        url = response.headers.get("location", "")
                        continue
                    if response.status_code in (401, 403, 404):
                        raise SheetError("sheet_not_public")
                    if response.status_code != 200:
                        raise SheetError("unreachable")
                    kind = response.headers.get("content-type", "").lower()
                    if "text/html" in kind or "application/json" in kind:
                        raise SheetError("sheet_not_public")   # the sign-in page
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            raise SheetError("too_large")
                    return bytes(body)
            except httpx.HTTPError:
                raise SheetError("unreachable") from None
        raise SheetError("unreachable")


class FakeSheetFetcher:
    """Tests and development: sheet id -> CSV bytes (or a SheetError to raise)."""

    def __init__(self, sheets: dict[str, bytes | str | SheetError] | None = None) -> None:
        self.sheets: dict[str, bytes | str | SheetError] = dict(sheets or {})
        self.fetched: list[SheetRef] = []

    def fetch(self, ref: SheetRef) -> bytes:
        self.fetched.append(ref)
        found = self.sheets.get(ref.sheet_id)
        if found is None:
            raise SheetError("sheet_not_public")
        if isinstance(found, SheetError):
            raise found
        return found.encode("utf-8") if isinstance(found, str) else found
