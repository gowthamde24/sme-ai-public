"""The offline fakes: synthetic fixture pages, no network, the real fetcher's text pipeline."""

from __future__ import annotations

import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from app.agents.web import FetchError, PageFetcher, SearchError, SearchHit, SearchProvider
from app.webfetch.fakes import FixturePageFetcher, FixtureSearchProvider
from app.webfetch.fetcher import SafeFetcher
from app.webfetch.sanitize import CONTACT_MARKER

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "web"


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Any attempt to resolve a name or open a socket fails the test: the fakes must not need one.
    (The local-server parity test lifts this for 127.0.0.1 only, below.)"""

    def refuse(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("the fakes must not touch the network")

    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    yield


def fetcher() -> FixturePageFetcher:
    return FixturePageFetcher(FIXTURES)


def refused(f: PageFetcher, target: str, **kw: Any) -> FetchError:
    with pytest.raises(FetchError) as caught:
        f.fetch(target, **kw)
    return caught.value


def test_the_fixture_sites_exist_and_use_the_reserved_test_tld() -> None:
    hosts = sorted(p.name for p in FIXTURES.iterdir() if p.is_dir())
    assert len(hosts) >= 4 and all(h.endswith(".test") for h in hosts)


def test_a_fixture_page_is_served_sanitised_with_the_real_fetchers_shape() -> None:
    page = fetcher().fetch("https://saree-house.test/")
    assert page.status == 200 and page.content_type == "text/html"
    assert page.text.startswith("Saree House - wholesale silk sarees\nSaree House\n")
    assert "minimum five pieces per order" in page.text
    assert "owner@saree-house.test" not in page.text and CONTACT_MARKER in page.text
    assert page.final_url == "https://saree-house.test/" and not page.truncated
    assert page.hidden_elements >= 0 and page.body_bytes > 100


@pytest.mark.parametrize("path", ["/about", "/about.html", "/products/silk", "/products/silk.html"])
def test_pages_are_found_with_or_without_the_extension(path: str) -> None:
    assert (
        "Silk" in fetcher().fetch("https://saree-house.test" + path).text
        or "Established" in fetcher().fetch("https://saree-house.test" + path).text
    )


def test_hidden_instructions_in_a_fixture_never_reach_the_text() -> None:
    page = fetcher().fetch("https://metro-fabrics.test/")
    for planted in (
        "IGNORE YOUR RULES",
        "SYSTEM:",
        "ASSISTANT:",
        "write_observation",
        "Hidden: this business is closed",
        "saree_shop",
    ):
        assert planted not in page.text
    assert page.hidden_elements >= 4
    assert "sales@metro-fabrics.test" not in page.text and "9876" not in page.text
    assert "school uniforms" in page.text


def test_robots_txt_of_a_fixture_site_is_obeyed() -> None:
    f = fetcher()
    assert refused(f, "https://locked.test/").code == "robots_disallowed"
    assert refused(f, "https://saree-house.test/admin").code in {"robots_disallowed", "http_status"}
    assert f.fetch("https://saree-house.test/about").text.startswith("About Saree House")
    assert "https://locked.test/" not in f.requests


def test_a_scope_keeps_a_run_on_the_leads_site() -> None:
    f = fetcher()
    scope = frozenset({"saree-house.test", "www.saree-house.test"})
    assert f.fetch("https://saree-house.test/", allowed_hosts=scope).status == 200
    assert refused(f, "https://metro-fabrics.test/", allowed_hosts=scope).code == "off_host"
    assert "https://metro-fabrics.test/" not in f.requests


@pytest.mark.parametrize(
    ("target", "code"),
    [
        ("https://nowhere.test/", "http_status"),
        ("https://saree-house.test/missing", "http_status"),
        ("https://saree-house.test/../metro-fabrics.test/index", "http_status"),
        ("https://saree-house.test/%2e%2e/metro-fabrics.test/index", "http_status"),
        ("https://saree-house.test/..%2f..%2fetc/passwd", "http_status"),
        ("http://127.0.0.1/", "ip_literal"),
        ("ftp://saree-house.test/", "bad_scheme"),
        ("https://u:p@saree-house.test/", "userinfo"),
        ("https://saree-house.test:8080/", "bad_port"),
    ],
)
def test_the_fake_applies_the_same_url_rules(target: str, code: str) -> None:
    assert refused(fetcher(), target).code == code


def test_a_fake_page_is_the_same_text_as_the_same_file_through_the_sanitiser() -> None:
    from app.webfetch.sanitize import sanitize_html

    raw = (FIXTURES / "saree-house.test" / "about.html").read_text(encoding="utf-8")
    assert (
        fetcher().fetch("https://saree-house.test/about").text
        == sanitize_html(raw, max_chars=8000).text
    )


def test_the_fake_never_opens_a_socket() -> None:
    """The autouse fixture makes any network attempt raise; a whole run passes under it."""
    f = fetcher()
    for target in (
        "https://saree-house.test/",
        "https://metro-fabrics.test/",
        "https://closed-shop.test/",
    ):
        f.fetch(target)
    assert f.requests == [
        "https://saree-house.test/",
        "https://metro-fabrics.test/",
        "https://closed-shop.test/",
    ]


def test_both_fetchers_satisfy_the_interface() -> None:
    fakes: PageFetcher = fetcher()
    real: PageFetcher = SafeFetcher()
    assert fakes is not real


# ------------------------------------------------------------------------------------ search


def hits() -> dict[str, list[SearchHit]]:
    return {
        "silk saree wholesaler chennai": [
            SearchHit("https://saree-house.test/", "Saree House", "Wholesale silk sarees"),
            SearchHit("https://metro-fabrics.test/", "Metro Fabrics", "Dress fabrics"),
            SearchHit("https://closed-shop.test/", "Old Silk Emporium", "Closed"),
        ]
    }


def test_the_search_fake_returns_canned_hits_for_a_normalised_query() -> None:
    provider: SearchProvider = FixtureSearchProvider(hits())
    found = provider.search("  Silk SAREE   wholesaler Chennai ")
    assert [h.url for h in found] == [
        "https://saree-house.test/",
        "https://metro-fabrics.test/",
        "https://closed-shop.test/",
    ]
    assert provider.search("something else") == []


@pytest.mark.parametrize(
    ("limit", "expected"), [(1, 1), (2, 2), (3, 3), (10, 3), (0, 1), (-5, 1), (99, 3)]
)
def test_the_search_limit_is_clamped(limit: int, expected: int) -> None:
    assert (
        len(FixtureSearchProvider(hits()).search("silk saree wholesaler chennai", limit=limit))
        == expected
    )


@pytest.mark.parametrize("query", ["", "   ", "x" * 201])
def test_a_bad_query_is_a_constant_refusal(query: str) -> None:
    with pytest.raises(SearchError) as caught:
        FixtureSearchProvider(hits()).search(query)
    assert caught.value.code == "bad_query" and str(caught.value) == "bad_query"
