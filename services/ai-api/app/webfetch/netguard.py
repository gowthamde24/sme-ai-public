"""Which addresses the fetcher may connect to: global unicast only, everything else refused.

The decision is made on the address actually resolved (and again on the address actually
connected to), never on the name. IPv4: an explicit list of refused ranges. IPv6: only
`2000::/3` (global unicast) is allowed, minus a few ranges inside it. That one rule refuses
`::1`, `::`, unique-local, link-local, multicast, IPv4-mapped, NAT64 and everything not yet
assigned, without a per-class list that could be forgotten.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Iterable

IPv4Net = ipaddress.IPv4Network
IPv6Net = ipaddress.IPv6Network
Address = ipaddress.IPv4Address | ipaddress.IPv6Address
Network = ipaddress.IPv4Network | ipaddress.IPv6Network

# (network, why). The comment is the vector class the tests name.
DENIED_V4: tuple[tuple[IPv4Net, str], ...] = (
    (IPv4Net("0.0.0.0/8"), "unspecified / this network"),
    (IPv4Net("10.0.0.0/8"), "private"),
    (IPv4Net("100.64.0.0/10"), "carrier-grade NAT"),
    (IPv4Net("127.0.0.0/8"), "loopback"),
    (IPv4Net("169.254.0.0/16"), "link-local, including the cloud metadata address 169.254.169.254"),
    (IPv4Net("172.16.0.0/12"), "private"),
    (IPv4Net("192.0.0.0/24"), "IETF protocol assignments"),
    (IPv4Net("192.0.2.0/24"), "documentation"),
    (IPv4Net("192.88.99.0/24"), "6to4 relay"),
    (IPv4Net("192.168.0.0/16"), "private"),
    (IPv4Net("198.18.0.0/15"), "benchmarking"),
    (IPv4Net("198.51.100.0/24"), "documentation"),
    (IPv4Net("203.0.113.0/24"), "documentation"),
    (IPv4Net("224.0.0.0/4"), "multicast"),
    (IPv4Net("240.0.0.0/4"), "reserved, including the broadcast address"),
)

ALLOWED_V6 = IPv6Net("2000::/3")
DENIED_V6: tuple[tuple[IPv6Net, str], ...] = (
    (IPv6Net("2001::/23"), "IETF protocol assignments, including Teredo"),
    (IPv6Net("2001:db8::/32"), "documentation"),
    (IPv6Net("2002::/16"), "6to4 (embeds an IPv4 address)"),
    (IPv6Net("3fff::/20"), "documentation"),
)


def parse_address(text: str) -> Address | None:
    """A resolved address as text, in canonical form only. Anything else (a decimal, octal or hex
    spelling, a scope id, surrounding space) is None: refused, never "interpreted"."""
    if "%" in text:  # an IPv6 scope id: not a global address, never accepted
        return None
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def address_allowed(address: Address, extra_allowed: Iterable[Network] = ()) -> bool:
    """May the fetcher connect to `address`? `extra_allowed` exists for tests (a local server on
    127.0.0.1); production never passes it."""
    for network in extra_allowed:
        if address.version == network.version and address in network:
            return True
    if isinstance(address, ipaddress.IPv4Address):
        return not any(address in network for network, _ in DENIED_V4)
    if address not in ALLOWED_V6:
        return False
    return not any(address in network for network, _ in DENIED_V6)
