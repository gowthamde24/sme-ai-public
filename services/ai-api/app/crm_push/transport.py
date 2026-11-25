"""The guarded client every adapter talks through: one request to a tool's address, with no way to reach anything but the public internet.

  - the address is checked (webhooks_out.ssrf.check_url: https only, a real host name, no IP literal, port 443 or 1024+), its name resolved ONCE and every answer must be public; the connection goes to that checked
    address (the Host header and the TLS name stay the host's, so the certificate is still checked)
  - NO redirect is followed (a 3xx is returned as it is; the Apps Script adapter knows its one documented 302)
  - time: 5 s to connect, 10 s to write and to read; size: the request body at most 256 KB, the answer's body at most 256 KB (more is cut: the answer is then not JSON and reads as bad_answer)
  - the result is a status and, when the answer is JSON, the parsed value; an error is a closed word. Nothing here logs an address, a header, a body or a key."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

from app.webhooks_out import ssrf
from app.webhooks_out.sender import CONNECT_S, IO_S, MAX_BODY, MAX_TRIES, _closed

logger = logging.getLogger("app.crm_push.transport")
MAX_ANSWER = 256 * 1024


@dataclass(frozen=True)
class Answer:
    status: int | None = None
    body: Any = None            # the parsed JSON answer, or None (no body, not JSON, or too big)
    error: str | None = None    # blocked | dns | too_large | timeout | refused | tls: the request did not complete
    location: str | None = None   # where a 3xx points (never followed here), for the one adapter that expects it; never logged

    @property
    def ok(self) -> bool:
        return self.error is None and self.status is not None and 200 <= self.status < 300


class Http(Protocol):
    def request(self, method: str, url: str, *, headers: dict[str, str] | None = None, json_body: Any = None, form: dict[str, str] | None = None, query: dict[str, str] | None = None) -> Answer: ...


class GuardedHttp:
    def __init__(self, *, resolver: ssrf.Resolver = ssrf.system_resolver, transport: httpx.BaseTransport | None = None) -> None:
        self._resolver = resolver
        self._transport = transport

    def __repr__(self) -> str:
        return "GuardedHttp()"

    def request(self, method: str, url: str, *, headers: dict[str, str] | None = None, json_body: Any = None, form: dict[str, str] | None = None, query: dict[str, str] | None = None) -> Answer:
        full = url + (("&" if "?" in url else "?") + urlencode(query)) if query else url
        content: bytes | None = None
        send = dict(headers or {})
        if json_body is not None:
            content = json.dumps(json_body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            send.setdefault("Content-Type", "application/json")
        elif form is not None:
            content = urlencode(form).encode("ascii")
            send.setdefault("Content-Type", "application/x-www-form-urlencoded")
        if content is not None and len(content) > MAX_BODY:
            return Answer(error="too_large")
        send.setdefault("Accept", "application/json")
        send["User-Agent"] = "Stack19-Connectors/1"
        try:
            target = ssrf.check_url(full)
            addresses = ssrf.resolve_public(target.host, target.port, self._resolver)
        except ssrf.UnsafeUrl as exc:
            return Answer(error="dns" if exc.reason == "dns" else "blocked")
        host_header = target.host if target.port == 443 else f"{target.host}:{target.port}"
        last = Answer(error="refused")
        for address in addresses[:MAX_TRIES]:
            netloc = f"[{address}]" if ":" in address else address
            request_url = f"https://{netloc}:{target.port}{target.path}"
            try:
                with httpx.Client(transport=self._transport, timeout=httpx.Timeout(IO_S, connect=CONNECT_S), follow_redirects=False, trust_env=False, verify=True) as client:
                    request = client.build_request(method, request_url, content=content, headers={**send, "Host": host_header}, extensions={"sni_hostname": target.host})
                    response = client.send(request, stream=True)
                    try:
                        raw = b""
                        for chunk in response.iter_bytes():
                            raw += chunk
                            if len(raw) > MAX_ANSWER:
                                raw = b""
                                break
                        status = response.status_code
                        location = response.headers.get("location")
                    finally:
                        response.close()
            except httpx.HTTPError as exc:
                last = Answer(error=_closed(exc))
                continue
            parsed: Any = None
            if raw:
                try:
                    parsed = json.loads(raw)
                except ValueError:
                    parsed = None
            return Answer(status=status, body=parsed, location=location if location and 300 <= status < 400 else None)
        logger.info("crm push request failed: %s", last.error)
        return last
