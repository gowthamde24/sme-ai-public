"""The Chats composer queue API (owner, 19 Nov 2026): POST queues what the owner typed while the 24-hour window is closed, GET shows it, cancel, attention; every refusal is a closed word."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.outbox.adapter import LocalFakeAdapter
from app.outbox.errors import ComposerRefused
from tests.fakes import TENANT_A, auth, make_client
from tests.outbox_fakes import FakeOutbox

BASE = f"/v1/tenants/{TENANT_A.id}"
LEAD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
CLIENT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"


class World:
    def __init__(self) -> None:
        self.db = FakeOutbox()
        self.client, _ = make_client(outbox=self.db, outbox_adapter=LocalFakeAdapter())

    def call(self, method: str, path: str, user: str | None, body: Any = None) -> Any:
        return self.client.request(
            method, BASE + path, json=body, headers=auth(user) if user else {}
        )


@pytest.fixture
def w() -> World:
    return World()


def _post(w: World, user: str = "a_owner", text: str = "Yes, the silk sarees are in stock.") -> Any:
    return w.call(
        "POST", f"/conversations/{LEAD}/queued-message", user, {"text": text, "client_id": CLIENT}
    )


def test_queue_get_and_cancel(w: World) -> None:
    r = _post(w)
    assert r.status_code == 200, r.text
    got = r.json()
    assert (
        got["status"] == "waiting_for_reply"
        and got["continue_chat"] == "sent"
        and got["text"].startswith("Yes")
    )
    args = [c for c in w.db.calls if c[0] == "queued_reply_create"][-1][2]
    assert (
        args["p_lead_id"] == LEAD
        and args["p_client_id"] == CLIENT
        and args["p_text"].startswith("Yes")
    )
    g = w.call("GET", f"/conversations/{LEAD}/queued-message", "a_owner")
    assert g.status_code == 200 and g.json()["queued"]["id"] == got["id"]
    c = w.call("POST", f"/queued-messages/{got['id']}/cancel", "a_owner")
    assert c.status_code == 200 and c.json() == {"id": got["id"], "status": "cancelled"}
    assert w.call("GET", f"/conversations/{LEAD}/queued-message", "a_owner").json() == {
        "queued": None
    }


def test_the_attention_list_and_who_may(w: World) -> None:
    _post(w)
    a = w.call("GET", "/queued-messages/attention", "a_owner")
    assert (
        a.status_code == 200
        and a.json()["items"][0]["status"] == "expired"
        and a.json()["items"][0]["lead_id"] == LEAD
    )
    assert _post(w, user="").status_code in (401, 403)


@pytest.mark.parametrize(
    ("sqlstate", "status", "code"),
    [
        ("SM990", 409, "window_open"),
        ("SM991", 409, "stopped_by_customer"),
        ("SM992", 409, "consent_required"),
        ("SM993", 429, "daily_limit"),
        ("SM994", 409, "no_whatsapp"),
        ("SM995", 409, "already_queued"),
        ("SM997", 409, "hello_not_approved"),
        ("SM998", 409, "marketing_blocked"),
    ],
)
def test_every_refusal_is_a_closed_word_with_a_fixed_sentence(
    w: World, sqlstate: str, status: int, code: str
) -> None:
    w.db.raise_next = ComposerRefused(sqlstate)
    r = _post(w)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert "SM9" not in r.text and r.json()["error"]["message"], (
        "no data-layer text, only our sentence"
    )


def test_not_waiting_on_cancel_and_a_bad_text_is_refused(w: World) -> None:
    w.db.raise_next = ComposerRefused("SM996")
    r = w.call("POST", f"/queued-messages/{uuid.uuid4()}/cancel", "a_owner")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_waiting"
    assert _post(w, text="").status_code == 422
    assert _post(w, text="x" * 1001).status_code == 422
