"""The SSRF guard for outbound webhooks. A customer's address is untrusted: it must never lead our servers to talk to our own network, the cloud's metadata server, or anything private.

  check_url(url)           the address itself, no network: https only, a real host name (no IP literal, no user:password@, no localhost, no internal-looking name), port 443 or 1024 and up, at most 500 characters
  resolve_public(host)     the host's addresses; EVERY one must be a public address, otherwise the address is refused (a name that points at a private address is the classic bypass)
  is_public_ip(ip)         global addresses only: not private, loopback, link-local (169.254.169.254, the metadata server), multicast, reserved, unspecified, carrier-grade NAT (100.64/10),
                           and no IPv6 form that wraps an IPv4 one (mapped ::ffff:, NAT64 64:ff9b::, 6to4 2002::, Teredo 2001::/32), which are refused outright

The sender (sender.py) resolves ONCE, checks, and connects to that checked address (so a second, different DNS answer cannot be used), follows no redirect, and limits time and size."""

# ruff: noqa: E501

from __future__ import annotations

import ipaddress
import re
import socket
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_URL = 500
_HOST = re.compile(r"^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
_BAD_SUFFIXES = (".local", ".localhost", ".internal", ".intranet", ".corp", ".lan", ".home", ".localdomain", ".arpa")
_NOT_PUBLIC_V6 = tuple(ipaddress.ip_network(n) for n in ("64:ff9b::/96", "64:ff9b:1::/48", "2002::/16", "2001::/32", "::ffff:0:0/96", "fc00::/7", "fe80::/10"))

Resolver = Callable[[str, int], list[str]]


class UnsafeUrl(Exception):
    """The address is refused. `reason` is a closed word: length, scheme, userinfo, host, port, private, dns."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Target:
    host: str
    port: int
    path: str   # the path and query, always starting with /


def check_url(url: str) -> Target:
    if not isinstance(url, str) or not 12 <= len(url) <= MAX_URL or not url.isascii() or not url.isprintable() or " " in url:
        raise UnsafeUrl("length")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise UnsafeUrl("host") from None
    if parts.scheme != "https":
        raise UnsafeUrl("scheme")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise UnsafeUrl("userinfo")
    host = (parts.hostname or "").rstrip(".").lower()
    if not _HOST.fullmatch(host) or host == "localhost" or host.endswith(_BAD_SUFFIXES) or host in ("metadata.google.internal", "metadata"):
        raise UnsafeUrl("host")
    if not re.search(r"[a-z]", host.rsplit(".", 1)[1]):   # an IP address or a number in disguise (1.2.3.4, 2130706433.1): the last label of a real host has a letter
        raise UnsafeUrl("host")
    if port is not None and port != 443 and port < 1024:
        raise UnsafeUrl("port")
    if parts.fragment:
        raise UnsafeUrl("host")
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    return Target(host=host, port=port or 443, path=path)


def is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None or any(ip in net for net in _NOT_PUBLIC_V6):
            return False
    return ip.is_global and not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def system_resolver(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, OSError):
        return []
    seen: list[str] = []
    for info in infos:
        address = str(info[4][0])
        if address not in seen:
            seen.append(address)
    return seen


def resolve_public(host: str, port: int, resolver: Resolver = system_resolver) -> list[str]:
    """The addresses to connect to, all public. A name with no address: `dns`. Any non-public address among them: `private` (never connect to the others either)."""
    found = resolver(host, port)
    if not found:
        raise UnsafeUrl("dns")
    out: list[str] = []
    for raw in found:
        try:
            ip = ipaddress.ip_address(raw.split("%", 1)[0])
        except ValueError:
            raise UnsafeUrl("private") from None
        if not is_public_ip(ip):
            raise UnsafeUrl("private")
        out.append(str(ip))
    return out


def validate(url: str, resolver: Resolver = system_resolver) -> Target:
    """Registration time: the address is well formed and its name points only at public addresses."""
    target = check_url(url)
    resolve_public(target.host, target.port, resolver)
    return target
