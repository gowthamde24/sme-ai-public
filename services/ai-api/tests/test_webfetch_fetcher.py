"""The real fetcher against a LOCAL server: every guard has a vector that must be refused, and
must-allow vectors prove the guard is not "block everything". Nothing here leaves 127.0.0.1."""

from __future__ import annotations

import gzip
import os
import socket
import ssl
import threading
import time
import tracemalloc
import zlib
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.agents.web import FetchedPage, FetchError
from app.webfetch.fakes import FixturePageFetcher
from app.webfetch.fetcher import FetchConfig, SafeFetcher, make_default_fetcher
from app.webfetch.netguard import parse_address
from tests.test_webfetch_netguard import BLOCKED_V4, BLOCKED_V6
from tests.webfetch_support import (
    Clock,
    LocalServer,
    Resolver,
    local_fetcher,
    self_signed,
    send,
    url,
)

TLS_CODES = {
    "tls_failed",
    "robots_unavailable",
}  # a failed handshake on robots.txt means the site cannot be asked
PAGE = b"<html><head><title>Acme Silks</title></head><body><p>Wholesale silk sarees.</p><script>bad()</script></body></html>"  # noqa: E501


@pytest.fixture
def server() -> Iterator[LocalServer]:
    s = LocalServer()
    yield s
    s.stop()


def refused(fetcher: SafeFetcher, target: str, **kw: object) -> FetchError:
    with pytest.raises(FetchError) as caught:
        fetcher.fetch(target, **kw)  # type: ignore[arg-type]
    return caught.value


class Spy:
    """Records every connection the fetcher makes, then makes it for real."""

    def __init__(self, redirect_to: int | None = None) -> None:
        self.calls: list[tuple[str, int]] = []
        self.redirect_to = redirect_to

    def __call__(self, ip: str, port: int, timeout: float) -> socket.socket:
        self.calls.append((ip, port))
        return socket.create_connection(("127.0.0.1", self.redirect_to or port), timeout=timeout)


# ============================================================================ must-allow


def test_a_page_is_fetched_sanitised_and_described(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    page = fetcher.fetch(url(server))
    assert isinstance(page, FetchedPage)
    assert (page.status, page.content_type) == (200, "text/html")
    assert page.text == "Acme Silks\nWholesale silk sarees."
    assert "bad()" not in page.text and page.hidden_elements == 1
    assert page.body_bytes == len(PAGE) and not page.truncated
    assert page.final_url == url(server)


def test_the_request_is_a_plain_get_with_a_clear_user_agent_and_nothing_else(
    server: LocalServer,
) -> None:
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    fetcher.fetch(url(server))
    path, headers = server.seen.requests[-1]
    assert path == "/"
    assert headers["host"] == f"site.example.net:{server.port}"  # the NAME, not the pinned address
    assert headers["user-agent"].startswith("SmeAiResearchBot/")
    assert headers["accept-encoding"] == "gzip, deflate"
    assert headers["connection"] == "close"
    for forbidden in (
        "cookie",
        "authorization",
        "referer",
        "origin",
        "proxy-authorization",
        "x-forwarded-for",
    ):
        assert forbidden not in headers


@pytest.mark.parametrize(
    ("ctype", "body", "expected"),
    [
        ("text/html", b"<p>hello</p>", "hello"),
        ("TEXT/HTML; charset=UTF-8", b"<p>hello</p>", "hello"),
        ("application/xhtml+xml", b"<html><body><p>hello</p></body></html>", "hello"),
        ("text/plain", b"hello <b>not markup</b>", "hello <b>not markup</b>"),
        ("text/plain; charset=iso-8859-1", "caf\xe9".encode("latin-1"), "caf\xe9"),
        ("text/html; charset=nonsense-xyz", b"<p>plain</p>", "plain"),
    ],
)
def test_the_allowed_content_types_are_read(
    server: LocalServer, ctype: str, body: bytes, expected: str
) -> None:
    server.route("/", body=body, ctype=ctype)
    fetcher, _ = local_fetcher(server)
    assert fetcher.fetch(url(server)).text == expected


def test_gzip_and_both_deflate_forms_and_chunked_bodies_are_decoded(server: LocalServer) -> None:
    body = b"<p>" + b"silk " * 500 + b"</p>"
    server.route("/gz", body=gzip.compress(body), Content_Encoding="gzip")
    server.route("/zlib", body=zlib.compress(body), Content_Encoding="deflate")
    raw = zlib.compressobj(wbits=-15)
    server.route("/raw", body=raw.compress(body) + raw.flush(), Content_Encoding="deflate")
    server.route("/ident", body=body, Content_Encoding="identity")

    def chunked(h: object) -> None:
        h.send_response(200)  # type: ignore[attr-defined]
        h.send_header("Content-Type", "text/html")  # type: ignore[attr-defined]
        h.send_header("Transfer-Encoding", "chunked")  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]
        for part in (body[:100], body[100:]):
            h.wfile.write(f"{len(part):x}\r\n".encode() + part + b"\r\n")  # type: ignore[attr-defined]
        h.wfile.write(b"0\r\n\r\n")  # type: ignore[attr-defined]

    server.routes["/chunked"] = chunked
    fetcher, _ = local_fetcher(server)
    expected = ("silk " * 500).strip()
    for path in ("/gz", "/zlib", "/raw", "/ident", "/chunked"):
        assert fetcher.fetch(url(server, path)).text == expected, path


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_redirects_are_followed_and_each_hop_is_checked(server: LocalServer, status: int) -> None:
    server.route("/a", status=status, Location="/b")
    server.route("/b", status=status, Location=url(server, "/c"))
    server.route("/c", body=b"<p>final</p>")
    fetcher, _ = local_fetcher(server)
    page = fetcher.fetch(url(server, "/a"))
    assert page.text == "final" and page.final_url == url(server, "/c")


