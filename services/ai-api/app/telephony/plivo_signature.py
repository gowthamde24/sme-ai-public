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


def _as_sent_base(method: str, url: str, params: dict[str, Any] | None, *, query_in_form: bool) -> str:
    """The same base string, but with the query kept in the order it was SENT (not sorted): how Plivo's documentation words it ("the final request URL, including its query string"). The first real outbound call
    (11 Nov 2026) carried a query and was refused under the sorted form, so both readings are accepted and the one that matched is logged by name."""
    parts = urlsplit(url)
    base = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    fields = dict(params or {})
    if query_in_form and parts.query:
        for key, values in parse_qs(parts.query, keep_blank_values=True).items():
            fields.setdefault(key, values)
        parts = parts._replace(query="")
    if method.upper() == "GET" or not fields:
        return base + ("?" + parts.query if parts.query else "")
    return base + ("?" + parts.query + "." if parts.query else ".") + _sorted_fields(fields)


def _hmac(auth_token: str, base: str, nonce: str) -> str:
    return base64.b64encode(hmac.new(auth_token.encode(), f"{base}.{nonce}".encode(), hashlib.sha256).digest()).decode()


def verify_variant(auth_token: str, method: str, url: str, nonce: str | None, signature_header: str | None, params: dict[str, Any] | None = None, *, ma_header: str | None = None) -> str | None:
    """The NAME of the reading under which the request is signed, or None. Every reading is an HMAC-SHA256 under the same secret Auth Token, so accepting more than one canonical form of the base string lets in nothing
    that the token holder could not already sign: `sdk` (query sorted, as Plivo's SDK builds it), `as_sent` (query in the order it was sent), `all_in_form` (the query fields signed as form fields), and the same
    three against the header Plivo signs with the MAIN account's token (`ma_*`, X-Plivo-Signature-Ma-V3). The first one is the original behaviour."""
    if not (auth_token and nonce and (signature_header or ma_header)):
        return None
    candidates = {
        "sdk": base_string(method, url, params),
        "as_sent": _as_sent_base(method, url, params, query_in_form=False),
        "all_in_form": _as_sent_base(method, url, params, query_in_form=True),
    }
    for header, prefix in ((signature_header, ""), (ma_header, "ma_")):
        if not header:
            continue
        offered = [got.strip() for got in header.split(",")]
        for name, base in candidates.items():
            expected = _hmac(auth_token, base, nonce)
            if any(hmac.compare_digest(expected, got) for got in offered):
                return prefix + name
    return None


def verify_matrix(tokens: dict[str, str], method: str, url: str, nonce: str | None, headers: dict[str, str | None], form: dict[str, Any] | None, *, form_multi: dict[str, Any] | None = None,
                  other_bases: tuple[str, ...] = ()) -> str | None:
    """DIAGNOSTIC (11 Nov 2026, after two real outbound calls were refused under every simple reading): try the structural readings of Plivo's base string against each token we hold and each signature header,
    and return the NAME of the combination that matched (`<header>|<header>|<url form>+<fields>|sep=<separator>|<nonce joint>`), or None. Every combination is an HMAC-SHA256 under a secret Auth Token, so a match proves the
    sender held the token; the cost of a looser reading is that a signature may cover less of the request, so this is for the sandbox while we find the reading, and is then narrowed to the one that matched."""
    if not nonce:
        return None
    parts = urlsplit(url)
    bare = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    ported = urlunsplit((parts.scheme, parts.netloc + ("" if ":" in parts.netloc else ":443"), parts.path, "", ""))
    query = parse_qs(parts.query, keep_blank_values=True)
    sorted_q, sent_q = _sorted_query(query), parts.query
    fields = {"form": _sorted_fields(form or {}), "all": _sorted_fields({**(form or {}), **query}), "none": ""}
    if form_multi:   # a key that came twice in the body keeps both values (the SDK sorts them), instead of the last one winning
        fields["form_multi"] = _sorted_fields(form_multi)
    urls: dict[str, str] = {"bare": bare, "q_sorted": bare + ("?" + sorted_q if sorted_q else ""), "q_sent": bare + ("?" + sent_q if sent_q else ""), "ported_bare": ported, "ported_q_sent": ported + ("?" + sent_q if sent_q else "")}
    for index, other in enumerate(other_bases):   # the same path and query on another address: the one the request itself arrived on (its Host header and scheme), not only our configured public address
        o = urlsplit(other)
        o_bare = urlunsplit((o.scheme, o.netloc, parts.path, "", ""))
        urls[f"host{index}_bare"] = o_bare
        urls[f"host{index}_q_sorted"] = o_bare + ("?" + sorted_q if sorted_q else "")
        urls[f"host{index}_q_sent"] = o_bare + ("?" + sent_q if sent_q else "")
    for header_name, header in headers.items():
        offered = [got.strip() for got in (header or "").split(",") if got.strip()]
        if not offered:
            continue
        # `tokens` maps a header name to the ONE token that may sign it: V3 is signed by the token of the account the line sits in, Ma-V3 always by the MAIN account's (Plivo's documentation). The main token is never
        # accepted on V3 for a line that sits in a subaccount.
        for token_name, token in ((header_name, tokens.get(header_name, "")),):
            if not token:
                continue
            for url_name, base_url in urls.items():
                for field_name, text in fields.items():
                    for sep in (".", "", "?"):
                        for joint in (".", ""):
                            expected = base64.b64encode(hmac.new(token.encode(), f"{base_url}{sep if text else ''}{text}{joint}{nonce}".encode(), hashlib.sha256).digest()).decode()
                            if any(hmac.compare_digest(expected, got) for got in offered):
                                return f"{header_name}|{token_name}|{url_name}+{field_name}|sep={sep or 'none'}|nonce_joint={joint or 'none'}"
    return None
