"""Plivo's request signature, V3 (job 3 phase A). Every request Plivo makes to us (answer, hangup, stream status) carries

  X-Plivo-Signature-V3         base64( HMAC-SHA256( auth token, <base string> + "." + nonce ) )   (several, separated by commas, while a token is being rotated)
  X-Plivo-Signature-V3-Nonce   the nonce

where the base string is built exactly as Plivo's own SDK builds it (plivo/utils/signature_v3.py, read 10 Nov 2026): the URL without its query; then "?" and the sorted query as key=value pairs joined by "&" when there is a
query, or when a POST has form fields; for a POST with fields "." is added after a non-empty query; then the form fields sorted by key as key+value text. Written here (about 40 lines) rather than adding Plivo's whole SDK as a
dependency. The test vectors in tests/test_pl_signature.py were produced by the SDK itself. The token is the one of the account that owns the Application: the main account's, or a subaccount's."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit


def _sorted_query(params: dict[str, Any]) -> str:
    out: list[str] = []
    for key in sorted(params):
        value = params[key]
        if isinstance(value, list):
            out.append("&".join(f"{key}={v}" for v in sorted(str(x) for x in value)))
        else:
            out.append(f"{key}={value}")
    return "&".join(out)


def _sorted_fields(params: dict[str, Any]) -> str:
    out: list[str] = []
    for key in sorted(params):
        value = params[key]
        if isinstance(value, list):
            out.append("".join(f"{key}{v}" for v in sorted(str(x) for x in value)))
        elif isinstance(value, dict):
            out.append(f"{key}{_sorted_fields(value)}")
        else:
            out.append(f"{key}{value}")
    return "".join(out)


def _base_with_query(url: str, empty_post_params: bool) -> str:
    parts = urlsplit(url)
    base = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    query = _sorted_query(parse_qs(parts.query, keep_blank_values=True))
    if query or not empty_post_params:
        base += "?" + query
    if query and not empty_post_params:
        base += "."
    return base


def base_string(method: str, url: str, params: dict[str, Any] | None = None) -> str:
    fields = params or {}
    if method.upper() == "GET":
        return _base_with_query(url, True)
    return _base_with_query(url, not fields) + _sorted_fields(fields)


def sign(auth_token: str, method: str, url: str, nonce: str, params: dict[str, Any] | None = None) -> str:
    payload = f"{base_string(method, url, params)}.{nonce}".encode()
    return base64.b64encode(hmac.new(auth_token.encode(), payload, hashlib.sha256).digest()).decode()


def verify(auth_token: str, method: str, url: str, nonce: str | None, signature_header: str | None, params: dict[str, Any] | None = None) -> bool:
    """True when one of the signatures in the header is the right one for this request. No token, no nonce or no header: False."""
    if not (auth_token and nonce and signature_header):
        return False
    expected = sign(auth_token, method, url, nonce, params)
    return any(hmac.compare_digest(expected, got.strip()) for got in signature_header.split(","))