def test_three_redirects_are_allowed_and_a_fourth_is_not(server: LocalServer) -> None:
    for i in range(5):
        server.route(f"/r{i}", status=302, Location=f"/r{i + 1}")
    server.route("/r3", body=b"<p>done</p>")
    fetcher, _ = local_fetcher(server)
    assert fetcher.fetch(url(server, "/r0")).text == "done"  # r0 -> r1 -> r2 -> r3: three hops
    server.route("/r3", status=302, Location="/r4")
    server.route("/r4", body=b"<p>too far</p>")
    assert refused(fetcher, url(server, "/r0")).code == "too_many_redirects"


def test_a_redirect_loop_ends(server: LocalServer) -> None:
    server.route("/x", status=302, Location="/y")
    server.route("/y", status=302, Location="/x")
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/x")).code == "too_many_redirects"


def test_a_site_may_use_its_www_twin_and_nothing_else(server: LocalServer) -> None:
    server.route("/", status=301, Location=f"http://www.site.example.net:{server.port}/home")
    server.route("/home", body=b"<p>www home</p>")
    fetcher, _ = local_fetcher(
        server,
        names=(
            "site.example.net",
            "www.site.example.net",
            "shop.site.example.net",
            "evil.example.org",
        ),
    )
    scope = frozenset({"site.example.net", "www.site.example.net"})
    assert fetcher.fetch(url(server), allowed_hosts=scope).text == "www home"
    assert (
        refused(fetcher, url(server, host="shop.site.example.net"), allowed_hosts=scope).code
        == "off_host"
    )
    assert (
        refused(fetcher, url(server, host="evil.example.org"), allowed_hosts=scope).code
        == "off_host"
    )


def test_an_international_name_is_fetched_by_its_punycode_form(server: LocalServer) -> None:
    server.route("/", body=b"<p>idn</p>")
    fetcher, resolver = local_fetcher(server, names=("xn--bcher-kva.example.net",))
    assert fetcher.fetch(f"http://b{chr(0xFC)}cher.example.net:{server.port}/").text == "idn"
    assert set(resolver.calls) == {"xn--bcher-kva.example.net"}
    assert server.seen.requests[-1][1]["host"] == f"xn--bcher-kva.example.net:{server.port}"


def test_a_query_string_is_sent_and_a_fragment_is_not(server: LocalServer) -> None:
    server.route("/search", body=b"<p>q</p>")
    fetcher, _ = local_fetcher(server)
    fetcher.fetch(url(server, "/search?a=1&b=x%20y#frag"))
    assert server.seen.requests[-1][0] == "/search?a=1&b=x%20y"


def test_set_cookie_is_ignored_and_no_cookie_is_ever_sent(server: LocalServer) -> None:
    server.route("/one", body=b"<p>1</p>", Set_Cookie="session=abc; Path=/")
    server.route("/two", body=b"<p>2</p>")
    fetcher, _ = local_fetcher(server)
    fetcher.fetch(url(server, "/one"))
    fetcher.fetch(url(server, "/two"))
    assert all("cookie" not in headers for _, headers in server.seen.requests)


def test_credentials_are_never_sent_even_when_the_server_asks(server: LocalServer) -> None:
    server.route("/private", status=401, body=b"no", WWW_Authenticate='Basic realm="x"')
    fetcher, _ = local_fetcher(server)
    error = refused(fetcher, url(server, "/private"))
    assert (error.code, error.status) == ("http_status", 401)
    assert all("authorization" not in headers for _, headers in server.seen.requests)


def test_a_tls_site_is_fetched_with_the_certificate_checked_against_the_name(
    tmp_path: Path,
) -> None:
    cert, key = self_signed(tmp_path, "secure.example.net")
    https = LocalServer(tls=(cert, key))
    https.route("/", body=b"<p>secure</p>")
    try:
        ctx = ssl.create_default_context(cafile=str(cert))
        fetcher, _ = local_fetcher(https, names=("secure.example.net",), ssl_context=ctx)
        assert fetcher.fetch(url(https, host="secure.example.net", scheme="https")).text == "secure"
        served = len(https.seen.requests)
        # the same certificate presented for another name is refused, and no request is sent over it
        other, _ = local_fetcher(https, names=("other.example.net",), ssl_context=ctx)
        assert (
            refused(other, url(https, host="other.example.net", scheme="https")).code in TLS_CODES
        )
        # the system trust store does not know this certificate
        strict, _ = local_fetcher(https, names=("secure.example.net",))
        assert (
            refused(strict, url(https, host="secure.example.net", scheme="https")).code in TLS_CODES
        )
        assert len(https.seen.requests) == served
    finally:
        https.stop()


def test_https_to_a_plain_http_port_fails_cleanly(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, scheme="https")).code in {
        "tls_failed",
        "bad_response",
        "timeout",
        "robots_unavailable",
    }


# ============================================================================ addresses


@pytest.mark.parametrize("address", [a for a, _ in BLOCKED_V4 + BLOCKED_V6])
def test_a_name_that_resolves_to_a_refused_address_is_never_connected_to(
    server: LocalServer, address: str
) -> None:
    server.route("/", body=PAGE)
    spy = Spy()
    fetcher, _ = local_fetcher(
        server, allow=(), extra_resolver={"evil.example.net": [address]}, socket_factory=spy
    )
    assert refused(fetcher, url(server, host="evil.example.net")).code in {
        "blocked_address",
        "robots_unavailable",
    }
    assert spy.calls == [] and server.seen.requests == []


