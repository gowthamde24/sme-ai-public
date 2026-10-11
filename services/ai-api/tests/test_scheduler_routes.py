"""Job AW (ADR 0068): the HTTP side of the scheduler's settings and the Owner's status card against an in-memory fake: the role matrix (with the second factor for the Owner's change), WHAT is sent to the
database, the closed validation, and that the card carries counts and times only. The database rules are pgTAP 79; the real stack is tests/integration/test_scheduler_api.py."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import pytest

from app.tenancy.repository import UpstreamError
from tests.fakes import TENANT_A, auth, make_client
from tests.scheduler_fakes import FakeScheduler

BASE = f"/v1/tenants/{TENANT_A.id}/scheduler"
SETTINGS: dict[str, Any] = {
    "reminder_evening_enabled": True,
    "reminder_evening_hour": 17,
    "reminder_heads_up_enabled": False,
    "reminder_heads_up_minutes": 90,
    "no_show_enabled": True,
    "no_show_after_minutes": 45,
}
EVERY_MEMBER = ("a_owner", "a_admin", "a_sales", "a_viewer")
MATRIX: list[tuple[str, str, Any, tuple[str, ...], bool]] = [
    ("GET", "/status", None, ("a_owner", "a_admin"), False),
    ("GET", "/settings", None, ("a_owner", "a_admin"), False),
    ("PUT", "/settings", SETTINGS, ("a_owner",), True),
]


class World:
    def __init__(self) -> None:
        self.db = FakeScheduler()
        self.client, _ = make_client(scheduler=self.db)

    def call(
        self, method: str, path: str, user: str | None, body: Any = None, **claims: Any
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, BASE + path, json=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


@pytest.mark.parametrize(
    ("method", "path", "body", "allowed", "strong"), MATRIX, ids=[f"{m} {p}" for m, p, *_ in MATRIX]
)
def test_the_role_matrix_of_every_endpoint(
    method: str, path: str, body: Any, allowed: tuple[str, ...], strong: bool
) -> None:
    for user in EVERY_MEMBER:
        w = World()
        r = w.call(method, path, user, body)
        if user in allowed:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (
                user,
                r.status_code,
                r.text,
            )
            assert w.db.calls == [], f"{user} reached the data layer"
    w = World()
    assert w.call(method, path, "outsider", body).status_code == 404
    assert w.call(method, path, "b_owner", body).status_code == 404
    assert w.call(method, path, None, body).status_code == 401
    assert w.db.calls == []
    if strong:
        for user in allowed:
            w = World()
            r = w.call(method, path, user, body, aal="aal1")
            assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required", (
                user,
                r.text,
            )


def test_the_status_card_carries_times_and_counts_only(w: World) -> None:
    body = w.call("GET", "/status", "a_owner").json()
    assert set(body) == {
        "platform_switch_on",
        "auto_send_enabled",
        "active",
        "releases_approved",
        "worker_running",
        "last_run_at",
        "next_run_at",
        "interval_seconds",
        "last_activity_at",
        "today",
    }
    assert body["today"] == {"sent": 2, "failed": 0, "reminders": 1, "no_shows": 0, "errors": 0}
    assert body["worker_running"] is True and body["interval_seconds"] == 60
    assert w.db.calls[0][1] != "" and w.db.calls[0][0] == "scheduler_status"


def test_a_card_for_a_worker_never_heard_from_has_nulls(w: World) -> None:
    w.db.status.update(
        {
            "worker_running": False,
            "last_run_at": None,
            "next_run_at": None,
            "interval_seconds": None,
            "last_activity_at": None,
            "active": False,
        }
    )
    body = w.call("GET", "/status", "a_admin").json()
    assert (
        body["worker_running"] is False
        and body["last_run_at"] is None
        and body["next_run_at"] is None
        and body["interval_seconds"] is None
    )


def test_the_settings_are_read_with_the_callers_token_and_say_when_they_are_the_defaults(
    w: World,
) -> None:
    body = w.call("GET", "/settings", "a_owner").json()
    assert (
        body["is_default"] is True
        and body["reminder_evening_hour"] == 18
        and body["no_show_enabled"] is False
    )
    assert w.db.calls[0][0] == "scheduler_settings_get"


def test_the_whole_set_is_sent_and_read_back(w: World) -> None:
    r = w.call("PUT", "/settings", "a_owner", SETTINGS)
    assert r.status_code == 200
    assert w.db.args("scheduler_settings_set") == [
        {
            "p_evening_enabled": True,
            "p_evening_hour": 17,
            "p_heads_up_enabled": False,
            "p_heads_up_minutes": 90,
            "p_no_show_enabled": True,
            "p_no_show_after_minutes": 45,
        }
    ]
    assert r.json() == {**SETTINGS, "is_default": False}
    assert w.call("GET", "/settings", "a_admin").json()["reminder_evening_hour"] == 17


@pytest.mark.parametrize(
    "change",
    [
        {"reminder_evening_hour": 8},
        {"reminder_evening_hour": 21},
        {"reminder_heads_up_minutes": 59},
        {"reminder_heads_up_minutes": 481},
        {"no_show_after_minutes": 4},
        {"no_show_after_minutes": 721},
        {"no_show_enabled": "yes"},
        {"reminder_evening_enabled": 1},
        {"tenant_id": "x"},
        {"status": "no_show"},
    ],
)
def test_the_validation_is_closed(w: World, change: dict[str, Any]) -> None:
    r = w.call("PUT", "/settings", "a_owner", {**SETTINGS, **change})
    assert r.status_code == 422, r.text
    assert w.db.calls == []


def test_a_missing_field_is_refused(w: World) -> None:
    body = dict(SETTINGS)
    del body["no_show_enabled"]
    assert w.call("PUT", "/settings", "a_owner", body).status_code == 422


def test_an_unavailable_scheduler_says_so_and_a_broken_answer_is_a_fixed_error() -> None:
    client, _ = make_client()
    assert client.get(BASE + "/status", headers=auth("a_owner")).status_code == 503
    w = World()
    w.db.status = {"nope": 1}
    r = w.call("GET", "/status", "a_owner")
    assert r.status_code >= 500 and "nope" not in r.text


def test_a_data_layer_failure_is_a_fixed_error_with_none_of_its_text(w: World) -> None:
    w.db.fail["scheduler_status"] = UpstreamError("secret detail from the database")
    r = w.call("GET", "/status", "a_owner")
    assert r.status_code >= 500 and "secret detail" not in r.text
