"""The web research tools' one handle (job BP, ADR 0078): which providers are switched on, and what each is called with. It decides nothing about WHO may ask (the tools check the run, the quota and the query
first) and holds no key beyond what its providers hold."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.agents.web import PageFetcher, SearchProvider
from app.websearch.metals import MetalPrices
from app.websearch.places import PlacesSearch


@dataclass(frozen=True)
class ResearchWeb:
    search: SearchProvider | None = field(default=None, repr=False)
    fetcher: PageFetcher | None = field(default=None, repr=False)
    places: PlacesSearch | None = field(default=None, repr=False)
    metals: MetalPrices | None = field(default=None, repr=False)

    def enabled(self) -> dict[str, bool]:
        return {
            "web_search": self.search is not None,
            "read_page": self.fetcher is not None,
            "find_retailers": self.places is not None,
            "metal_prices": self.metals is not None,
        }

    def any(self) -> bool:
        return any(self.enabled().values())