def test_one_refused_answer_among_good_ones_refuses_the_whole_name(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    spy = Spy()
    fetcher, _ = local_fetcher(
        server,
        allow=(),
        extra_resolver={"mixed.example.net": ["93.184.216.34", "10.0.0.5"]},
        socket_factory=spy,
    )
    assert refused(fetcher, url(server, host="mixed.example.net")).code in {
        "blocked_address",
        "robots_unavailable",
    }
    assert spy.calls == []


@pytest.mark.parametrize(
    "answer",
    [
        ["0x7f.1"],
        ["2130706433"],
        ["127.1"],
        ["localhost"],
        [""],
        ["8.8.8.8 "],
        ["fe80::1%eth0"],
        ["not an address"],
        ["::ffff:7f00:1 "],
    ],
)
def test_a_resolver_answer_that_is_not_canonical_address_text_is_refused(
    server: LocalServer, answer: list[str]
) -> None:
    spy = Spy()
    fetcher, _ = local_fetcher(
        server, allow=(), extra_resolver={"odd.example.net": answer}, socket_factory=spy
    )
    assert refused(fetcher, url(server, host="odd.example.net")).code in {
        "blocked_address",
        "robots_unavailable",
    }
    assert spy.calls == []


def test_a_failed_or_empty_lookup_is_one_constant_refusal(server: LocalServer) -> None:
    fetcher, _ = local_fetcher(server, extra_resolver={"empty.example.net": []})
    assert refused(fetcher, url(server, host="empty.example.net")).code in {
        "resolve_failed",
        "robots_unavailable",
    }
    assert refused(fetcher, url(server, host="unknown.example.net")).code in {
        "resolve_failed",
        "robots_unavailable",
    }


def test_the_loopback_exception_is_only_for_tests_and_exact(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server, allow=())  # production policy: no exception
    assert refused(fetcher, url(server)).code in {"blocked_address", "robots_unavailable"}
    assert server.seen.requests == []


@pytest.mark.parametrize(
    "name",
    [
        "localhost.",
        "LOCALHOST",
        "foo.localhost",
        "metadata.google.internal",
        "metadata.google.internal.",
        "a.internal",
        "printer.local",
        "x.home.arpa",
        "router.lan",
        "app.intranet",
        "files.corp",
        "metadata",
        "fixture.test",
        "x.invalid",
        "x.example",
    ],
)
def test_names_that_are_never_public_are_refused_before_any_lookup(
    server: LocalServer, name: str
) -> None:
    fetcher, resolver = local_fetcher(server)
    code = refused(fetcher, f"http://{name}/").code
    assert code in {"blocked_name", "bad_host"}
    assert resolver.calls == [] and server.seen.requests == []


@pytest.mark.parametrize(
    "bad",
    [
        "ftp://site.example.net/",
        "file:///etc/passwd",
        "http://127.0.0.1/",
        "http://2130706433/",
        "http://0x7f.0.0.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://user:pw@site.example.net/",
        "http://site.example.net:22/",
        "http://site.example.net:8080/",
        "gopher://site.example.net/",
        "javascript:alert(1)",
    ],
)
def test_a_url_that_breaks_a_rule_is_refused_before_any_lookup_or_connection(
    server: LocalServer, bad: str
) -> None:
    spy = Spy()
    fetcher, resolver = local_fetcher(server, socket_factory=spy)
    # the test server's port is allowed in this config, but 22 and 8080 are not
    refused(fetcher, bad)
    assert resolver.calls == [] and spy.calls == [] and server.seen.requests == []


# ============================================================================ redirects


@pytest.mark.parametrize(
    ("location", "codes"),
    [
        ("http://169.254.169.254/latest/meta-data/", {"ip_literal"}),
        ("http://[::1]/", {"ip_literal"}),
        ("http://2130706433/", {"ip_literal"}),
        ("http://0x7f.1/", {"ip_literal"}),
        ("file:///etc/passwd", {"bad_scheme"}),
        ("ftp://site.example.net/x", {"bad_scheme"}),
        ("gopher://site.example.net/", {"bad_scheme"}),
        ("javascript:alert(1)", {"bad_scheme"}),
        ("http://u:p@site.example.net/", {"userinfo"}),
        ("http://site.example.net:22/", {"bad_port"}),
        ("http://site.example.net:8080/", {"bad_port"}),
        ("http://metadata.google.internal/computeMetadata/v1/", {"blocked_name"}),
        ("http://localhost/", {"bad_host"}),
        (
            "http://evil.example.net/",
            {"blocked_address", "robots_unavailable"},
        ),  # resolves to a private address
    ],
)
def test_every_redirect_hop_is_checked_from_scratch(
    server: LocalServer, location: str, codes: set[str]
) -> None:
    server.route("/start", status=302, Location=location)
    spy = Spy()
    fetcher, _ = local_fetcher(
        server, extra_resolver={"evil.example.net": ["10.0.0.5"]}, socket_factory=spy
    )
    error = refused(fetcher, url(server, "/start"))
    assert error.code in codes
    assert [
        c for c in spy.calls if c[0] != "127.0.0.1"
    ] == []  # nothing but the first, allowed host was ever dialled


def test_a_second_hop_is_checked_even_when_the_first_was_fine(server: LocalServer) -> None:
    server.route("/a", status=302, Location="/b")
    server.route("/b", status=302, Location="http://169.254.169.254/")
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/a")).code == "ip_literal"
    assert server.seen.paths() == ["/robots.txt", "/a", "/b"]


def test_a_redirect_off_the_site_is_refused_when_a_scope_is_set(server: LocalServer) -> None:
    server.route("/", status=302, Location=f"http://other.example.net:{server.port}/x")
    server.route("/x", body=b"<p>other</p>")
    fetcher, _ = local_fetcher(server, names=("site.example.net", "other.example.net"))
    scope = frozenset({"site.example.net", "www.site.example.net"})
    assert refused(fetcher, url(server), allowed_hosts=scope).code == "off_host"
    assert "/x" not in server.seen.paths()
    # without a scope the same redirect is followed (the guard is about addresses, the scope about the lead's site)  # noqa: E501
    assert fetcher.fetch(url(server)).text == "other"


def test_a_scoped_redirect_to_a_look_alike_host_is_refused(server: LocalServer) -> None:
    server.route(
        "/", status=302, Location=f"http://site.example.net.evil.example.net:{server.port}/"
    )
    fetcher, _ = local_fetcher(
        server, names=("site.example.net", "site.example.net.evil.example.net")
    )
    assert (
        refused(fetcher, url(server), allowed_hosts=frozenset({"site.example.net"})).code
        == "off_host"
    )


def test_https_to_http_downgrade_is_refused(tmp_path: Path) -> None:
    cert, key = self_signed(tmp_path, "secure.example.net")
    https = LocalServer(tls=(cert, key))
    http = LocalServer()
    https.route("/", status=302, Location=f"http://secure.example.net:{http.port}/")
    http.route("/", body=b"<p>plain</p>")
    try:
        ctx = ssl.create_default_context(cafile=str(cert))
        fetcher, _ = local_fetcher(https, names=("secure.example.net",), ssl_context=ctx)
        fetcher = SafeFetcher(
            FetchConfig(
                ports=frozenset({https.port, http.port}),
                test_allowed_networks=fetcher._cfg.test_allowed_networks,
                min_interval=0.0,
                ssl_context=ctx,
            ),
            resolver=Resolver({"secure.example.net": ["127.0.0.1"]}),
        )
        assert (
            refused(fetcher, f"https://secure.example.net:{https.port}/").code
            == "redirect_downgrade"
        )
        assert http.seen.requests == []
    finally:
        https.stop()
        http.stop()


@pytest.mark.parametrize("location", ["", "/a b", "/x\r\nSet-Cookie: a=b"])
def test_a_missing_or_malformed_location_is_a_constant_refusal(
    server: LocalServer, location: str
) -> None:
    def route(h: object) -> None:
        h.send_response(302)  # type: ignore[attr-defined]
        if location:
            h.send_header("Location", location.replace("\r\n", " "))  # type: ignore[attr-defined]
        h.send_header("Content-Length", "0")  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]

    server.routes["/"] = route
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server)).code == "bad_redirect"


