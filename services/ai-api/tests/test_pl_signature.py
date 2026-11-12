"""Plivo's V3 request signature (job 3 phase A). The vectors were produced by Plivo's own SDK (plivo 4.63, `plivo.utils.signature_v3`) on 10 Nov 2026 with a made-up token; the same algorithm validated real Plivo requests on
real calls in the throwaway test the same day."""

from __future__ import annotations

import pytest

from app.telephony import plivo_signature as sig

TOKEN, NONCE = "vector-token-not-real", "nonce-123"
VECTORS = [
    ("GET", "https://x.example/plivo/answer/a", None, "https://x.example/plivo/answer/a", "xJb87oirB4/SCw5HrMakGkSXmHjeOpWQQ5/WI4HYALU="),
    ("GET", "https://x.example/p?b=2&a=1", None, "https://x.example/p?a=1&b=2", "AhnmJBq+GsC7T8cPNM1QQPNWPg9r+UoKgOapHYYjB1U="),
    ("POST", "https://x.example/plivo/answer", {"CallUUID": "u1", "From": "91999", "To": "9180", "Direction": "inbound"},
     "https://x.example/plivo/answer?CallUUIDu1DirectioninboundFrom91999To9180", "BgRW7Lzpt2ooje8FdE21cXWzb2vOdxOYrHysES3eU6s="),
    ("POST", "https://x.example/p?z=9&y=8", {"B": "2", "A": "1"}, "https://x.example/p?y=8&z=9.A1B2", "gktovypID39TfXF8uGKoYicsTqewF7+IL3qbk7oByRU="),
    ("POST", "https://x.example/plivo/hangup", None, "https://x.example/plivo/hangup", "508TqI1TkjV881PpXF/TJ6htMWIXW3+iLF9jh62aMow="),
]


@pytest.mark.parametrize(("method", "url", "params", "base", "expected"), VECTORS)
def test_the_base_string_and_the_signature_equal_the_ones_plivos_own_sdk_makes(method: str, url: str, params: dict[str, str] | None, base: str, expected: str) -> None:
    assert sig.base_string(method, url, params) == base
    assert sig.sign(TOKEN, method, url, NONCE, params) == expected
    assert sig.verify(TOKEN, method, url, NONCE, expected, params)


def test_a_wrong_token_nonce_url_method_or_field_is_refused() -> None:
    method, url, params, _, good = VECTORS[2]
    assert not sig.verify("another-token", method, url, NONCE, good, params)
    assert not sig.verify(TOKEN, method, url, "nonce-124", good, params)
    assert not sig.verify(TOKEN, method, url + "x", NONCE, good, params)
    assert not sig.verify(TOKEN, "GET", url, NONCE, good, params)
    assert not sig.verify(TOKEN, method, url, NONCE, good, {**(params or {}), "To": "9181"}), "a field changed after signing"
    assert not sig.verify(TOKEN, method, url, NONCE, good, {k: v for k, v in (params or {}).items() if k != "To"}), "a field dropped"


def test_nothing_is_believed_without_a_token_a_nonce_or_a_signature() -> None:
    method, url, params, _, good = VECTORS[2]
    assert not sig.verify("", method, url, NONCE, good, params)
    assert not sig.verify(TOKEN, method, url, None, good, params)
    assert not sig.verify(TOKEN, method, url, NONCE, None, params)
    assert not sig.verify(TOKEN, method, url, NONCE, "", params)


def test_several_signatures_in_one_header_are_accepted_when_one_is_right() -> None:
    method, url, params, _, good = VECTORS[2]
    assert sig.verify(TOKEN, method, url, NONCE, f"AAAA, {good}", params)
    assert not sig.verify(TOKEN, method, url, NONCE, "AAAA,BBBB", params)



# ---- 11 Nov 2026, from a REAL outbound call: Plivo signs the query keys as POST fields too, so the fields handed to `verify` are the body AND the query
def test_a_call_with_a_query_is_signed_over_the_sorted_query_and_the_fields_that_include_the_query_keys() -> None:
    url = "https://x.example/p?call=1&tenant=2&k=goal"
    body = {"CallUUID": "u1", "To": "9195"}
    fields = {**body, "call": "1", "tenant": "2", "k": "goal"}
    nonce, token = "n0", "T" * 24
    text = f"https://x.example/p?call=1&k=goal&tenant=2.CallUUIDu1To9195call1kgoaltenant2.{nonce}"
    import base64
    import hashlib
    import hmac

    header = base64.b64encode(hmac.new(token.encode(), text.encode(), hashlib.sha256).digest()).decode()
    assert sig.sign(token, "POST", url, nonce, fields) == header, "this is the text the real call was signed over"
    assert sig.verify(token, "POST", url, nonce, header, fields)
    assert not sig.verify(token, "POST", url, nonce, header, body), "the query keys must be among the signed fields"
    assert not sig.verify("W" * 24, "POST", url, nonce, header, fields)
    assert not sig.verify(token, "POST", url + "&x=1", nonce, header, fields)
