"""C10: "I sent it" (POST /outbox/messages/{id}/mark-sent). The owner sent an approved message by hand from their own WhatsApp; this records it. The HTTP side against the in-memory fake: the flag, the
roles, the closed 409 codes, the replay, and that nothing is handed to a channel. The database rule is pgTAP 189."""

from __future__ import annotations

from typing import Any

import pytest

from app.outbox.adapter import LocalFakeAdapter
from tests.fakes import TENANT_A, auth, make_client
from tests.outbox_fakes import FakeOutbox, message_row

QUEUED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
WAITING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
SENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
BLOCKED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"
FLIGHT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5"
BASE = f"/v1/tenants/{TENANT_A.id}"


class World:
    def __init__(self, flag: bool = True) -> None:
        self.db = FakeOutbox()
        self.adapter = LocalFakeAdapter()
        self.client, _ = make_client(
            outbox=self.db, outbox_adapter=self.adapter, outbox_whatsapp=flag
        )
        self.db.messages[QUEUED] = message_row(QUEUED, status="queued", reason="owner_approved")
        self.db.messages[WAITING] = message_row(WAITING, status="needs_approval", reason="money")
        self.db.messages[SENT] = message_row(SENT, status="sent", adapter="fake")
        self.db.messages[BLOCKED] = message_row(BLOCKED, status="blocked", reason="stopped")
        self.db.messages[FLIGHT] = message_row(FLIGHT, status="queued", in_flight=True)

    def mark(self, message: str, user: str | None = "a_owner", body: Any = None) -> Any:
        headers = auth(user) if user else {}
        return self.client.post(
            f"{BASE}/outbox/messages/{message}/mark-sent", json=body, headers=headers
        )


def test_an_approved_message_is_marked_sent_by_hand_and_the_same_call_again_replays() -> None:
    w = World()
    r = w.mark(QUEUED, body={})
    assert r.status_code == 200 and r.json()["replayed"] is False, r.text
    assert r.json()["message"]["status"] == "sent"
    again = w.mark(QUEUED, body={})
    assert again.status_code == 200 and again.json()["replayed"] is True
    assert w.db.messages[QUEUED]["adapter"] == "manual"


def test_the_body_may_be_left_out_but_may_not_carry_anything() -> None:
    assert World().mark(QUEUED).status_code == 200
    r = World().mark(QUEUED, body={"phone": "+919876543210"})
    assert r.status_code == 422


@pytest.mark.parametrize(
    ("message", "code"),
    [(WAITING, "not_approved"), (BLOCKED, "not_approved"), (SENT, "already_sent"), (FLIGHT, "being_sent")],
)
def test_a_message_in_the_wrong_state_is_a_closed_409(message: str, code: str) -> None:
    w = World()
    r = w.mark(message)
    assert r.status_code == 409 and r.json()["error"]["code"] == code, r.text
    assert w.db.messages[message]["status"] != "sent" or message == SENT


@pytest.mark.parametrize("user", ["a_sales", "a_viewer"])
def test_only_owner_and_admin_may_mark(user: str) -> None:
    w = World()
    r = w.mark(QUEUED, user)
    assert r.status_code == 403 and "outbox_mark_sent" not in w.db.names()


def test_admin_may_mark_and_no_second_factor_is_needed() -> None:
    assert World().mark(QUEUED, "a_admin").status_code == 200


def test_without_a_token_it_is_401_and_an_unknown_id_is_404() -> None:
    w = World()
    assert w.mark(QUEUED, None).status_code == 401
    assert w.mark("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99").status_code == 404
    assert w.mark("not-an-id").status_code == 404


def test_off_it_is_404_as_if_the_route_did_not_exist_and_nothing_is_written() -> None:
    w = World(flag=False)
    r = w.mark(QUEUED)
    assert r.status_code == 404 and "outbox_mark_sent" not in w.db.names()


def test_marking_sends_nothing_through_the_channel() -> None:
    w = World()
    w.mark(QUEUED)
    assert w.adapter.sent == []
    assert "outbox_claim_due" not in w.db.names()