# ============================================================================ DNS rebinding and the peer address  # noqa: E501


def test_the_name_is_resolved_once_per_request_and_the_connection_goes_to_that_answer(
    server: LocalServer,
) -> None:
    """Answer 1 is the allowed loopback; every later answer is a private address. The page is
    still served: each request (robots, page) resolves once, validates, and dials THAT address."""
    server.route("/", body=PAGE)
    spy = Spy()
    answers: list[list[str]] = [["127.0.0.1"], ["127.0.0.1"], ["10.0.0.5"], ["10.0.0.5"]]
    fetcher, resolver = local_fetcher(
        server, names=(), extra_resolver={"rebind.example.net": answers}, socket_factory=spy
    )
    assert fetcher.fetch(url(server, host="rebind.example.net")).text.startswith("Acme")
    assert resolver.calls == [
        "rebind.example.net",
        "rebind.example.net",
    ]  # robots.txt, then the page: one lookup each
    assert [ip for ip, _ in spy.calls] == ["127.0.0.1", "127.0.0.1"]


def test_a_later_private_answer_is_caught_on_the_next_request_not_trusted_from_the_first(
    server: LocalServer,
) -> None:
    server.route("/", body=PAGE)
    spy = Spy()
    fetcher, resolver = local_fetcher(
        server,
        names=(),
        extra_resolver={"rebind.example.net": [["127.0.0.1"], ["10.0.0.5"]]},
        socket_factory=spy,
    )
    assert refused(fetcher, url(server, host="rebind.example.net")).code in {
        "blocked_address",
        "robots_unavailable",
    }
    assert server.seen.paths() == ["/robots.txt"]  # the page itself was never requested
    assert [ip for ip, _ in spy.calls] == ["127.0.0.1"]


def test_the_peer_address_actually_connected_to_is_checked_again(server: LocalServer) -> None:
    """The name resolves to a PUBLIC address, but the socket we get is connected to loopback (a
    transparent redirect, a proxy, a poisoned route). The peer check refuses before any byte is sent."""  # noqa: E501
    server.route("/", body=PAGE)
    spy = Spy(redirect_to=server.port)
    peer = SafeFetcher(
        FetchConfig(ports=frozenset({server.port}), min_interval=0.0),
        resolver=Resolver({"pub.example.net": ["93.184.216.34"]}),
        socket_factory=spy,
    )
    assert refused(peer, f"http://pub.example.net:{server.port}/").code in {
        "peer_mismatch",
        "robots_unavailable",
    }
    assert spy.calls and server.seen.requests == []  # connected, but not one request byte was sent


class _FakePeer:
    def __init__(self, peer: str) -> None:
        self._peer = peer

    def getpeername(self) -> tuple[str, int]:
        return (self._peer, 80)


@pytest.mark.parametrize(
    ("pinned", "peer", "ok"),
    [
        ("93.184.216.34", "93.184.216.34", True),
        ("93.184.216.34", "93.184.216.35", False),
        ("93.184.216.34", "127.0.0.1", False),
        (
            "93.184.216.34",
            "::ffff:93.184.216.34",
            True,
        ),  # a dual-stack socket reports the mapped form
        ("93.184.216.34", "::ffff:127.0.0.1", False),
        ("2606:4700:4700::1111", "2606:4700:4700::1111", True),
        ("2606:4700:4700::1111", "2606:4700:4700::1112", False),
        ("2606:4700:4700::1111", "::1", False),
        ("93.184.216.34", "garbage", False),
    ],
)
def test_the_peer_check_compares_the_connected_address_to_the_pinned_one(
    pinned: str, peer: str, ok: bool
) -> None:
    fetcher = SafeFetcher()
    address = parse_address(pinned)
    assert address is not None
    if ok:
        fetcher._check_peer(_FakePeer(peer), address)  # type: ignore[arg-type]
    else:
        with pytest.raises(FetchError) as caught:
            fetcher._check_peer(_FakePeer(peer), address)  # type: ignore[arg-type]
        assert caught.value.code == "peer_mismatch"


def test_a_peer_inside_a_refused_range_is_refused_even_when_it_equals_the_pinned_address() -> None:
    fetcher = SafeFetcher()
    address = parse_address("10.0.0.5")
    assert address is not None
    with pytest.raises(FetchError) as caught:
        fetcher._check_peer(_FakePeer("10.0.0.5"), address)  # type: ignore[arg-type]
    assert caught.value.code == "peer_mismatch"


# ============================================================================ limits


def drip_headers(h: object, server: LocalServer) -> None:
    sock = h.connection  # type: ignore[attr-defined]
    for byte in b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Slow: " + b"a" * 200:
        if server.stopping.is_set():
            return
        try:
            sock.sendall(bytes([byte]))
        except OSError:
            return
        time.sleep(0.05)


