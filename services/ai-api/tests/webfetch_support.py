"""Helpers for the fetcher tests: a local HTTP(S) server, a resolver stub and a test CA."""

# ruff: noqa: S104, S105

from __future__ import annotations

import datetime
import ipaddress
import socket
import ssl
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.webfetch.fetcher import FetchConfig, SafeFetcher
from app.webfetch.netguard import Network

LOOPBACK = ipaddress.ip_network("127.0.0.1/32")
Route = Callable[[BaseHTTPRequestHandler], None]


class Seen:
    """What the server saw: every request, with its headers."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, str]]] = []

    def paths(self) -> list[str]:
        return [path for path, _ in self.requests]

    def count(self, path: str) -> int:
        return sum(1 for p in self.paths() if p == path)


class LocalServer:
    """A threaded HTTP server on 127.0.0.1 with routes set by the test. `stop` also releases any
    handler that is deliberately dragging its feet."""

    def __init__(self, *, tls: tuple[Path, Path] | None = None) -> None:
        self.routes: dict[str, Route] = {}
        self.seen = Seen()
        self.stopping = threading.Event()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return

            def do_GET(self) -> None:
                path = self.path.split("?")[0]
                outer.seen.requests.append(
                    (self.path, {k.lower(): v for k, v in self.headers.items()})
                )
                route = outer.routes.get(path)
                if route is None:
                    send(self, 404, b"not found", "text/plain")
                else:
                    route(self)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        if tls is not None:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(tls[0]), str(tls[1]))
            self.httpd.socket = context.wrap_socket(self.httpd.socket, server_side=True)
        self.port: int = self.httpd.server_address[1]
        self.thread = threading.Thread(
            target=lambda: self.httpd.serve_forever(poll_interval=0.02), daemon=True
        )
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        self.httpd.shutdown()
        self.httpd.server_close()

    def route(
        self,
        path: str,
        status: int = 200,
        body: bytes | str = b"",
        ctype: str = "text/html",
        **headers: str,
    ) -> None:
        data = body.encode() if isinstance(body, str) else body
        self.routes[path] = lambda h: send(h, status, data, ctype, **headers)


def send(
    handler: BaseHTTPRequestHandler,
    status: int,
    body: bytes,
    ctype: str | None = "text/html",
    **headers: str,
) -> None:
    handler.send_response(status)
    if ctype is not None:
        handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Connection", "close")
    for name, value in headers.items():
        handler.send_header(name.replace("_", "-"), value)
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except OSError:
        pass


class Resolver:
    """A resolver stub: names map to a list of answers, or to a list of lists (one per call)."""

    def __init__(self, table: dict[str, list[str] | list[list[str]]]) -> None:
        self.table = table
        self.calls: list[str] = []

    def __call__(self, host: str, port: int) -> list[str]:
        self.calls.append(host)
        answer = self.table.get(host)
        if answer is None:
            raise OSError("no such host")
        if answer and isinstance(answer[0], list):
            index = min(self.calls.count(host) - 1, len(answer) - 1)
            return answer[index]
        return answer  # type: ignore[return-value]


def self_signed(directory: Path, host: str) -> tuple[Path, Path]:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(hours=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path, key_path = directory / f"{host}.crt", directory / f"{host}.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return cert_path, key_path


class Clock:
    """A fake clock whose sleep advances it, so rate-limit tests do not wait."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds

    def advance(self, seconds: float) -> None:
        self.now += seconds


def local_fetcher(
    server: LocalServer,
    *,
    names: tuple[str, ...] = ("site.example.net",),
    clock: Clock | None = None,
    extra_resolver: dict[str, list[str] | list[list[str]]] | None = None,
    allow: tuple[Network, ...] = (LOOPBACK,),
    ssl_context: ssl.SSLContext | None = None,
    socket_factory: Callable[[str, int, float], socket.socket] | None = None,
    **config: Any,
) -> tuple[SafeFetcher, Resolver]:
    table: dict[str, list[str] | list[list[str]]] = {name: ["127.0.0.1"] for name in names}
    table.update(extra_resolver or {})
    resolver = Resolver(table)
    clock = clock or Clock()
    settings = {"min_interval": 0.0, "total_timeout": 5.0, **config}
    cfg = FetchConfig(
        ports=frozenset({80, 443, server.port}),
        test_allowed_networks=allow,
        ssl_context=ssl_context,
        **settings,
    )
    fetcher = SafeFetcher(
        cfg,
        resolver=resolver,
        socket_factory=socket_factory,
        clock=clock,
        sleep=clock.sleep,
        wall=clock,
    )
    return fetcher, resolver


def url(
    server: LocalServer, path: str = "/", host: str = "site.example.net", scheme: str = "http"
) -> str:
    return f"{scheme}://{host}:{server.port}{path}"


def wait_until(predicate: Callable[[], bool], seconds: float = 2.0) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()
