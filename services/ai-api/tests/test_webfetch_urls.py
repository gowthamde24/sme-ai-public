"""URL rules: what the fetcher will even consider, in one normal form."""

from __future__ import annotations

import pytest

from app.agents.web import FetchError
from app.webfetch.urls import (
    BLOCKED_NAMES,
    BLOCKED_SUFFIXES,
    blocked_name,
    normalise_host,
    parse_target,
    resolve_location,
    site_hosts,
)


def refused(url: object, *, ports: frozenset[int] = frozenset({80, 443})) -> str:
    with pytest.raises(FetchError) as caught:
        parse_target(url, ports=ports)
    return caught.value.code


@pytest.mark.parametrize(
    ("url", "normal"),
    [
        ("http://example.com", "http://example.com/"),
        ("https://example.com/", "https://example.com/"),
        ("HTTPS://Example.COM/About?x=1#frag", "https://example.com/About?x=1"),
        ("https://example.com:443/a", "https://example.com/a"),
        ("http://example.com:80/a", "http://example.com/a"),
        ("http://example.com./a", "http://example.com/a"),
        ("https://www.acme-silks.in/products/saree", "https://www.acme-silks.in/products/saree"),
        ("https://bücher.example.org/", "https://xn--bcher-kva.example.org/"),
        ("https://xn--bcher-kva.example.org/", "https://xn--bcher-kva.example.org/"),
        ("https://sub.domain.example.co.in/p%20q", "https://sub.domain.example.co.in/p%20q"),
        ("https://example.com/ü", "https://example.com/%C3%BC"),
        ("https://a-b.example.com/", "https://a-b.example.com/"),
        ("https://1example.com/", "https://1example.com/"),
        ("https://example.com/a?q=a+b&r=1", "https://example.com/a?q=a+b&r=1"),
    ],
)
def test_a_good_url_is_normalised(url: str, normal: str) -> None:
    assert parse_target(url).url == normal


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("ftp://example.com/", "bad_scheme"),
        ("file:///etc/passwd", "bad_scheme"),
        ("gopher://example.com/", "bad_scheme"),
        ("javascript:alert(1)", "bad_scheme"),
        ("data:text/html,x", "bad_scheme"),
        ("//example.com/x", "bad_scheme"),
        ("example.com/x", "bad_scheme"),
        ("ws://example.com/", "bad_scheme"),
        ("http:/example.com", "bad_host"),
        ("http://", "bad_host"),
        ("http:///x", "bad_host"),
        ("", "bad_url"),
        (None, "bad_url"),
        (42, "bad_url"),
    ],
)
def test_other_schemes_and_shapes_are_refused(url: object, code: str) -> None:
    assert refused(url) == code


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com:8080/",
        "http://example.com:22/",
        "https://example.com:8443/",
        "http://example.com:0/",
        "http://example.com:81/",
        "http://example.com:444/",
    ],
)
def test_only_ports_80_and_443(url: str) -> None:
    assert refused(url) == "bad_port"


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com:65536/",
        "http://example.com:99999/",
        "http://example.com:abc/",
        "http://example.com:80:90/",
        "http://example.com:-1/",
    ],
)
def test_a_malformed_port_is_refused(url: str) -> None:
    assert refused(url) == "bad_port"


@pytest.mark.parametrize(
    "url",
    [
        "http://user@example.com/",
        "http://user:pw@example.com/",
        "http://:pw@example.com/",
        "http://good.example.com@evil.example.org/",
        "http://a@b@example.com/",
        "https://example.com@127.0.0.1/",
        "https://@example.com/",
    ],
)
def test_userinfo_is_refused(url: str) -> None:
    assert refused(url) == "userinfo"


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1",
        "8.8.8.8",
        "10.0.0.1",
        "169.254.169.254",
        "0.0.0.0",  # noqa: S104
        "2130706433",
        "0x7f000001",
        "0x7f.0.0.1",
        "0177.0.0.1",
        "017700000001",
        "0300.0250.0.1",
        "127.1",
        "127.0.1",
        "1.2.3",
        "4294967295",
        "0",
        "00",
        "0x0",
        "0x",
        "127.0.0.1.",
        "1.1.1.1.",
        "[::1]",
        "[::ffff:127.0.0.1]",
        "[::ffff:7f00:1]",
        "[2001:db8::1]",
        "[fe80::1%25eth0]",
        "[::]",
        "127。0。0。1",  # ideographic full stops: IDNA turns them into dots
        "１２７.0.0.1",  # full-width digits
    ],
)
def test_an_ip_address_in_any_spelling_is_not_a_host(host: str) -> None:
    assert refused(f"http://{host}/") == "ip_literal"


@pytest.mark.parametrize("host", ["::1", "::ffff:127.0.0.1", "fe80::1", "2001:db8::1"])
def test_an_unbracketed_ipv6_address_is_refused_too(host: str) -> None:
    assert refused(f"http://{host}/") in {"ip_literal", "bad_port", "bad_host", "bad_url"}