def test_a_server_that_drips_its_headers_cannot_hold_the_fetch_past_the_total_deadline(
    server: LocalServer,
) -> None:
    server.routes["/slow"] = lambda h: drip_headers(h, server)
    fetcher, _ = local_fetcher(server, total_timeout=1.0)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/slow")).code == "timeout"
    assert time.monotonic() - started < 3.0


def test_a_server_that_drips_its_body_cannot_either(server: LocalServer) -> None:
    def route(h: object) -> None:
        h.send_response(200)  # type: ignore[attr-defined]
        h.send_header("Content-Type", "text/html")  # type: ignore[attr-defined]
        h.send_header("Content-Length", "100000")  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]
        for _ in range(1000):
            if server.stopping.is_set():
                return
            try:
                h.wfile.write(b"x")  # type: ignore[attr-defined]
                h.wfile.flush()  # type: ignore[attr-defined]
            except OSError:
                return
            time.sleep(0.05)

    server.routes["/slow"] = route
    fetcher, _ = local_fetcher(server, total_timeout=1.0)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/slow")).code == "timeout"
    assert time.monotonic() - started < 3.0


def test_a_server_that_never_answers_is_cut_off(server: LocalServer) -> None:
    def hang(h: object) -> None:
        server.stopping.wait(10)

    server.routes["/hang"] = hang
    fetcher, _ = local_fetcher(server, total_timeout=0.8)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/hang")).code == "timeout"
    assert time.monotonic() - started < 3.0


def test_a_lookup_that_hangs_is_cut_off_by_the_same_deadline(server: LocalServer) -> None:
    release = threading.Event()

    def slow(host: str, port: int) -> list[str]:
        release.wait(5)
        return ["127.0.0.1"]

    from app.webfetch.netguard import Network  # noqa: F401

    fetcher = SafeFetcher(
        FetchConfig(ports=frozenset({server.port}), total_timeout=0.5, min_interval=0.0),
        resolver=slow,
    )
    started = time.monotonic()
    assert refused(fetcher, url(server)).code == "timeout"
    assert time.monotonic() - started < 2.0
    release.set()


def test_the_total_deadline_spans_all_redirect_hops(server: LocalServer) -> None:
    def route(nxt: str) -> object:
        def handler(h: object) -> None:
            time.sleep(0.4)
            send(h, 302, b"", None, Location=nxt)  # type: ignore[arg-type]

        return handler

    server.routes["/a"] = route("/b")  # type: ignore[assignment]
    server.routes["/b"] = route("/c")  # type: ignore[assignment]
    server.routes["/c"] = route("/d")  # type: ignore[assignment]
    server.route("/d", body=b"<p>end</p>")
    fetcher, _ = local_fetcher(server, total_timeout=1.0)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/a")).code == "timeout"
    assert time.monotonic() - started < 3.0


def test_a_huge_declared_length_is_refused_before_anything_is_read(server: LocalServer) -> None:
    def route(h: object) -> None:
        h.send_response(200)  # type: ignore[attr-defined]
        h.send_header("Content-Type", "text/html")  # type: ignore[attr-defined]
        h.send_header("Content-Length", str(10**10))  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]
        server.stopping.wait(3)

    server.routes["/big"] = route
    fetcher, _ = local_fetcher(server, max_body_bytes=100_000)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/big")).code == "too_large"
    assert time.monotonic() - started < 2.0


def test_a_body_that_just_keeps_coming_stops_at_the_cap(server: LocalServer) -> None:
    def route(h: object) -> None:
        h.send_response(200)  # type: ignore[attr-defined]
        h.send_header("Content-Type", "text/html")  # type: ignore[attr-defined]
        h.send_header("Transfer-Encoding", "chunked")  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]
        try:
            for _ in range(10_000):
                h.wfile.write(b"2000\r\n" + b"x" * 0x2000 + b"\r\n")  # type: ignore[attr-defined]
        except OSError:
            return

    server.routes["/endless"] = route
    fetcher, _ = local_fetcher(server, max_body_bytes=100_000)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/endless")).code == "too_large"
    assert time.monotonic() - started < 3.0


def test_the_cap_is_exact_at_the_boundary(server: LocalServer) -> None:
    server.route("/at", body=b"<p>" + b"x" * (1000 - 7) + b"</p>")  # exactly 1000 bytes
    server.route("/over", body=b"<p>" + b"x" * (1000 - 6) + b"</p>")  # 1001
    fetcher, _ = local_fetcher(server, max_body_bytes=1000)
    assert fetcher.fetch(url(server, "/at")).body_bytes == 1000
    assert refused(fetcher, url(server, "/over")).code == "too_large"


@pytest.mark.parametrize("kind", ["gzip", "deflate"])
def test_a_compression_bomb_stops_at_the_decoded_cap_quickly(
    server: LocalServer, kind: str
) -> None:
    """About 200 MB of zeros in a few hundred KB. The decoder is bounded: it never builds the output."""  # noqa: E501
    if kind == "gzip":
        compressor = zlib.compressobj(9, zlib.DEFLATED, 31)
    else:
        compressor = zlib.compressobj(9, zlib.DEFLATED, 15)
    packed = (
        b"".join(compressor.compress(b"\0" * 1_000_000) for _ in range(200)) + compressor.flush()
    )
    assert len(packed) < 400_000
    server.route("/bomb", body=packed, Content_Encoding=kind)
    fetcher, _ = local_fetcher(server, max_body_bytes=1_000_000)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/bomb")).code == "too_large"
    assert time.monotonic() - started < 2.0


def test_a_compressed_body_over_the_raw_cap_is_refused_too(server: LocalServer) -> None:
    import os

    packed = gzip.compress(
        os.urandom(300_000), 1
    )  # incompressible: the compressed size is the problem
    server.route("/rand", body=packed, Content_Encoding="gzip")
    fetcher, _ = local_fetcher(server, max_body_bytes=100_000)
    assert refused(fetcher, url(server, "/rand")).code == "too_large"


