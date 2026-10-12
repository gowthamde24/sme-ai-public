"""The two web search adapters (job BP, ADR 0078): Tavily and Brave Search, official APIs only (no scraping), behind the one `SearchProvider` interface. Written from the providers' own documentation read on
2026-10-12 (sources in the ADR). Each takes its key as a constructor argument, sends it only in the header the provider documents, and never logs or returns the key, the query or a result. Failures are
SearchError with a constant code: unauthorized, rate_limited, quota, timeout, unavailable, bad_response."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

import httpx

from app.agents.web import SearchError, SearchHit
from app.websearch import clean

logger = logging.getLogger("app.websearch.providers")


class _Http:
    def __init__(self, client: httpx.Client | None) -> None:
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def request(self, method: str, url: str, **kw: Any) -> Any:
        try:
            response = self._client.request(method, url, **kw)
        except httpx.TimeoutException:
            raise SearchError("timeout") from None
        except httpx.HTTPError as exc:
            logger.warning("search provider unreachable: %s", exc.__class__.__name__)
            raise SearchError("unavailable") from None
        if response.status_code in (401, 403):
            raise SearchError("unauthorized")
        if response.status_code == 429:
            raise SearchError("rate_limited")
        if response.status_code in (402, 432, 433):
            raise SearchError("quota")
        if response.status_code >= 500 or response.status_code >= 400:
            logger.warning("search provider refused: http=%s", response.status_code)
            raise SearchError("unavailable")
        try:
            return response.json()
        except ValueError:
            raise SearchError("bad_response") from None


class TavilySearch(_Http):
    """POST https://api.tavily.com/search, `Authorization: Bearer <key>`, body {query, max_results, search_depth: "basic" (1 credit), include_answer/raw_content: false}."""

    def __init__(self, api_key: str, *, client: httpx.Client | None = None, base_url: str = "https://api.tavily.com") -> None:
        super().__init__(client)
        self._key = api_key
        self._base = base_url.rstrip("/")

    def __repr__(self) -> str:
        return "TavilySearch(<key hidden>)"

    def search(self, query: str, *, limit: int = 5) -> Sequence[SearchHit]:
        body = self.request(
            "POST",
            f"{self._base}/search",
            json={"query": query, "max_results": max(1, min(limit, 10)), "search_depth": "basic", "include_answer": False, "include_raw_content": False, "topic": "general"},
            headers={"Authorization": f"Bearer {self._key}"},
        )
        rows = body.get("results") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            raise SearchError("bad_response")
        hits = [clean.hit(r.get("title"), r.get("url"), r.get("content")) for r in rows if isinstance(r, dict)]
        return [h for h in hits if h is not None][:limit]


class BraveSearch(_Http):
    """GET https://api.search.brave.com/res/v1/web/search?q=…&count=…&country=IN, header `X-Subscription-Token: <key>`; results in web.results[] (title, url, description)."""

    def __init__(self, api_key: str, *, client: httpx.Client | None = None, base_url: str = "https://api.search.brave.com") -> None:
        super().__init__(client)
        self._key = api_key
        self._base = base_url.rstrip("/")

    def __repr__(self) -> str:
        return "BraveSearch(<key hidden>)"

    def search(self, query: str, *, limit: int = 5) -> Sequence[SearchHit]:
        body = self.request(
            "GET",
            f"{self._base}/res/v1/web/search",
            params={"q": query, "count": str(max(1, min(limit, 20))), "country": "IN", "safesearch": "moderate"},
            headers={"X-Subscription-Token": self._key, "Accept": "application/json"},
        )
        web = body.get("web") if isinstance(body, dict) else None
        rows = web.get("results") if isinstance(web, dict) else None
        if not isinstance(rows, list):
            raise SearchError("bad_response")
        hits = [clean.hit(r.get("title"), r.get("url"), r.get("description")) for r in rows if isinstance(r, dict)]
        return [h for h in hits if h is not None][:limit]


class DemoSearch:
    """No network, no key: three invented results for any query (development and tests)."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def search(self, query: str, *, limit: int = 5) -> Sequence[SearchHit]:
        self.queries.append(query)
        word = (query.split() or ["silk"])[0].lower()[:30]
        hits = [
            SearchHit(f"https://news.example-sarees.test/{word}-trends", f"Saree market notes: {word}", f"An invented article about {word} and wholesale demand."),
            SearchHit(f"https://guide.example-textiles.test/{word}", f"A buyer's guide to {word}", "An invented guide with invented figures."),
            SearchHit("https://wholesale.example-silks.test/about", "About an invented wholesaler", "An invented company page."),
        ]
        return hits[: max(1, min(limit, 10))]