@pytest.mark.parametrize(
    "url",
    [
        "http://a..example.com/",
        "http://-bad-.example.com/",
        "http://bad-.example.com/",
        "http://under_score.example.com/",
        "http://" + "a" * 64 + ".example.com/",
        "http://" + ".".join(["a" * 60] * 5) + ".com/",
        "http://intranet/",
        "http://localhost/",
        "http://exa mple.com/",
        "http://.example.com/",
        "http://example..com/",
        "http://ex%61mple.com/",
        "http://exam!ple.com/",
        "http://xn--/",
    ],
)
def test_malformed_names_are_refused(url: str) -> None:
    assert refused(url) in {"bad_host", "bad_url", "ip_literal"}


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/a b",
        "http://example.com/a\tb",
        "http://example.com/a\nb",
        "http://example.com/a\rb",
        "http://example.com\\@evil.com/",
        "http://example.com/a\\b",
        "http://example.com/\x00",
        "http://example.com/\x7f",
        "http://exam\u0085ple.com/",
        " http://example.com/",
        "http://example.com/ ",
        "http://example.com/\u2028",
        "http://example.com/" + "a" * 3000,
        "http://example.com/\u00a0",
        "http://example.com/\u200b",
        "http://example.com/\u202e",
        "http://example.com/\ufeff",
        "http://example.com/\U000e0041",
        "http://example.com/\ue000",
        "http://exam\u200dple.com/",
    ],
)
def test_control_characters_spaces_backslashes_and_huge_urls_are_refused(url: str) -> None:
    code = refused(url)
    assert code in {"bad_url", "bad_host"}


def test_a_wider_port_list_is_a_test_only_setting() -> None:
    assert parse_target("http://example.com:8080/", ports=frozenset({8080})).port == 8080
    assert refused("http://example.com:8080/") == "bad_port"


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "foo.localhost",
        "LOCALHOST",
        "metadata.google.internal",
        "a.b.internal",
        "internal",
        "printer.local",
        "host.localdomain",
        "x.home.arpa",
        "router.lan",
        "app.intranet",
        "files.corp",
        "db.private",
        "metadata",
        "metadata.goog",
        "fixture.test",
        "x.invalid",
        "x.example",
        "abc.onion",
    ],
)
def test_names_that_are_never_public_are_blocked_by_name(host: str) -> None:
    assert blocked_name(host)


@pytest.mark.parametrize(
    "host",
    [
        "example.com",
        "example.org",
        "acme-silks.in",
        "mytest.com",
        "internal-medicine.com",
        "localhost-hotels.com",
        "notlocal.org",
        "corporate.com",
        "lanka.travel",
        "testing.in",
    ],
)
def test_ordinary_names_are_not_blocked_by_name(host: str) -> None:
    assert not blocked_name(host)


def test_every_blocked_suffix_has_a_vector() -> None:
    vectors = {
        "localhost",
        "local",
        "localdomain",
        "internal",
        "home.arpa",
        "lan",
        "intranet",
        "corp",
        "private",
        "test",
        "invalid",
        "example",
        "onion",
    }
    assert vectors == set(BLOCKED_SUFFIXES)
    assert BLOCKED_NAMES == {"metadata", "metadata.goog"}


@pytest.mark.parametrize(
    ("location", "absolute"),
    [
        ("/next", "http://example.com/next"),
        ("next", "http://example.com/dir/next"),
        ("../up", "http://example.com/up"),
        ("https://example.com/secure", "https://example.com/secure"),
        ("//other.example.org/x", "http://other.example.org/x"),
        ("?q=1", "http://example.com/dir/page?q=1"),
    ],
)
def test_a_redirect_location_is_resolved_against_the_current_url(
    location: str, absolute: str
) -> None:
    base = parse_target("http://example.com/dir/page")
    assert resolve_location(base, location) == absolute


@pytest.mark.parametrize(
    "location", ["/a b", "/a\nb", "http://x.com/\r\nSet-Cookie: a=b", "/a\\b", "/" + "a" * 3000]
)
def test_a_bad_location_is_refused(location: str) -> None:
    with pytest.raises(FetchError) as caught:
        resolve_location(parse_target("http://example.com/"), location)
    assert caught.value.code == "bad_redirect"


def test_a_site_may_be_reached_with_or_without_www_and_nothing_else() -> None:
    assert site_hosts("acme.in") == {"acme.in", "www.acme.in"}
    assert site_hosts("www.acme.in") == {"acme.in", "www.acme.in"}
    assert "shop.acme.in" not in site_hosts("acme.in")
    assert "acme.in.evil.example" not in site_hosts("acme.in")


@pytest.mark.parametrize("raw", ["::1", "[::1]", ":80", "a:b", "[2001:db8::1]"])
def test_normalise_host_refuses_anything_with_a_colon_as_an_ip_literal(raw: str) -> None:
    with pytest.raises(FetchError) as caught:
        normalise_host(raw)
    assert caught.value.code == "ip_literal"


def test_normalise_host_lower_cases_and_converts_to_punycode() -> None:
    assert normalise_host("Example.COM") == "example.com"
    assert normalise_host("B" + chr(0xFC) + "cher.Example.org.") == "xn--bcher-kva.example.org"
    for bad in ("", "a", ".", "a.", "-a.com", "a b.com"):
        with pytest.raises(FetchError):
            normalise_host(bad)


def test_an_error_message_is_only_its_code() -> None:
    with pytest.raises(FetchError) as caught:
        parse_target("http://127.0.0.1/secret?token=abc")
    assert str(caught.value) == "ip_literal"
    assert "127" not in str(caught.value) and "secret" not in repr(caught.value)
    with pytest.raises(ValueError):
        FetchError("a typo")
