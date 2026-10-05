"""What an agent may know about the web: two small interfaces and their data (T007 M1).

An agent never opens a socket, resolves a name or reads a file. It is handed a `PageFetcher`
(and, from T007b, a `SearchProvider`) and asks it for text. The implementations live outside the
sandbox (`app.webfetch`): the real fetcher with its SSRF guard, and offline fakes that serve
synthetic fixture pages. Everything a fetcher returns is UNTRUSTED data.

Errors carry a constant code only: no URL, no host, no address and no body text ever reaches a
message, a log line or a model.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

FETCH_ERROR_CODES = frozenset(
    {
        "bad_url",
        "bad_scheme",
        "bad_port",
        "userinfo",
        "bad_host",
        "ip_literal",
        "blocked_name",
        "resolve_failed",
        "blocked_address",
        "peer_mismatch",
        "connect_failed",
        "tls_failed",
        "timeout",
        "off_host",
        "too_many_redirects",
        "redirect_downgrade",
        "bad_redirect",
        "http_status",
        "unsupported_content_type",
        "unsupported_encoding",
        "too_large",
        "bad_response",
        "robots_disallowed",
        "robots_unavailable",
        "robots_crawl_delay",
        "rate_limited",
        "daily_limit",
        "resolver_busy",
    }
)


class FetchError(Exception):
    """A refusal or failure. `str(error)` is the constant `code`; `status` is set by http_status."""

    def __init__(self, code: str, status: int | None = None) -> None:
        if code not in FETCH_ERROR_CODES:  # a typo must not become a new, unreviewed message
            raise ValueError("unknown fetch error code")
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class FetchedPage:
    """One page, already sanitised: visible text only, contact details removed, length capped."""

    final_url: str
    status: int
    content_type: str
    text: str
    truncated: bool  # the TEXT was cut to the configured limit
    body_bytes: int  # decoded bytes read from the server
    hidden_elements: int  # elements dropped as hidden, scripts, styles and the like


class PageFetcher(Protocol):
    def fetch(self, url: str, *, allowed_hosts: frozenset[str] | None = None) -> FetchedPage:
        """Fetch `url`. With `allowed_hosts`, the first URL and every redirect hop must be on one of
        those hosts, else `FetchError("off_host")`."""
        ...


@dataclass(frozen=True)
class SearchHit:
    url: str
    title: str
    snippet: str


class SearchError(Exception):
    """A search refusal or failure with a constant code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class SearchProvider(Protocol):
    def search(self, query: str, *, limit: int = 5) -> Sequence[SearchHit]:
        """Hits for `query`, at most `limit` (1-10). Titles and snippets are UNTRUSTED data."""
        ...