@pytest.mark.parametrize(
    "encoding", ["br", "zstd", "compress", "gzip, gzip", "gzip, br", "x-unknown", "identity, gzip"]
)
def test_an_encoding_we_do_not_decode_is_refused(server: LocalServer, encoding: str) -> None:
    server.route("/enc", body=b"<p>x</p>", Content_Encoding=encoding)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/enc")).code == "unsupported_encoding"


def test_a_corrupt_or_truncated_compressed_body_is_a_constant_refusal(server: LocalServer) -> None:
    good = gzip.compress(b"<p>" + b"x" * 5000 + b"</p>")
    server.route("/trunc", body=good[: len(good) // 2], Content_Encoding="gzip")
    server.route("/garbage", body=b"this is not gzip at all", Content_Encoding="gzip")
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/trunc")).code == "bad_response"
    assert refused(fetcher, url(server, "/garbage")).code == "bad_response"


@pytest.mark.parametrize(
    "ctype",
    [
        "application/pdf",
        "image/png",
        "application/json",
        "text/css",
        "text/xml",
        "application/xml",
        "application/javascript",
        "text/javascript",
        "application/octet-stream",
        "text/htmlx",
        "text/html-evil",
        "image/svg+xml",
        "multipart/form-data",
        "text/html, text/plain",
        "",
    ],
)
def test_other_content_types_are_refused(server: LocalServer, ctype: str) -> None:
    server.route("/t", body=b"<p>x</p>", ctype=ctype or None)  # type: ignore[arg-type]
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/t")).code == "unsupported_content_type"


@pytest.mark.parametrize("status", [204, 206, 300, 304, 400, 403, 404, 410, 429, 500, 502, 503])
def test_a_status_other_than_200_is_refused_with_its_number(
    server: LocalServer, status: int
) -> None:
    def route(h: object) -> None:
        h.send_response(status)  # type: ignore[attr-defined]
        h.send_header("Content-Length", "0")  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]

    server.routes["/s"] = route
    fetcher, _ = local_fetcher(server)
    error = refused(fetcher, url(server, "/s"))
    assert (error.code, error.status) == ("http_status", status)


def test_a_broken_response_is_a_constant_refusal(server: LocalServer) -> None:
    server.routes["/junk"] = lambda h: h.connection.sendall(b"this is not http\r\n\r\n")
    server.routes["/early"] = lambda h: h.connection.close()
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/junk")).code == "bad_response"
    assert refused(fetcher, url(server, "/early")).code == "bad_response"


def test_a_connection_that_cannot_be_made_is_a_constant_refusal() -> None:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()  # nothing listens here now
    from tests.webfetch_support import LOOPBACK

    fetcher = SafeFetcher(
        FetchConfig(ports=frozenset({port}), test_allowed_networks=(LOOPBACK,), min_interval=0.0),
        resolver=Resolver({"gone.example.net": ["127.0.0.1"]}),
    )
    assert refused(fetcher, f"http://gone.example.net:{port}/").code in {
        "connect_failed",
        "robots_unavailable",
    }


def test_errors_never_carry_the_url_the_address_or_the_body(server: LocalServer) -> None:
    server.route("/", status=500, body=b"secret-body-text")
    fetcher, _ = local_fetcher(server)
    error = refused(fetcher, url(server, "/?token=SECRETTOKEN"))
    text = f"{error} {error!r} {error.args}"
    assert (
        error.code == "http_status"
        and "SECRETTOKEN" not in text
        and "127.0.0.1" not in text
        and "secret-body" not in text
    )
    assert "site.example.net" not in text


def test_workers_are_not_leaked_by_many_fetches(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server, daily_cap=1000)
    before = threading.active_count()
    for _ in range(30):
        fetcher.fetch(url(server))
    time.sleep(0.2)
    assert threading.active_count() <= before + 2


# ============================================================================ defaults


def test_the_production_defaults_are_strict() -> None:
    cfg = FetchConfig()
    assert cfg.ports == {80, 443}
    assert cfg.test_allowed_networks == ()
    assert cfg.max_redirects == 3 and cfg.total_timeout <= 10.0
    assert cfg.max_body_bytes == 1_000_000 and cfg.max_text_chars == 8000
    assert cfg.min_interval >= 2.0 and cfg.daily_cap == 20 and cfg.max_crawl_delay <= 10.0
    assert "SmeAiResearchBot" in cfg.user_agent
    fetcher = make_default_fetcher()
    assert fetcher._cfg == cfg


@pytest.mark.parametrize(
    "bad",
    [
        "http://example.com:8080/",
        "http://example.com:22/",
        "https://example.com:8443/",
        "http://127.0.0.1/",
        "http://localhost/",
        "http://metadata.google.internal/",
        "http://169.254.169.254/",
        "file:///etc/passwd",
        "http://u:p@example.com/",
    ],
)
def test_the_default_fetcher_refuses_bad_urls_without_touching_the_network(bad: str) -> None:
    """Default config, system resolver, real sockets: these never get as far as a lookup."""
    with pytest.raises(FetchError):
        make_default_fetcher().fetch(bad)


# ============================================================================ robots


def robots(server: LocalServer, text: str, status: int = 200, ctype: str = "text/plain") -> None:
    server.route("/robots.txt", status=status, body=text, ctype=ctype)


def test_robots_is_fetched_first_and_a_disallowed_path_is_never_requested(
    server: LocalServer,
) -> None:
    robots(server, "User-agent: *\nDisallow: /private\n")
    server.route("/private/page", body=PAGE)
    server.route("/public", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server, "/private/page")).code == "robots_disallowed"
    assert "/private/page" not in server.seen.paths()
    assert fetcher.fetch(url(server, "/public")).text.startswith("Acme")
    assert server.seen.paths()[0] == "/robots.txt"


def test_a_group_for_our_crawler_beats_the_wildcard(server: LocalServer) -> None:
    robots(server, "User-agent: *\nDisallow:\n\nUser-agent: SmeAiResearchBot\nDisallow: /\n")
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server)).code == "robots_disallowed"
    robots(server, "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:\n")
    other, _ = local_fetcher(server)
    assert other.fetch(url(server)).text.startswith("Acme")


