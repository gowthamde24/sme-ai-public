"""Plivo's REST API as we call it (job 3 phase B): the request is exactly what Plivo documents, credentials never leak, every failure is a closed word."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.telephony.plivo_api import FakePlivoApi, PlivoApi, PlivoError, digits

ID, TOKEN = "MAXXXXXXXXXXXXXXXXXX", "secret-token-0123456789abcdef"


def api(handler: Any) -> PlivoApi:
    return PlivoApi(ID, TOKEN, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_a_call_is_fired_with_basic_auth_the_documented_body_and_digits_only_numbers() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201, json={"message": "call fired", "request_uuid": "5b5c21a9-1111-2222-3333-444455556666", "api_id": "x"})

    got = api(handler).place_call(from_number="+918065590129", to_number="+919502380998", answer_url="https://a.example/v1/telephony/plivo/outbound-answer?call=c1", hangup_url="https://a.example/v1/telephony/plivo/hangup?call=c1")
    assert got == "5b5c21a9-1111-2222-3333-444455556666"
    request = seen[0]
    assert request.method == "POST" and request.url.path == f"/v1/Account/{ID}/Call/" and request.url.host == "api.plivo.com"
    assert request.headers["authorization"].startswith("Basic ")
    body = json.loads(request.content)
    assert body == {"from": "918065590129", "to": "919502380998", "answer_url": "https://a.example/v1/telephony/plivo/outbound-answer?call=c1", "answer_method": "POST",
                    "hangup_url": "https://a.example/v1/telephony/plivo/hangup?call=c1", "hangup_method": "POST", "ring_timeout": 30, "time_limit": 180}


def test_hang_up_is_a_delete_and_false_when_plivo_no_longer_knows_the_call() -> None:
    methods: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        methods.append(f"{request.method} {request.url.path}")
        return httpx.Response(204) if "-ok-" in request.url.path else httpx.Response(404, json={"error": "not found"})

    client = api(handler)
    assert client.hang_up("call-ok-uuid-0001") is True and client.hang_up("call-gone-uuid-02") is False
    assert methods == [f"DELETE /v1/Account/{ID}/Call/call-ok-uuid-0001/", f"DELETE /v1/Account/{ID}/Call/call-gone-uuid-02/"]
    assert client.hang_up("../../etc") is False and client.hang_up("") is False, "an id that is not an id is never put in a path"


@pytest.mark.parametrize(("status", "reason"), [(401, "unauthorized"), (403, "unauthorized"), (429, "rate_limited"), (400, "rejected"), (422, "rejected"), (500, "unavailable"), (503, "unavailable")])
def test_every_failure_is_a_closed_word_and_never_the_body(status: int, reason: str) -> None:
    client = api(lambda request: httpx.Response(status, json={"error": "to number +919502380998 is not allowed"}))
    with pytest.raises(PlivoError) as caught:
        client.place_call(from_number="+918065590129", to_number="+919502380998", answer_url="https://a.example/x", hangup_url="https://a.example/y")
    assert caught.value.reason == reason and "9502380998" not in str(caught.value) and TOKEN not in str(caught.value)


def test_a_timeout_a_dead_network_and_a_strange_answer() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    def dead(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    kw: dict[str, Any] = dict(from_number="+918065590129", to_number="+919502380998", answer_url="https://a.example/x", hangup_url="https://a.example/y")
    for handler, reason in ((slow, "timeout"), (dead, "unavailable"), (lambda r: httpx.Response(201, json={"message": "ok"}), "bad_response"), (lambda r: httpx.Response(201, text="not json"), "bad_response"),
                            (lambda r: httpx.Response(201, json={"request_uuid": "../x"}), "bad_response")):
        with pytest.raises(PlivoError) as caught:
            api(handler).place_call(**kw)
        assert caught.value.reason == reason


def test_the_credentials_are_checked_hidden_and_never_in_a_repr() -> None:
    with pytest.raises(ValueError):
        PlivoApi("bad id", TOKEN)
    with pytest.raises(ValueError):
        PlivoApi(ID, TOKEN, base="http://api.plivo.com")
    client = api(lambda r: httpx.Response(204))
    assert TOKEN not in repr(client) and ID not in repr(client)


def test_the_fake_dials_nobody_and_can_fail_on_purpose() -> None:
    fake = FakePlivoApi()
    assert fake.place_call(from_number="+918065590129", to_number="+919502380998", answer_url="a", hangup_url="b").startswith("00000000")
    assert fake.placed[0]["to"] == "+919502380998" and digits("+91 95023-80998") == "919502380998"
    fake.fail_with = "rejected"
    with pytest.raises(PlivoError):
        fake.place_call(from_number="x", to_number="y", answer_url="a", hangup_url="b")
