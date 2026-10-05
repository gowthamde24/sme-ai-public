"""Which resolved addresses the fetcher may connect to: every refused class has a vector, and the
public addresses a research run really needs are allowed (the guard is not "block everything")."""

from __future__ import annotations

import ipaddress

import pytest

from app.webfetch.netguard import DENIED_V4, DENIED_V6, address_allowed, parse_address

BLOCKED_V4 = [
    ("0.0.0.0", "unspecified"),  # noqa: S104
    ("0.1.2.3", "this network"),
    ("10.0.0.1", "private 10/8"),
    ("10.255.255.255", "private 10/8 top"),
    ("100.64.0.1", "carrier-grade NAT low"),
    ("100.127.255.254", "carrier-grade NAT high"),
    ("127.0.0.1", "loopback"),
    ("127.255.255.254", "loopback high"),
    ("169.254.0.1", "link-local low"),
    ("169.254.169.254", "the cloud metadata address (GCP, AWS, Azure)"),
    ("172.16.0.1", "private 172.16/12 low"),
    ("172.31.255.255", "private 172.16/12 high"),
    ("192.0.0.8", "IETF protocol assignments"),
    ("192.0.2.1", "documentation TEST-NET-1"),
    ("192.88.99.1", "6to4 relay"),
    ("192.168.1.1", "private 192.168/16"),
    ("198.18.0.1", "benchmarking low"),
    ("198.19.255.255", "benchmarking high"),
    ("198.51.100.7", "documentation TEST-NET-2"),
    ("203.0.113.9", "documentation TEST-NET-3"),
    ("224.0.0.1", "multicast low"),
    ("239.255.255.250", "multicast high"),
    ("240.0.0.1", "reserved"),
    ("255.255.255.255", "broadcast"),
]
BLOCKED_V6 = [
    ("::", "unspecified"),
    ("::1", "loopback"),
    ("::ffff:127.0.0.1", "IPv4-mapped loopback"),
    ("::ffff:10.0.0.1", "IPv4-mapped private"),
    ("::ffff:169.254.169.254", "IPv4-mapped metadata address"),
    ("::ffff:8.8.8.8", "IPv4-mapped even when the embedded address is public"),
    ("::127.0.0.1", "IPv4-compatible loopback"),
    ("64:ff9b::7f00:1", "NAT64 embedding loopback"),
    ("64:ff9b::a00:1", "NAT64 embedding 10.0.0.1"),
    ("64:ff9b::808:808", "NAT64 even for a public embedded address"),
    ("fc00::1", "unique local"),
    ("fd00:ec2::254", "unique local (the AWS IPv6 metadata address)"),
    ("fe80::1", "link-local"),
    ("febf::1", "link-local high"),
    ("fec0::1", "site-local (deprecated)"),
    ("ff02::1", "multicast"),
    ("ff00::", "multicast low"),
    ("100::1", "discard-only"),
    ("2001::1", "Teredo / IETF protocol assignments"),
    ("2001:0:4136:e378:8000:63bf:3fff:fdd2", "a Teredo address"),
    ("2001:db8::1", "documentation"),
    ("2002:7f00:1::1", "6to4 embedding 127.0.0.1"),
    ("2002:808:808::1", "6to4 even for a public embedded address"),
    ("3fff::1", "documentation (3fff::/20)"),
    ("4000::1", "outside global unicast"),
    ("1000::1", "outside global unicast, low"),
    ("e000::1", "outside global unicast, high"),
]
ALLOWED = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "104.18.0.1",
    "172.15.255.255",  # just below 172.16/12
    "172.32.0.1",  # just above it
    "100.63.255.255",  # just below CGNAT
    "100.128.0.1",  # just above it
    "169.253.1.1",
    "11.0.0.1",
    "9.255.255.255",
    "223.255.255.254",  # just below multicast
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "2400:cb00::1",
    "2001:4860:4860::8888",  # outside 2001::/23
    "3ffe::1",  # global unicast outside the 3fff::/20 documentation block
]


@pytest.mark.parametrize(("text", "why"), BLOCKED_V4 + BLOCKED_V6, ids=lambda v: str(v)[:40])
def test_a_refused_class_is_refused(text: str, why: str) -> None:
    address = parse_address(text)
    assert address is not None
    assert not address_allowed(address), why


@pytest.mark.parametrize("text", ALLOWED)
def test_a_public_address_is_allowed(text: str) -> None:
    address = parse_address(text)
    assert address is not None
    assert address_allowed(address), text


@pytest.mark.parametrize("network", [n for n, _ in DENIED_V4], ids=str)
def test_every_refused_ipv4_range_is_refused_at_both_ends(
    network: ipaddress.IPv4Network,
) -> None:
    assert not address_allowed(network[0])
    assert not address_allowed(network[-1])
    assert not address_allowed(network[network.num_addresses // 2])


@pytest.mark.parametrize("network", [n for n, _ in DENIED_V6], ids=str)
def test_every_refused_ipv6_range_inside_global_unicast_is_refused(
    network: ipaddress.IPv6Network,
) -> None:
    assert not address_allowed(network[0])
    assert not address_allowed(network[-1])


@pytest.mark.parametrize(
    "spelling",
    [
        "2130706433",  # 127.0.0.1 as a decimal
        "0x7f000001",  # hex
        "0x7f.0.0.1",
        "0177.0.0.1",  # octal
        "017700000001",
        "127.1",  # short form
        "127.0.1",
        "1.2.3",
        "::ffff:7f00:1 ",  # trailing space
        " 8.8.8.8",
        "8.8.8.8\n",
        "fe80::1%eth0",  # scope id
        "",
        "localhost",
        "8.8.8.08",  # a leading zero is ambiguous: refused, not interpreted
        "８.８.８.８",  # full-width digits
    ],
)
def test_only_canonical_address_text_is_parsed(spelling: str) -> None:
    """A resolver answer that is not canonical address text is refused, never "interpreted"."""
    assert parse_address(spelling) is None


def test_the_test_exception_is_narrow() -> None:
    loopback = ipaddress.ip_network("127.0.0.1/32")
    assert address_allowed(ipaddress.ip_address("127.0.0.1"), [loopback])
    assert not address_allowed(ipaddress.ip_address("127.0.0.2"), [loopback])
    assert not address_allowed(ipaddress.ip_address("10.0.0.1"), [loopback])
    assert not address_allowed(ipaddress.ip_address("::1"), [loopback])
    assert not address_allowed(ipaddress.ip_address("127.0.0.1"))