def test_a_site_that_disallows_everything_is_not_read(server: LocalServer) -> None:
    robots(server, "User-agent: *\nDisallow: /\n")
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server)).code == "robots_disallowed"
    assert server.seen.paths() == ["/robots.txt"]


@pytest.mark.parametrize("status", [404, 410])
def test_a_missing_robots_file_allows_everything(server: LocalServer, status: int) -> None:
    robots(server, "", status=status)
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert fetcher.fetch(url(server)).text.startswith("Acme")


@pytest.mark.parametrize("status", [401, 403, 429, 500, 502, 503])
def test_a_site_that_cannot_be_asked_is_not_read(server: LocalServer, status: int) -> None:
    robots(server, "User-agent: *\nDisallow:\n", status=status)
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server)).code == "robots_unavailable"
    assert "/" not in server.seen.paths()


def test_robots_served_as_html_with_status_200_is_just_a_file_with_no_rules(
    server: LocalServer,
) -> None:
    robots(server, "<html><body>Welcome</body></html>", ctype="text/html")
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert fetcher.fetch(url(server)).text.startswith("Acme")


def test_an_oversized_robots_file_means_the_site_cannot_be_asked(server: LocalServer) -> None:
    robots(server, "User-agent: *\nDisallow: /x\n" + "# padding\n" * 40_000)
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server)).code == "robots_unavailable"


def test_robots_goes_through_the_same_guard_so_it_cannot_reach_a_private_address(
    server: LocalServer,
) -> None:
    server.route("/", body=PAGE)
    robots(server, "User-agent: *\nDisallow:\n")
    spy = Spy()
    # the first lookup (robots.txt) already answers with a private address: refused, nothing dialled
    fetcher, _ = local_fetcher(
        server, allow=(), extra_resolver={"site.example.net": ["10.1.2.3"]}, socket_factory=spy
    )
    assert refused(fetcher, url(server)).code == "robots_unavailable"
    assert spy.calls == [] and server.seen.requests == []


