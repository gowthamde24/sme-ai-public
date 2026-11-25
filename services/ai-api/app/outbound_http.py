"""One guarded HTTP client for the connectors that talk to a store, a chat app or a calendar (commerce, notifications, calendars): the same rules as the outbound webhooks' sender (webhooks_out/sender.py),
with an answer that can be read.

  - the address is checked (ssrf.check_url: https only, a real host name, no IP number, no user:password@, port 443 or 1024 and up) and the name is resolved ONCE; every answer must be a public address
  - the connection goes to that checked address (the Host header and the TLS name stay the host's name, so the certificate is still checked): a second DNS answer cannot redirect it
  - NO redirect is followed (a 3xx is a failure, "redirect"); 5 seconds to connect, 10 to read; the answer's body is read up to MAX_READ bytes and only when it is JSON
  - `allowed_host` (optional) pins the call to one vendor's names (for example hooks.slack.com): a customer-typed address that points elsewhere is refused before anything is resolved
  - the result is a closed word, never the other side's text, status line or headers; nothing here logs an address, a header or a body

The tests give it a fake resolver and an httpx MockTransport: no test reaches the network."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import ssl
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from app.webhooks_out import ssrf

logger = logging.getLogger("app.outbound_http")

MAX_BODY = 256 * 1024     # what we send
MAX_READ = 1024 * 1024    # what we read back
CONNECT_S = 5.0
IO_S = 10.0
MAX_TRIES = 3             # addresses tried for one call


@dataclass(frozen=True)
class HttpResult:
    ok: bool
    status: int | None = None
    data: Any = None                  # the parsed JSON answer (a dict or a list), or None
    error: str | None = None          # timeout | refused | tls | status | redirect | blocked | dns | too_large | not_json | host
    retry_after_s: int | None = None  # the other side's Retry-After (seconds), when it sent one on a 429 or 503


def _closed(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    cause = exc.__cause__ or exc.__context__
    if isinstance(cause, ssl.SSLError) or "CERTIFICATE" in str(exc).upper() or "SSL" in str(exc).upper():
        return "tls"
    return "refused"


def _retry_after(response: httpx.Response) -> int | None:
    raw = response.headers.get("retry-after", "")
    return min(int(raw), 3600) if raw.isdigit() else None


class GuardedHttp:
    def __init__(self, *, resolver: ssrf.Resolver = ssrf.system_resolver, transport: httpx.BaseTransport | None = None) -> None:
        self._resolver = resolver
        self._transport = transport

    def request(self, method: str, url: str, *, headers: dict[str, str] | None = None, json_body: Any = None, form: dict[str, str] | None = None,
                allowed_host: Callable[[str], bool] | None = None) -> HttpResult:
        content: bytes | None = None
        send_headers = {"User-Agent": "Stack19-Connectors/1", "Accept": "application/json", **(headers or {})}
        if json_body is not None:
            content = json.dumps(json_body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            send_headers["Content-Type"] = "application/json"
        elif form is not None:
            content = "&".join(f"{_q(k)}={_q(v)}" for k, v in form.items()).encode("ascii")
            send_headers["Content-Type"] = "application/x-www-form-urlencoded"
        if content is not None and len(content) > MAX_BODY:
            return HttpResult(False, None, None, "too_large")
        try:
            target = ssrf.check_url(url)
        except ssrf.UnsafeUrl:
            return HttpResult(False, None, None, "blocked")
        if allowed_host is not None and not allowed_host(target.host):
            return HttpResult(False, None, None, "host")
        try:
            addresses = ssrf.resolve_public(target.host, target.port, self._resolver)
        except ssrf.UnsafeUrl as exc:
            return HttpResult(False, None, None, "dns" if exc.reason == "dns" else "blocked")
        host_header = target.host if target.port == 443 else f"{target.host}:{target.port}"
        last = HttpResult(False, None, None, "refused")
        for address in addresses[:MAX_TRIES]:
            netloc = f"[{address}]" if ":" in address else address
            request_url = f"https://{netloc}:{target.port}{target.path}"
            try:
                with httpx.Client(transport=self._transport, timeout=httpx.Timeout(IO_S, connect=CONNECT_S), follow_redirects=False, trust_env=False, verify=True) as client:
                    request = client.build_request(method, request_url, content=content, headers={**send_headers, "Host": host_header}, extensions={"sni_hostname": target.host})
                    response = client.send(request, stream=True)
                    try:
                        code = response.status_code
                        if 300 <= code < 400:
                            return HttpResult(False, code, None, "redirect")
                        body = b""
                        if code < 300 or code in (400, 401, 403, 404, 422, 429):
                            for chunk in response.iter_bytes():
                                body += chunk
                                if len(body) > MAX_READ:
                                    return HttpResult(False, code, None, "too_large")
                        retry = _retry_after(response)
                    finally:
                        response.close()
            except httpx.HTTPError as exc:
                last = HttpResult(False, None, None, _closed(exc))
                continue
            data: Any = None
            if body:
                try:
                    data = json.loads(body)
                except ValueError:
                    data = None
            if 200 <= code < 300:
                return HttpResult(True, code, data, None if (data is not None or not body) else "not_json")
            return HttpResult(False, code, None, "status", retry)
        logger.info("outbound call failed: %s", last.error)
        return last

    def get(self, url: str, **kw: Any) -> HttpResult:
        return self.request("GET", url, **kw)

    def post(self, url: str, **kw: Any) -> HttpResult:
        return self.request("POST", url, **kw)


def _q(value: str) -> str:
    from urllib.parse import quote

    return quote(str(value), safe="")
