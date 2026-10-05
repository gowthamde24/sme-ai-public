"""Offline fakes for the two web interfaces (T007 M1): synthetic fixture pages, no network.

`FixturePageFetcher` serves files under `<root>/<host>/...` (`index.html`, `about.html`,
`robots.txt`, ...). It applies the same URL rules, host scope, robots rules and sanitiser as the
real fetcher, so a test that passes on the fake is exercising the same text pipeline. It never
opens a socket and never resolves a name. Fixture hosts use the reserved `.test` TLD, which the
real fetcher refuses by name.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

from app.agents.web import FetchedPage, FetchError, SearchError, SearchHit
from app.webfetch.robots import ALLOW_ALL, RobotsRules, parse_robots
from app.webfetch.sanitize import sanitize_html, sanitize_plain
from app.webfetch.urls import parse_target

_TYPES = {".html": "text/html", ".htm": "text/html", ".txt": "text/plain"}


class FixturePageFetcher:
    def __init__(self, root: Path, *, max_text_chars: int = 8000) -> None:
        self._root = root
        self._max = max_text_chars
        self.requests: list[str] = []  # what a test may assert on: the URLs asked for

    def fetch(self, url: str, *, allowed_hosts: frozenset[str] | None = None) -> FetchedPage:
        target = parse_target(url)
        if allowed_hosts is not None and target.host not in allowed_hosts:
            raise FetchError("off_host")
        path = unquote(urlsplit(target.path).path)
        rules = self._robots(target.host)
        if not rules.allows(path):
            raise FetchError("robots_disallowed")
        file = self._file(target.host, path)
        if file is None:
            raise FetchError("http_status", 404)
        self.requests.append(target.url)
        text = file.read_text(encoding="utf-8", errors="replace")
        content_type = _TYPES.get(file.suffix, "text/plain")
        if content_type == "text/html":
            result = sanitize_html(text, max_chars=self._max)
        else:
            result = sanitize_plain(text, max_chars=self._max)
        return FetchedPage(
            final_url=target.url,
            status=200,
            content_type=content_type,
            text=result.text,
            truncated=result.truncated,
            body_bytes=len(text.encode("utf-8")),
            hidden_elements=result.hidden_elements,
        )

    def _robots(self, host: str) -> RobotsRules:
        robots = self._root / host / "robots.txt"
        if not robots.is_file():
            return ALLOW_ALL
        return parse_robots(robots.read_text(encoding="utf-8", errors="replace"))

    def _file(self, host: str, path: str) -> Path | None:
        parts = PurePosixPath(path).parts[1:]
        if any(part in ("..", ".") for part in parts):
            return None
        base = self._root / host
        candidates = [base.joinpath(*parts)] if parts else []
        if not parts:
            candidates = [base / "index.html"]
        else:
            last = base.joinpath(*parts)
            candidates += [last.with_name(last.name + ".html"), last / "index.html"]
        for candidate in candidates:
            resolved = candidate.resolve()
            if base.resolve() in resolved.parents and resolved.is_file():
                return resolved
        return None


class FixtureSearchProvider:
    """Canned hits per normalised query (case-folded, whitespace collapsed). No network."""

    def __init__(self, hits: Mapping[str, Sequence[SearchHit]]) -> None:
        self._hits = {self._key(query): list(found) for query, found in hits.items()}

    @staticmethod
    def _key(query: str) -> str:
        return " ".join(query.casefold().split())

    def search(self, query: str, *, limit: int = 5) -> Sequence[SearchHit]:
        if not query.strip() or len(query) > 200:
            raise SearchError("bad_query")
        return self._hits.get(self._key(query), [])[: max(1, min(limit, 10))]
