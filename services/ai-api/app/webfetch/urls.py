"""URL rules for the fetcher: what may be asked for, in a single normal form.

Only http and https; only the allowed ports; no userinfo; the host must be a DNS NAME. An IP
address in ANY spelling (dotted, decimal, octal, hex, shortened, IPv6, bracketed) is refused as a
host: the agent starts from a business's website name, never from an address. A name is
normalised (IDNA to punycode, lower case, one trailing dot dropped) so that every later check
(scope, robots, rate limit, address) looks at the same string.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import quote, urljoin, urlsplit

from app.agents.web import FetchError

MAX_URL_LENGTH = 2048
DEFAULT_PORTS = {"http": 80, "https": 443}

# Raw input: refuse control characters, spaces, DEL, C1 controls and backslashes before any parser
# gets a chance to "helpfully" strip or reinterpret them; then (below) every other invisible,
# separator, format, private-use or unassigned character.
_FORBIDDEN_RAW = re.compile(r"[\x00-\x20\x7f-\x9f\\]")
_FORBIDDEN_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp", "Zs"})


def _has_forbidden(text: str) -> bool:
    return bool(_FORBIDDEN_RAW.search(text)) or any(
        unicodedata.category(ch) in _FORBIDDEN_CATEGORIES for ch in text
    )


_LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
# WHATWG: a host whose LAST label is numeric (digits or 0x hex) is an IPv4 address in some spelling.
_NUMERIC_LAST_LABEL = re.compile(r"^(0x[0-9a-f]*|[0-9]+)$")

# Names that are never public hosts. Refused before any DNS lookup (defence in depth: the address
# check is the authority). Single-label hosts are refused by `parse_target` itself.
BLOCKED_SUFFIXES = (
    "localhost",
    "local",
    "localdomain",
    "internal",  # includes metadata.google.internal
    "home.arpa",
    "lan",
    "intranet",
    "corp",
    "private",
    "test",
    "invalid",
    "example",
    "onion",
)
BLOCKED_NAMES = frozenset({"metadata", "metadata.goog"})


@dataclass(frozen=True)
class Target:
    scheme: str
    host: str  # normalised DNS name
    port: int
    path: str  # path and query, starting with "/"; never a fragment

    @property
    def origin(self) -> str:
        default = DEFAULT_PORTS[self.scheme]
        return f"{self.scheme}://{self.host}" + ("" if self.port == default else f":{self.port}")

    @property
    def url(self) -> str:
        return self.origin + self.path


def normalise_host(raw: str) -> str:
    """A DNS name in its one normal form, or `bad_host` / `ip_literal`."""
    if not raw or ":" in raw or raw.startswith("["):
        raise FetchError("ip_literal" if (":" in raw or raw.startswith("[")) else "bad_host")
    try:
        host = raw.encode("idna").decode("ascii")
    except UnicodeError:
        raise FetchError("bad_host") from None
    host = host.lower()
    if host.endswith("."):
        host = host[:-1]
    if not host or len(host) > 253:
        raise FetchError("bad_host")
    labels = host.split(".")
    if _NUMERIC_LAST_LABEL.match(labels[-1]):
        raise FetchError("ip_literal")
    if len(labels) < 2 or not all(_LABEL.match(label) for label in labels):
        raise FetchError("bad_host")
    return host


def blocked_name(host: str) -> bool:
    host = host.lower().rstrip(".")
    return host in BLOCKED_NAMES or any(
        host == suffix or host.endswith("." + suffix) for suffix in BLOCKED_SUFFIXES
    )


def parse_target(url: object, *, ports: frozenset[int] = frozenset({80, 443})) -> Target:
    if not isinstance(url, str) or not url or len(url) > MAX_URL_LENGTH:
        raise FetchError("bad_url")
    if _has_forbidden(url):
        raise FetchError("bad_url")
    try:
        parts = urlsplit(url)
    except ValueError:
        raise FetchError("bad_url") from None
    scheme = parts.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        raise FetchError("bad_scheme")
    netloc = parts.netloc
    if "@" in netloc:
        raise FetchError("userinfo")
    try:
        port = parts.port
        hostname = parts.hostname
    except ValueError:
        raise FetchError("bad_port") from None
    if hostname is None:
        raise FetchError("bad_host")
    if netloc.startswith("[") or ":" in hostname:
        raise FetchError("ip_literal")
    if port is None:
        port = DEFAULT_PORTS[scheme]
    if port not in ports:
        raise FetchError("bad_port")
    host = normalise_host(hostname)
    path = parts.path or "/"
    if not path.startswith("/"):
        raise FetchError("bad_url")
    path = quote(path, safe="/%:@!$&'()*+,;=-._~")
    if parts.query:
        path += "?" + quote(parts.query, safe="/%:@!$&'()*+,;=-._~?")
    return Target(scheme=scheme, host=host, port=port, path=path)


def resolve_location(base: Target, location: str) -> str:
    """The absolute URL a Location header points to (relative and protocol-relative forms included).
    The result is checked by `parse_target` like any other URL."""
    if _has_forbidden(location) or len(location) > MAX_URL_LENGTH:
        raise FetchError("bad_redirect")
    return urljoin(base.url, location)


def site_hosts(host: str) -> frozenset[str]:
    """A site's host and its `www.` twin: the hosts a research run may stay on."""
    bare = host[4:] if host.startswith("www.") else host
    return frozenset({bare, "www." + bare})
