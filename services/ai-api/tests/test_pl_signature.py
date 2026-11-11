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


# ---- 11 Nov 2026: the first real outbound call carried a query and was refused: more than one reading of the base string is accepted, and the matching one is named
def test_the_variants_each_verify_under_their_own_name_and_a_wrong_token_or_form_never_does() -> None:
    from app.telephony import plivo_signature as sig

    url = "https://x.example/p?call=1&tenant=2&lang=te&p=visit&k=goal"      # NOT in sorted order, as ours are
    form = {"CallUUID": "u1", "From": "9180", "To": "9195"}
    nonce, token = "n0nce", "T" * 24
    sdk = sig.sign(token, "POST", url, nonce, form)
    assert sig.verify_variant(token, "POST", url, nonce, sdk, form) == "sdk"
    as_sent = sig._hmac(token, sig._as_sent_base("POST", url, form, query_in_form=False), nonce)   # noqa: SLF001
    assert as_sent != sdk, "the two readings differ when the query is not sorted"
    assert sig.verify_variant(token, "POST", url, nonce, as_sent, form) == "as_sent"
    in_form = sig._hmac(token, sig._as_sent_base("POST", url, form, query_in_form=True), nonce)   # noqa: SLF001
    assert sig.verify_variant(token, "POST", url, nonce, in_form, form) == "all_in_form"
    assert sig.verify_variant(token, "POST", url, nonce, None, form, ma_header=as_sent) == "ma_as_sent", "the main-account header is read too"
    assert sig.verify_variant("W" * 24, "POST", url, nonce, as_sent, form) is None, "another token never verifies"
    assert sig.verify_variant(token, "POST", url, nonce, as_sent, {**form, "To": "9196"}) is None, "a changed form never verifies"
    assert sig.verify_variant(token, "POST", url, "other", as_sent, form) is None, "another nonce never verifies"
    assert sig.verify_variant(token, "POST", url + "&x=1", nonce, as_sent, form) is None, "a changed query never verifies"
    assert sig.verify_variant("", "POST", url, nonce, as_sent, form) is None and sig.verify_variant(token, "POST", url, None, as_sent, form) is None and sig.verify_variant(token, "POST", url, nonce, None, form) is None
    assert sig.verify_variant(token, "GET", "https://x.example/p?b=2&a=1", nonce, sig.sign(token, "GET", "https://x.example/p?b=2&a=1", nonce), None) == "sdk"


# ---- the diagnostic matrix (11 Nov 2026): the structure and the token that matched are named; a wrong token, nonce or content never matches
def test_the_matrix_names_the_reading_and_token_that_matched_and_nothing_else_matches() -> None:
    import base64
    import hashlib
    import hmac as _hmac

    from app.telephony import plivo_signature as sig

    url = "https://x.example/p?call=1&tenant=2&k=goal"
    form = {"CallUUID": "u1", "To": "9195"}
    nonce, main, line = "n0", "M" * 24, "L" * 24

    def mac(token: str, text: str) -> str:
        return base64.b64encode(_hmac.new(token.encode(), text.encode(), hashlib.sha256).digest()).decode()

    tokens = {"v3": line, "ma": main}
    # the query dropped from the signed text, fields after a dot, the MAIN token, the Ma header
    ma = mac(main, f"https://x.example/p.CallUUIDu1To9195.{nonce}")
    assert sig.verify_matrix(tokens, "POST", url, nonce, {"v3": "zzz", "ma": ma}, form) == "ma|ma|bare+form|sep=.|nonce_joint=."
    assert sig.verify_matrix(tokens, "POST", url, nonce, {"v3": ma, "ma": None}, form) is None, "the MAIN token never signs the V3 header of a line that sits in another account"
    assert sig.verify_matrix(tokens, "POST", url, "other", {"v3": ma, "ma": ma}, form) is None
    assert sig.verify_matrix({"v3": "W" * 24, "ma": ""}, "POST", url, nonce, {"v3": ma, "ma": ma}, form) is None
    assert sig.verify_matrix(tokens, "POST", url, nonce, {"v3": ma, "ma": ma}, {**form, "To": "9196"}) is None
    assert sig.verify_matrix(tokens, "POST", url, None, {"v3": ma, "ma": ma}, form) is None and sig.verify_matrix(tokens, "POST", url, nonce, {"v3": None, "ma": ""}, form) is None