def test_a_robots_redirect_is_checked_like_any_redirect(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    server.route("/robots.txt", status=302, Location="http://169.254.169.254/robots.txt")
    fetcher, _ = local_fetcher(server)
    assert refused(fetcher, url(server)).code == "robots_unavailable"
    assert "/" not in server.seen.paths()
    server.route("/robots.txt", status=301, Location="/real-robots")
    server.route("/real-robots", body="User-agent: *\nDisallow: /\n", ctype="text/plain")
    other, _ = local_fetcher(server)
    assert (
        refused(other, url(server)).code == "robots_disallowed"
    )  # the redirected file was read and obeyed


def test_a_robots_redirect_off_the_site_is_not_followed_when_scoped(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    server.route(
        "/robots.txt", status=302, Location=f"http://other.example.net:{server.port}/robots.txt"
    )
    server.route("/robots2", body="User-agent: *\nDisallow:\n")
    fetcher, _ = local_fetcher(server, names=("site.example.net", "other.example.net"))
    scope = frozenset({"site.example.net"})
    assert refused(fetcher, url(server), allowed_hosts=scope).code == "robots_unavailable"


def test_robots_is_cached_for_an_hour_and_a_failure_for_five_minutes(server: LocalServer) -> None:
    robots(server, "User-agent: *\nDisallow:\n")
    server.route("/", body=PAGE)
    clock = Clock()
    fetcher, _ = local_fetcher(server, clock=clock)
    fetcher.fetch(url(server))
    fetcher.fetch(url(server))
    assert server.seen.count("/robots.txt") == 1
    clock.advance(3599)
    fetcher.fetch(url(server))
    assert server.seen.count("/robots.txt") == 1
    clock.advance(2)
    fetcher.fetch(url(server))
    assert server.seen.count("/robots.txt") == 2
    robots(server, "x", status=503)
    clock.advance(3601)
    assert refused(fetcher, url(server)).code == "robots_unavailable"
    assert refused(fetcher, url(server)).code == "robots_unavailable"
    assert server.seen.count("/robots.txt") == 3  # the failure was cached
    robots(server, "User-agent: *\nDisallow:\n")
    clock.advance(301)
    assert fetcher.fetch(url(server)).text.startswith("Acme")


def test_a_crawl_delay_is_honoured_up_to_ten_seconds_and_refused_beyond(
    server: LocalServer,
) -> None:
    server.route("/", body=PAGE)
    clock = Clock()
    robots(server, "User-agent: *\nCrawl-delay: 3\n")
    fetcher, _ = local_fetcher(server, clock=clock)
    fetcher.fetch(url(server))
    fetcher.fetch(url(server))
    assert clock.slept and max(clock.slept) >= 3.0 - 1e-6
    robots(server, "User-agent: *\nCrawl-delay: 10\n")
    ten, _ = local_fetcher(server, clock=Clock(), total_timeout=15.0)
    assert ten.fetch(url(server)).text.startswith("Acme")
    robots(server, "User-agent: *\nCrawl-delay: 11\n")
    eleven, _ = local_fetcher(server, clock=Clock())
    assert refused(eleven, url(server)).code == "robots_crawl_delay"


def test_each_origin_has_its_own_robots_file(server: LocalServer) -> None:
    robots(server, "User-agent: *\nDisallow: /\n")
    server.route("/", body=PAGE)
    fetcher, _ = local_fetcher(server, names=("site.example.net", "other.example.net"))
    assert refused(fetcher, url(server)).code == "robots_disallowed"
    robots(server, "User-agent: *\nDisallow:\n")
    assert fetcher.fetch(url(server, host="other.example.net")).text.startswith("Acme")


# ============================================================================ rate and daily limits


def test_two_requests_to_one_host_are_spaced_and_other_hosts_are_not_delayed(
    server: LocalServer,
) -> None:
    server.route("/", body=PAGE)
    clock = Clock()
    fetcher, _ = local_fetcher(
        server, names=("site.example.net", "other.example.net"), clock=clock, min_interval=2.0
    )
    fetcher.fetch(url(server))
    assert clock.slept == [2.0]  # robots.txt then the page: the page waited for the interval
    clock.slept.clear()
    fetcher.fetch(url(server, host="other.example.net"))
    assert clock.slept == [2.0]  # its own robots.txt then its page, independent of the first host
    clock.slept.clear()
    clock.advance(10)
    fetcher.fetch(url(server))
    assert clock.slept == []  # long enough ago, and robots.txt is cached


def test_a_wait_longer_than_the_time_left_is_refused_not_slept(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    clock = Clock()
    fetcher, _ = local_fetcher(server, clock=clock, min_interval=60.0, total_timeout=5.0)
    assert refused(fetcher, url(server)).code == "rate_limited"
    assert clock.slept == []


def test_at_most_twenty_pages_per_host_per_day(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    clock = Clock()
    fetcher, _ = local_fetcher(server, clock=clock, daily_cap=3)
    for _ in range(3):
        fetcher.fetch(url(server))
    assert refused(fetcher, url(server)).code == "daily_limit"
    clock.advance(86_000)
    assert refused(fetcher, url(server)).code == "daily_limit"
    clock.advance(500)
    assert fetcher.fetch(url(server)).text.startswith("Acme")


def test_refused_and_failed_fetches_do_not_use_up_the_daily_cap(server: LocalServer) -> None:
    server.route("/", body=PAGE)
    server.route("/gone", status=404)
    fetcher, _ = local_fetcher(server, clock=Clock(), daily_cap=2)
    for _ in range(5):
        assert refused(fetcher, url(server, "/gone")).code == "http_status"
    assert fetcher.fetch(url(server)).text.startswith("Acme")
    assert fetcher.fetch(url(server)).text.startswith("Acme")
    assert refused(fetcher, url(server)).code == "daily_limit"


def test_the_fake_and_the_real_fetcher_give_the_same_text_for_the_same_page(
    server: LocalServer,
) -> None:
    """One text pipeline: serve a fixture file through the real fetcher and through the fake."""
    fixtures = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "web"
    for host, name in (("metro-fabrics.test", "index.html"), ("saree-house.test", "about.html")):
        html = (fixtures / host / name).read_bytes()
        server.route("/page", body=html)
        real, _ = local_fetcher(server)
        via_real = real.fetch(url(server, "/page"))
        via_fake = FixturePageFetcher(fixtures).fetch(
            f"https://{host}/" + ("" if name == "index.html" else name)
        )
        assert (
            via_real.text == via_fake.text and via_real.hidden_elements == via_fake.hidden_elements
        )
        assert via_real.body_bytes == via_fake.body_bytes


def test_the_raw_size_is_capped_too_not_only_the_decoded_size(server: LocalServer) -> None:
    """990 incompressible bytes fit a 1000-byte cap once decoded, but the gzip file is larger than
    1000 and arrives chunked (no Content-Length to check up front)."""
    packed = gzip.compress(os.urandom(990), 0)
    assert len(packed) > 1000

    def route(h: object) -> None:
        h.send_response(200)  # type: ignore[attr-defined]
        h.send_header("Content-Type", "text/html")  # type: ignore[attr-defined]
        h.send_header("Content-Encoding", "gzip")  # type: ignore[attr-defined]
        h.send_header("Transfer-Encoding", "chunked")  # type: ignore[attr-defined]
        h.end_headers()  # type: ignore[attr-defined]
        h.wfile.write(f"{len(packed):x}\r\n".encode() + packed + b"\r\n0\r\n\r\n")  # type: ignore[attr-defined]

    server.routes["/stored"] = route
    fetcher, _ = local_fetcher(server, max_body_bytes=1000)
    assert refused(fetcher, url(server, "/stored")).code == "too_large"


def test_the_decoder_never_builds_more_than_the_cap_in_memory(server: LocalServer) -> None:
    """A bomb must be stopped while it is being decoded, not after a huge buffer exists."""
    compressor = zlib.compressobj(9, zlib.DEFLATED, 31)
    packed = (
        b"".join(compressor.compress(b"\0" * 1_000_000) for _ in range(100)) + compressor.flush()
    )
    server.route("/bomb", body=packed, Content_Encoding="gzip")
    fetcher, _ = local_fetcher(server, max_body_bytes=200_000)
    tracemalloc.start()
    try:
        assert refused(fetcher, url(server, "/bomb")).code == "too_large"
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 4_000_000, peak


def test_a_slow_last_hop_gets_only_the_time_that_is_left(server: LocalServer) -> None:
    """The first hop uses most of the budget; the second drips. One deadline covers both."""

    def first(h: object) -> None:
        time.sleep(0.7)
        send(h, 302, b"", None, Location="/slow")  # type: ignore[arg-type]

    server.routes["/first"] = first
    server.routes["/slow"] = lambda h: drip_headers(h, server)
    fetcher, _ = local_fetcher(server, total_timeout=1.0)
    started = time.monotonic()
    assert refused(fetcher, url(server, "/first")).code == "timeout"
    assert time.monotonic() - started < 1.5


def test_the_watchdog_also_covers_a_tls_connection(tmp_path: Path) -> None:
    cert, key = self_signed(tmp_path, "secure.example.net")
    https = LocalServer(tls=(cert, key))
    https.routes["/slow"] = lambda h: drip_headers(h, https)
    try:
        ctx = ssl.create_default_context(cafile=str(cert))
        fetcher, _ = local_fetcher(
            https, names=("secure.example.net",), ssl_context=ctx, total_timeout=1.0
        )
        started = time.monotonic()
        assert (
            refused(fetcher, url(https, "/slow", host="secure.example.net", scheme="https")).code
            == "timeout"
        )
        assert time.monotonic() - started < 3.0
    finally:
        https.stop()


class _BrokenPeer:
    def getpeername(self) -> tuple[str, int]:
        raise OSError("not connected")


def test_an_unreadable_peer_address_is_refused() -> None:
    address = parse_address("93.184.216.34")
    assert address is not None
    with pytest.raises(FetchError) as caught:
        SafeFetcher()._check_peer(_BrokenPeer(), address)  # type: ignore[arg-type]
    assert caught.value.code == "peer_mismatch"
