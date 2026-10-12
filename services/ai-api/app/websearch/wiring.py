"""Builds the web research tools from settings (job BP). Everything is off by default; a provider that is named without its key stops the process at start (a mistake, not a silent fallback)."""

from __future__ import annotations

from pathlib import Path

from app.agents.web import PageFetcher, SearchProvider
from app.config import ConfigurationError, Settings
from app.webfetch.fakes import FixturePageFetcher
from app.webfetch.fetcher import make_default_fetcher
from app.websearch.metals import FixtureMetals, MetalPrices, MetalsDev
from app.websearch.places import FixturePlaces, GooglePlaces, PlacesSearch
from app.websearch.providers import BraveSearch, DemoSearch, TavilySearch
from app.websearch.service import ResearchWeb


def _secret(value: object, name: str) -> str:
    text = value.get_secret_value() if value is not None and hasattr(value, "get_secret_value") else None
    if not text:
        raise ConfigurationError(f"{name} is required for the provider that was chosen")
    return str(text)


def build_research_web(settings: Settings) -> ResearchWeb | None:
    search: SearchProvider | None = None
    provider = settings.web_search_provider
    if provider == "fake":
        search = DemoSearch()
    elif provider == "tavily":
        search = TavilySearch(_secret(settings.tavily_api_key, "TAVILY_API_KEY"))
    elif provider == "brave":
        search = BraveSearch(_secret(settings.brave_search_api_key, "BRAVE_SEARCH_API_KEY"))
    elif provider != "off":
        raise ConfigurationError("WEB_SEARCH_PROVIDER must be off, fake, tavily or brave")

    places: PlacesSearch | None = None
    if settings.places_provider == "fake":
        places = FixturePlaces()
    elif settings.places_provider == "google":
        try:
            places = GooglePlaces(_secret(settings.google_places_api_key, "GOOGLE_PLACES_API_KEY"), tier=settings.places_field_tier)
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from None
    elif settings.places_provider != "off":
        raise ConfigurationError("PLACES_PROVIDER must be off, fake or google")

    metals: MetalPrices | None = None
    if settings.metals_provider == "fake":
        metals = FixtureMetals()
    elif settings.metals_provider == "metals_dev":
        metals = MetalsDev(_secret(settings.metals_dev_api_key, "METALS_DEV_API_KEY"))
    elif settings.metals_provider != "off":
        raise ConfigurationError("METALS_PROVIDER must be off, fake or metals_dev")

    fetcher: PageFetcher | None = None
    if settings.web_fetch == "fake":
        root = Path(settings.research_fixture_dir) if settings.research_fixture_dir else None
        if root is None or not root.is_dir():
            raise ConfigurationError("WEB_FETCH=fake needs RESEARCH_FIXTURE_DIR")
        fetcher = FixturePageFetcher(root)
    elif settings.web_fetch == "real":
        fetcher = make_default_fetcher()
    elif settings.web_fetch != "off":
        raise ConfigurationError("WEB_FETCH must be off, fake or real")

    web = ResearchWeb(search=search, fetcher=fetcher, places=places, metals=metals)
    return web if web.any() else None
