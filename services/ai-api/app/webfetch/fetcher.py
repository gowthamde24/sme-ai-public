"""The real page fetcher (T007 M1): a security boundary between the application and the open web.

What is enforced, in the order a request meets it:
  1. URL: http/https only, ports 80/443 only, no userinfo, a DNS name only (no IP in any spelling),
     one normal form (`urls.py`); names that are never public are refused before any lookup.
  2. Scope: with `allowed_hosts`, the first URL and every redirect hop must be on those hosts.
  3. robots.txt: fetched through THIS SAME PATH (so it is guarded too) and obeyed; a site that
     cannot be asked is not read.
  4. Rate: spacing per host (and the site's crawl delay) and a daily page cap per host.
  5. Address: the name is resolved ONCE, every answer must be a public address (`netguard.py`), and
     the connection goes to that pinned address (no second lookup: DNS rebinding changes nothing).
     After connecting, the PEER address is read back and checked again.
  6. TLS: certificates are verified against the NAME, never the address.
  7. A total wall-clock deadline (a watchdog closes the socket), so a slow-drip server cannot hold
     a worker; size caps on the DECODED body; content-type allowlist; only gzip/deflate bodies,
     decoded with a hard output limit (a gzip bomb stops at the cap).
  8. No cookies, no credentials, no referrer, no scripts: a plain GET, redirects followed by hand
     and each hop checked from step 1.
The page text that comes back is already sanitised (`sanitize.py`).
"""

from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
import threading
import time
import zlib
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from app.agents.web import FetchedPage, FetchError
from app.webfetch.limits import Deadline, HostLimiter
from app.webfetch.netguard import Address, Network, address_allowed, parse_address
from app.webfetch.robots import (
    ALLOW_ALL,
    ALLOW_CACHE_SECONDS,
    DENY_ALL,
    DENY_CACHE_SECONDS,
    RobotsRules,
    parse_robots,
)
from app.webfetch.sanitize import sanitize_html, sanitize_plain
from app.webfetch.urls import Target, blocked_name, parse_target, resolve_location

USER_AGENT = "SmeAiResearchBot/0.1 (research crawler; local development; no contact URL yet)"
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})
ALLOWED_CONTENT_TYPES = HTML_TYPES | {"text/plain"}
_CHARSET = re.compile(r"charset\s*=\s*\"?([A-Za-z0-9_.:\-]+)", re.IGNORECASE)
_CHUNK = 16384

Resolver = Callable[[str, int], list[str]]
SocketFactory = Callable[[str, int, float], socket.socket]


@dataclass(frozen=True)
class FetchConfig:
    """Limits. The defaults are the production values. `test_allowed_networks` and a wider `ports`
    exist so a test can talk to a server on 127.0.0.1; production code never sets them."""

    ports: frozenset[int] = frozenset({80, 443})
    test_allowed_networks: tuple[Network, ...] = ()
    total_timeout: float = 10.0
    max_redirects: int = 3
    max_body_bytes: int = 1_000_000
    max_robots_bytes: int = 256_000
    max_text_chars: int = 8000
    min_interval: float = 2.0
    daily_cap: int = 20
    max_crawl_delay: float = 10.0
    # DNS lookups cannot be cancelled once started: a name server that never answers would leak
    # one thread per request. At most this many lookups exist at once (a stuck one keeps its slot
    # until it ends); more are refused.
    max_dns_lookups: int = 4
    user_agent: str = USER_AGENT
    ssl_context: ssl.SSLContext | None = field(default=None, compare=False)


@dataclass
class _Hop:
    status: int
    location: str
    content_type: str
    charset: str
    body: bytes


