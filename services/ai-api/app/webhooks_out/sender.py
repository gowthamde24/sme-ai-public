"""The guarded sender: one POST to a customer's address, with no way to reach anything but the public internet.

  - the address is checked (ssrf.check_url), its name resolved ONCE and every answer must be a public address (ssrf.resolve_public); the connection goes to that checked address (the Host header and the
    TLS name stay the customer's host name, so the certificate is still checked), so a second DNS answer cannot redirect it
  - NO redirect is followed: a 3xx is a failure ("redirect")
  - time: 5 seconds to connect, 10 to write and to wait for the answer; size: the body is at most 256 KB (the runner trims it) and the answer's body is never read (headers only)
  - the result is a closed word, never the other side's text, status line or headers; nothing here logs the address or the body"""

# ruff: noqa: E501

from __future__ import annotations

import logging
import ssl
from dataclasses import dataclass

import httpx

from app.webhooks_out import ssrf

logger = logging.getLogger("app.webhooks_out.sender")

MAX_BODY = 256 * 1024
CONNECT_S = 5.0
IO_S = 10.0
MAX_TRIES = 3   # addresses tried for one delivery


@dataclass(frozen=True)
class SendResult:
    ok: bool
    status: int | None = None
    error: str | None = None   # timeout | refused | tls | status | redirect | blocked | dns | too_large


def _closed(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    cause = exc.__cause__ or exc.__context__
    if isinstance(cause, ssl.SSLError) or "CERTIFICATE" in str(exc).upper() or "SSL" in str(exc).upper():
        return "tls"
    return "refused"


class Sender:
    def __init__(self, *, resolver: ssrf.Resolver = ssrf.system_resolver, transport: httpx.BaseTransport | None = None) -> None:
        self._resolver = resolver
        self._transport = transport

    def post(self, url: str, body: bytes, headers: dict[str, str]) -> SendResult:
        if len(body) > MAX_BODY:
            return SendResult(False, None, "too_large")
        try:
            target = ssrf.check_url(url)
            addresses = ssrf.resolve_public(target.host, target.port, self._resolver)
        except ssrf.UnsafeUrl as exc:
            return SendResult(False, None, "dns" if exc.reason == "dns" else "blocked")
        host_header = target.host if target.port == 443 else f"{target.host}:{target.port}"
        last = SendResult(False, None, "refused")
        for address in addresses[:MAX_TRIES]:
            netloc = f"[{address}]" if ":" in address else address
            request_url = f"https://{netloc}:{target.port}{target.path}"
            try:
                with httpx.Client(transport=self._transport, timeout=httpx.Timeout(IO_S, connect=CONNECT_S), follow_redirects=False, trust_env=False, verify=True) as client:
                    request = client.build_request("POST", request_url, content=body, headers={**headers, "Host": host_header}, extensions={"sni_hostname": target.host})
                    response = client.send(request, stream=True)
                    try:
                        code = response.status_code
                    finally:
                        response.close()
            except httpx.HTTPError as exc:
                last = SendResult(False, None, _closed(exc))
                continue
            if 200 <= code < 300:
                return SendResult(True, code, None)
            if 300 <= code < 400:
                return SendResult(False, code, "redirect")
            return SendResult(False, code, "status")
        logger.info("webhook delivery failed: %s", last.error)
        return last
