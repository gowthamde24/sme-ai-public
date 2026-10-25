"""Job DP part 6: error reporting is OFF unless SENTRY_DSN is set, and when it is on only the exception's class name and stack frames leave: no message, URL, query, header, cookie, body, user, IP, breadcrumb or
log line. A capturing transport stands in for Sentry: nothing here touches the network."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import sys
from typing import Any

import pytest

from app.config import Settings
from app.observability import sentry as obs

DSN = "https://publickey@o0.ingest.sentry.io/1"
PII = "Meena (9876543210) asked about the marks of her daughter Asha"


from sentry_sdk.transport import Transport  # noqa: E402


class Capture(Transport):
    """A Sentry transport that keeps what it is given."""

    def __init__(self) -> None:
        super().__init__({})
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Any) -> None:
        for item in envelope.items:
            if item.headers.get("type") == "event":
                self.events.append(json.loads(json.dumps(item.payload.json)))

    def flush(self, timeout: float, callback: Any = None) -> None: ...
    def kill(self) -> None: ...
    def is_healthy(self) -> bool:
        return True


@pytest.fixture(autouse=True)
def _reset() -> Any:
    yield
    if "sentry_sdk" in sys.modules:
        import sentry_sdk

        sentry_sdk.get_client().close()


def test_without_a_dsn_nothing_starts_and_the_sdk_is_not_even_imported() -> None:
    sys.modules.pop("sentry_sdk", None)
    assert obs.init_sentry(None, environment="staging", release="x") is False
    assert obs.init_sentry("", environment="staging", release="x") is False
    assert "sentry_sdk" not in sys.modules
    obs.capture(RuntimeError(PII), "req1")   # a no-op


def test_the_setting_is_off_by_default_and_a_secret() -> None:
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.sentry_dsn is None
    on = Settings(_env_file=None, sentry_dsn=DSN)  # type: ignore[call-arg,arg-type]
    assert DSN not in repr(on) and on.sentry_dsn is not None and on.sentry_dsn.get_secret_value() == DSN


def boom() -> None:
    raise ValueError(PII)


def test_an_error_leaves_as_a_class_name_and_a_stack_and_nothing_a_person_said() -> None:
    cap = Capture()
    assert obs.init_sentry(DSN, environment="staging", release="0.1.0", transport=cap) is True
    import sentry_sdk

    with sentry_sdk.new_scope() as scope:
        scope.set_user({"id": "u1", "email": "a@b.test", "ip_address": "1.2.3.4"})
        scope.set_tag("customer", "9876543210")
        scope.set_extra("body", PII)
        sentry_sdk.add_breadcrumb(message=PII)
        try:
            boom()
        except ValueError as exc:
            obs.capture(exc, "req-abc")
    sentry_sdk.flush()
    assert len(cap.events) == 1
    event = cap.events[0]
    text = json.dumps(event)
    for secret in ("Meena", "9876543210", "Asha", "marks", "a@b.test", "1.2.3.4", "u1"):
        assert secret not in text, secret
    assert event["exception"]["values"][0]["type"] == "ValueError"
    assert "value" not in event["exception"]["values"][0], "the message does not leave"
    frame = event["exception"]["values"][0]["stacktrace"]["frames"][-1]
    assert frame["function"] == "boom" and set(frame) <= {"module", "function", "lineno", "in_app"}, "no source line, no variables"
    assert event["environment"] == "staging" and event["release"] == "0.1.0" and event["tags"] == {"request_id": "req-abc"}
    for key in ("request", "user", "breadcrumbs", "extra", "contexts", "modules", "sdk", "message", "logentry"):
        assert key not in event, key


def test_scrub_drops_what_it_does_not_understand_and_what_is_not_an_exception() -> None:
    assert obs.scrub_event({"message": PII}) is None
    assert obs.scrub_event({"logentry": {"message": PII}}) is None
    assert obs.scrub_event({"exception": {"values": [{"type": "KeyError", "value": PII, "stacktrace": {"frames": [{"module": "m", "function": "f", "lineno": 3, "vars": {"x": PII}, "context_line": PII}]}}]}})["exception"]["values"][0] == {  # type: ignore[index]
        "type": "KeyError", "module": "", "stacktrace": {"frames": [{"module": "m", "function": "f", "lineno": 3}]},
    }
    assert obs.scrub_event({"exception": "garbage"}) is None


def test_a_long_request_id_is_not_sent() -> None:
    event = {"exception": {"values": [{"type": "E"}]}, "tags": {"request_id": "x" * 65}}
    assert "tags" not in (obs.scrub_event(event) or {})


def test_the_500_handler_reports_through_the_scrubber_and_still_answers_the_same(caplog: pytest.LogCaptureFixture) -> None:
    from fastapi import APIRouter

    from tests.fakes import make_client

    cap = Capture()
    obs.init_sentry(DSN, environment="staging", release="0.1.0", transport=cap)
    from fastapi.testclient import TestClient

    made, _ = make_client()
    client = TestClient(made.app, raise_server_exceptions=False)
    router = APIRouter()

    @router.get("/v1/_boom")
    def _boom() -> None:
        raise RuntimeError(PII)

    client.app.include_router(router)  # type: ignore[attr-defined]
    with caplog.at_level(logging.DEBUG):
        r = client.get("/v1/_boom?customer=9876543210", headers={"x-request-id": "r-1"})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error" and PII not in r.text
    import sentry_sdk

    sentry_sdk.flush()
    assert len(cap.events) == 1 and "9876543210" not in json.dumps(cap.events[0]) and "Meena" not in json.dumps(cap.events[0])
    assert DSN not in caplog.text


def test_the_dependency_is_declared_for_the_images() -> None:
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    assert '"sentry-sdk>=2.30,<3"' in text