def _system_resolver(host: str, port: int) -> list[str]:
    return [str(info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]


def _system_socket_factory(ip: str, port: int, timeout: float) -> socket.socket:
    return socket.create_connection((ip, port), timeout=timeout)


class _Watchdog:
    """Closes the socket when the total deadline passes, which wakes any blocked read."""

    def __init__(self, seconds: float) -> None:
        self.expired = False
        self._sock: socket.socket | None = None
        self._lock = threading.Lock()
        self._timer = threading.Timer(seconds, self._fire)
        self._timer.daemon = True
        self._timer.start()

    def attach(self, sock: socket.socket) -> None:
        with self._lock:
            self._sock = sock
            if self.expired:
                self._kill(sock)

    def _fire(self) -> None:
        with self._lock:
            self.expired = True
            if self._sock is not None:
                self._kill(self._sock)

    @staticmethod
    def _kill(sock: socket.socket) -> None:
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass

    def cancel(self) -> None:
        self._timer.cancel()


class _BoundedResolver:
    """DNS lookups on a fixed pool of threads with a hard cap on how many can be in flight.

    `getaddrinfo` cannot be interrupted, so a caller that gives up (its deadline passed) leaves
    the lookup running. The old code started a fresh single-thread pool per lookup, so a name
    server that never answers made the process grow one stuck thread per request, without limit.
    Here the number of threads is fixed, a slot is released only when the LOOKUP itself finishes
    (not when the caller stops waiting), and a lookup that finds no free slot is refused at once
    (`resolver_busy`) instead of queueing."""

    def __init__(self, resolver: Resolver, slots: int) -> None:
        if slots < 1:
            raise ValueError("at least one DNS lookup slot is required")
        self._resolver = resolver
        self._slots = threading.BoundedSemaphore(slots)
        self._pool = ThreadPoolExecutor(max_workers=slots, thread_name_prefix="dns")

    def lookup(self, host: str, port: int, deadline: Deadline) -> list[str]:
        if not self._slots.acquire(blocking=False):
            raise FetchError("resolver_busy")
        try:
            future = self._pool.submit(self._resolver, host, port)
        except RuntimeError:
            self._slots.release()
            raise FetchError("resolver_busy") from None
        future.add_done_callback(lambda _f: self._slots.release())
        try:
            return future.result(timeout=deadline.remaining())
        except TimeoutError:
            raise FetchError("timeout") from None
        except FetchError:
            raise
        except Exception:  # noqa: BLE001  (any resolver failure is one constant code)
            raise FetchError("resolve_failed") from None


class SafeFetcher:
    def __init__(
        self,
        config: FetchConfig | None = None,
        *,
        resolver: Resolver | None = None,
        socket_factory: SocketFactory | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._cfg = config or FetchConfig()
        self._resolver = resolver or _system_resolver
        self._dns = _BoundedResolver(self._resolver, self._cfg.max_dns_lookups)
        self._socket_factory = socket_factory or _system_socket_factory
        self._clock = clock
        self._limiter = HostLimiter(
            min_interval=self._cfg.min_interval,
            daily_cap=self._cfg.daily_cap,
            clock=clock,
            sleep=sleep,
            wall=wall,
        )
        self._robots: dict[str, tuple[float, RobotsRules]] = {}
        self._ssl = self._cfg.ssl_context or ssl.create_default_context()

    # ------------------------------------------------------------------ public

    def fetch(self, url: str, *, allowed_hosts: frozenset[str] | None = None) -> FetchedPage:
        deadline = Deadline(self._cfg.total_timeout)
        target, hop = self._follow(url, deadline, allowed_hosts, page=True)
        if hop.status != 200:
            raise FetchError("http_status", hop.status)
        self._limiter.record_page(target.host)
        text = hop.body.decode(_charset(hop.charset), errors="replace")
        if hop.content_type in HTML_TYPES:
            result = sanitize_html(text, max_chars=self._cfg.max_text_chars)
        else:
            result = sanitize_plain(text, max_chars=self._cfg.max_text_chars)
        return FetchedPage(
            final_url=target.url,
            status=hop.status,
            content_type=hop.content_type,
            text=result.text,
            truncated=result.truncated,
            body_bytes=len(hop.body),
            hidden_elements=result.hidden_elements,
        )

    # ------------------------------------------------------------------ redirects, scope, robots

    def _follow(
        self,
        url: str,
        deadline: Deadline,
        allowed_hosts: frozenset[str] | None,
        *,
        page: bool,
    ) -> tuple[Target, _Hop]:
        hops = 0
        current = url
        while True:
            target = parse_target(current, ports=self._cfg.ports)
            if blocked_name(target.host):
                raise FetchError("blocked_name")
            if allowed_hosts is not None and target.host not in allowed_hosts:
                raise FetchError("off_host")
            delay = 0.0
            if page:
                rules = self._rules_for(target, deadline, allowed_hosts)
                if rules.unavailable:
                    raise FetchError("robots_unavailable")
                if not rules.allows(target.path):
                    raise FetchError("robots_disallowed")
                delay = rules.crawl_delay()
                if delay > self._cfg.max_crawl_delay:
                    raise FetchError("robots_crawl_delay")
                self._limiter.check_daily(target.host)
            hop = self._hop(target, deadline, robots=not page, extra_delay=delay)
            if hop.status not in REDIRECT_STATUSES:
                return target, hop
            hops += 1
            if hops > self._cfg.max_redirects:
                raise FetchError("too_many_redirects")
            if not hop.location:
                raise FetchError("bad_redirect")
            current = resolve_location(target, hop.location)
            if target.scheme == "https" and urlsplit(current).scheme.lower() == "http":
                raise FetchError("redirect_downgrade")

    def _rules_for(
        self, target: Target, deadline: Deadline, allowed_hosts: frozenset[str] | None
    ) -> RobotsRules:
        cached = self._robots.get(target.origin)
        if cached is not None and self._clock() < cached[0]:
            return cached[1]
        rules, ttl = self._load_robots(target, deadline, allowed_hosts)
        self._robots[target.origin] = (self._clock() + ttl, rules)
        return rules

    def _load_robots(
        self, target: Target, deadline: Deadline, allowed_hosts: frozenset[str] | None
    ) -> tuple[RobotsRules, float]:
        try:
            _, hop = self._follow(
                target.origin + "/robots.txt", deadline, allowed_hosts, page=False
            )
        except FetchError as error:
            if error.code == "timeout":
                raise
            return DENY_ALL, DENY_CACHE_SECONDS
        if hop.status == 200:
            return parse_robots(hop.body.decode(_charset(hop.charset), errors="replace")), (
                ALLOW_CACHE_SECONDS
            )
        if hop.status in (404, 410):
            return ALLOW_ALL, ALLOW_CACHE_SECONDS
        return DENY_ALL, DENY_CACHE_SECONDS

    # ------------------------------------------------------------------ one request

    def _resolve_and_pin(self, host: str, port: int, deadline: Deadline) -> Address:
        answers = self._dns.lookup(host, port, deadline)
        if not answers:
            raise FetchError("resolve_failed")
        addresses: list[Address] = []
        for text in answers:
            address = parse_address(text)
            if address is None or not address_allowed(address, self._cfg.test_allowed_networks):
                raise FetchError("blocked_address")  # one bad answer refuses the whole name
            addresses.append(address)
        return next((a for a in addresses if a.version == 4), addresses[0])

    def _check_peer(self, sock: socket.socket, pinned: Address) -> None:
        try:
            peer = parse_address(str(sock.getpeername()[0]))
        except OSError:
            raise FetchError("peer_mismatch") from None
        if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped is not None:
            peer = peer.ipv4_mapped
        if peer is None or peer != pinned:
            raise FetchError("peer_mismatch")
        if not address_allowed(peer, self._cfg.test_allowed_networks):
            raise FetchError("peer_mismatch")

    def _hop(self, target: Target, deadline: Deadline, *, robots: bool, extra_delay: float) -> _Hop:
        self._limiter.acquire(target.host, deadline, extra_delay=extra_delay)
        pinned = self._resolve_and_pin(target.host, target.port, deadline)
        watchdog = _Watchdog(deadline.remaining())
        sock: socket.socket | None = None
        try:
            try:
                sock = self._socket_factory(str(pinned), target.port, deadline.remaining())
            except TimeoutError:
                raise FetchError("timeout") from None
            except OSError:
                raise FetchError("connect_failed") from None
            watchdog.attach(sock)
            self._check_peer(sock, pinned)
            if target.scheme == "https":
                try:
                    sock.settimeout(deadline.remaining())
                    sock = self._ssl.wrap_socket(sock, server_hostname=target.host)
                except (ssl.SSLError, ssl.CertificateError):
                    raise FetchError("tls_failed") from None
                watchdog.attach(sock)
            sock.settimeout(deadline.remaining())
            return self._exchange(sock, target, deadline, robots=robots)
        except FetchError as error:
            if (watchdog.expired or deadline.exceeded()) and error.code != "timeout":
                raise FetchError("timeout") from None
            raise
        except TimeoutError:
            raise FetchError("timeout") from None
        except (OSError, http.client.HTTPException, ValueError, zlib.error):
            late = watchdog.expired or deadline.exceeded()
            raise FetchError("timeout" if late else "bad_response") from None
        finally:
            watchdog.cancel()
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass

    def _exchange(
        self, sock: socket.socket, target: Target, deadline: Deadline, *, robots: bool
    ) -> _Hop:
        conn = http.client.HTTPConnection(target.host, target.port)
        conn.sock = sock  # our pinned, checked socket: http.client never opens one itself
        default_port = 443 if target.scheme == "https" else 80
        host_header = target.host if target.port == default_port else f"{target.host}:{target.port}"
        conn.putrequest("GET", target.path, skip_host=True, skip_accept_encoding=True)
        for name, value in (
            ("Host", host_header),
            ("User-Agent", self._cfg.user_agent),
            ("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9"),
            ("Accept-Encoding", "gzip, deflate"),
            ("Connection", "close"),
        ):
            conn.putheader(name, value)
        conn.endheaders()
        response = conn.getresponse()
        status = response.status
        location = response.getheader("Location") or ""
        if status in REDIRECT_STATUSES or status != 200:
            return _Hop(status, location, "", "", b"")
        raw_type = response.getheader("Content-Type") or ""
        content_type = raw_type.split(";")[0].strip().lower()
        if not robots and content_type not in ALLOWED_CONTENT_TYPES:
            raise FetchError("unsupported_content_type")
        charset_match = _CHARSET.search(raw_type)
        cap = self._cfg.max_robots_bytes if robots else self._cfg.max_body_bytes
        encoding = (response.getheader("Content-Encoding") or "").strip().lower()
        declared = response.getheader("Content-Length") or ""
        if declared.isdigit() and int(declared) > cap:
            raise FetchError("too_large")
        body = self._read_body(response, encoding, cap, deadline)
        return _Hop(
            status, location, content_type, charset_match.group(1) if charset_match else "", body
        )

    @staticmethod
    def _read_body(
        response: http.client.HTTPResponse, encoding: str, cap: int, deadline: Deadline
    ) -> bytes:
        decoder: zlib._Decompress | None = None
        if encoding in ("", "identity"):
            decoder = None
        elif encoding in ("gzip", "x-gzip", "deflate"):
            pass  # chosen on the first chunk
        else:
            raise FetchError("unsupported_encoding")
        out = bytearray()
        raw_total = 0
        first = True
        while True:
            deadline.remaining()
            chunk = response.read(_CHUNK)
            if not chunk:
                break
            raw_total += len(chunk)
            if raw_total > cap:
                raise FetchError("too_large")
            if encoding in ("", "identity"):
                out += chunk
                if len(out) > cap:
                    raise FetchError("too_large")
                continue
            if first:
                first = False
                if encoding == "deflate":
                    zlib_wrapped = (
                        (chunk[0] & 0x0F) == 8
                        and len(chunk) > 1
                        and ((chunk[0] << 8) + chunk[1]) % 31 == 0
                    )
                    decoder = zlib.decompressobj(
                        zlib.MAX_WBITS if zlib_wrapped else -zlib.MAX_WBITS
                    )
                else:
                    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
            assert decoder is not None  # noqa: S101
            data = chunk
            while data and not decoder.eof:
                produced = decoder.decompress(data, cap - len(out) + 1)
                out += produced
                if len(out) > cap:
                    raise FetchError("too_large")
                if not produced and decoder.unconsumed_tail == data:
                    break  # no progress: a malformed stream, not a reason to spin
                data = decoder.unconsumed_tail
            if decoder.eof:
                break
        if decoder is not None and not decoder.eof:
            raise FetchError("bad_response")
        return bytes(out)


def _charset(name: str) -> str:
    if not name:
        return "utf-8"
    try:
        "".encode(name)
    except LookupError:
        return "utf-8"
    return name


def make_default_fetcher() -> SafeFetcher:
    """The production fetcher: strict defaults, the system resolver, real sockets."""
    return SafeFetcher()
