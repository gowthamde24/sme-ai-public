"""The daily read of the WhatsApp platform token's expiry (20 Nov 2026): Meta's answer as facts, the pass that asks the database whether a read is due, writes the date, never logs the token, and the switch is off by default."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import SecretStr

from app.config import Settings
from app.ops import token_expiry as te

SECRET = "EAAB-this-token-must-never-appear-anywhere"
NOW = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)


def settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, api_env="development", **kw)  # type: ignore[call-arg]


class FakeReader:
    def __init__(self, facts: te.TokenFacts | Exception) -> None:
        self._facts = facts

    def facts(self) -> te.TokenFacts:
        if isinstance(self._facts, Exception):
            raise self._facts
        return self._facts


class FakeRpc:
    def __init__(self, due: bool = True) -> None:
        self.due = due
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((function, args))
        return self.due if function == "ops_credential_check_due" else None


@pytest.mark.parametrize(
    ("body", "valid", "expires"),
    [
        ({"data": {"is_valid": True, "expires_at": 0, "data_access_expires_at": 0}}, True, None),
        ({"data": {"is_valid": True, "expires_at": 1795000000, "data_access_expires_at": 0}}, True, datetime.fromtimestamp(1795000000, tz=UTC)),
        ({"data": {"is_valid": True, "expires_at": 1795000000, "data_access_expires_at": 1790000000}}, True, datetime.fromtimestamp(1790000000, tz=UTC)),
        ({"data": {"is_valid": False}}, False, None),
    ],
)
def test_metas_answer_becomes_valid_and_the_earliest_day_it_stops(body: dict[str, Any], valid: bool, expires: datetime | None) -> None:
    assert te.parse_debug(body) == te.TokenFacts(valid, expires)


@pytest.mark.parametrize("body", [None, {}, {"data": None}, {"data": {"is_valid": "yes"}}, [], {"error": {"message": "x"}}])
def test_an_answer_that_is_not_the_shape_is_a_bad_response_never_guessed(body: Any) -> None:
    with pytest.raises(te.TokenCheckError) as err:
        te.parse_debug(body)
    assert err.value.reason == "bad_response"


def test_nothing_due_nothing_asked_of_meta() -> None:
    rpc = FakeRpc(due=False)
    assert te.TokenExpiryCheck(FakeReader(te.TokenFacts(True, None)), rpc).run("t") == "idle"
    assert [c[0] for c in rpc.calls] == ["ops_credential_check_due"]


def test_a_due_read_marks_the_try_first_then_writes_the_date_meta_gave() -> None:
    rpc = FakeRpc()
    day = datetime(2026, 12, 20, tzinfo=UTC)
    assert te.TokenExpiryCheck(FakeReader(te.TokenFacts(True, day)), rpc).run("t") == "ok"
    names = [c[0] for c in rpc.calls]
    assert names == ["ops_credential_check_due", "ops_credential_check_attempt", "ops_credential_deadline_set"]
    args = rpc.calls[-1][1]
    assert args["p_key"] == "whatsapp.platform_token" and args["p_expires_at"] == day.isoformat() and args["p_warn_days"] == 14


def test_a_token_that_never_expires_is_written_as_never_and_an_invalid_one_as_expired_now() -> None:
    rpc = FakeRpc()
    te.TokenExpiryCheck(FakeReader(te.TokenFacts(True, None)), rpc).run("t")
    assert rpc.calls[-1][1]["p_expires_at"] is None
    rpc2 = FakeRpc()
    te.TokenExpiryCheck(FakeReader(te.TokenFacts(False, None)), rpc2, clock=lambda: NOW).run("t")
    assert rpc2.calls[-1][1]["p_expires_at"] == NOW.isoformat()


def test_a_failed_read_writes_no_date_and_is_tried_again_by_the_database_gap() -> None:
    rpc = FakeRpc()
    assert te.TokenExpiryCheck(FakeReader(te.TokenCheckError("unreachable")), rpc).run("t") == "failed"
    assert [c[0] for c in rpc.calls] == ["ops_credential_check_due", "ops_credential_check_attempt"]


def test_the_token_never_reaches_the_log(caplog: pytest.LogCaptureFixture) -> None:
    import httpx

    def refuse(request: httpx.Request) -> httpx.Response:
        assert request.url.params["input_token"] == SECRET and request.url.params["access_token"] == SECRET
        return httpx.Response(400, json={"error": {"message": f"bad token {SECRET}"}})

    reader = te.MetaDebugToken("https://graph.example", "v25.0", SECRET, client=httpx.Client(transport=httpx.MockTransport(refuse)))
    with caplog.at_level(logging.DEBUG), pytest.raises(te.TokenCheckError) as err:
        reader.facts()
    assert err.value.reason == "refused" and SECRET not in caplog.text and SECRET not in repr(err.value)


def test_it_is_off_by_default_and_on_without_a_token_stops_the_worker_at_start() -> None:
    assert te.build_token_expiry(settings(), "http://x", "k") is None
    with pytest.raises(te.ConfigurationError):
        te.build_token_expiry(settings(token_expiry_check=True), "http://x", "k")
    built = te.build_token_expiry(settings(token_expiry_check=True, whatsapp_access_token=SecretStr(SECRET)), "http://x", "k")
    assert built is not None
