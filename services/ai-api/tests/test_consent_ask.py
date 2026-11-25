"""Ask for consent in one tap (planner, 18 Nov 2026): GET drafts, POST sends only on the owner's tap; nothing automatic; Owner and Admin only."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.outbox.adapter import LocalFakeAdapter
from tests.fakes import TENANT_A, auth, make_client
from tests.outbox_fakes import FakeOutbox

BASE = f"/v1/tenants/{TENANT_A.id}"
LEAD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
TPL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
MID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9"


class World:
    def __init__(self) -> None:
        self.db = FakeOutbox()
        self.client, _ = make_client(outbox=self.db, outbox_adapter=LocalFakeAdapter())

    def call(self, method: str, user: str | None, body: Any = None) -> Any:
        return self.client.request(method, BASE + f"/leads/{LEAD}/consent-ask", json=body, headers=auth(user) if user else {})


@pytest.fixture
def w() -> World:
    return World()


def test_the_draft_has_the_words_in_the_customers_language_and_sends_nothing(w: World) -> None:
    r = w.call("GET", "a_owner")
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["needed"] is True and got["reason"] is None and got["how"] == "message" and got["window_open"] is True and got["customer"] == "Kalyani Gowda"
    assert "May we call you and send you messages on WhatsApp" in got["text"] and "STOP" in got["text"]
    uuid.UUID(got["message_id"])
    assert w.db.names() == ["consent_ask_info"], "a read: no message was made"


def test_the_words_follow_the_customers_language(w: World) -> None:
    w.db.consent_info["language"] = "te"
    said = w.client.get(BASE + f"/leads/{LEAD}/consent-ask", headers=auth("a_owner")).json()["text"]
    assert "Tenant A" in said and "AI assistant" in said and "STOP" in said, "the default greeting says it is the AI assistant (lawyer's opinion, 25 Nov 2026)"
    assert w.client.get(BASE + f"/leads/{LEAD}/consent-ask", headers=auth("a_owner")).json()["language"] == "te"


@pytest.mark.parametrize(("over", "reason", "how"), [
    ({"whatsapp_consent": "granted"}, "already_agreed", "none"),
    ({"stopped": True}, "stopped", "none"),
    ({"has_number": False}, "no_whatsapp_number", "none"),
    ({"window_open": False}, "no_template", "none"),
    ({"window_open": False, "template_id": TPL}, None, "template"),
])
def test_who_is_asked_and_how(w: World, over: dict[str, Any], reason: str | None, how: str) -> None:
    w.db.consent_info.update(over)
    got = w.call("GET", "a_owner").json()
    assert got["reason"] == reason and got["how"] == how and got["needed"] is (reason in (None, "no_template"))


def test_the_tap_sends_the_drafts_words_through_the_outbox_as_an_owner_message(w: World) -> None:
    r = w.call("POST", "a_owner", {"message_id": MID})
    assert r.status_code == 200, r.text
    name, _, args = w.db.calls[-1] if w.db.calls[-1][0] == "outbox_submit" else next(c for c in w.db.calls if c[0] == "outbox_submit")
    assert name == "outbox_submit" and args["p_source"] == "owner" and args["p_category"] == "info" and args["p_message_id"] == MID and args["p_lead_id"] == LEAD
    assert "May we call you" in args["p_body"]


def test_with_the_window_closed_the_approved_template_goes_and_without_one_nothing_does(w: World) -> None:
    w.db.consent_info.update({"window_open": False, "template_id": TPL})
    assert w.call("POST", "a_owner", {"message_id": MID}).status_code == 200
    assert "conversation_template_send" in w.db.names() and "outbox_submit" not in w.db.names()
    w2 = World()
    w2.db.consent_info.update({"window_open": False})
    r = w2.call("POST", "a_owner", {"message_id": MID})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_consent_template" and "outbox_submit" not in w2.db.names()


@pytest.mark.parametrize("over", [{"whatsapp_consent": "granted"}, {"stopped": True}, {"has_number": False}])
def test_nobody_is_asked_who_agreed_stopped_or_has_no_number(w: World, over: dict[str, Any]) -> None:
    w.db.consent_info.update(over)
    r = w.call("POST", "a_owner", {"message_id": MID})
    assert r.status_code == 422 and r.json()["error"]["code"] == "consent_ask_not_needed"
    assert "outbox_submit" not in w.db.names() and "conversation_template_send" not in w.db.names()


def test_only_owner_and_admin_and_the_body_is_closed(w: World) -> None:
    assert w.call("GET", "a_sales").status_code == 403 and w.call("POST", "a_sales", {"message_id": MID}).status_code == 403
    assert w.call("GET", "a_admin").status_code == 200 and w.call("POST", "a_admin", {"message_id": MID}).status_code == 200
    assert w.call("GET", None).status_code == 401
    assert w.call("POST", "a_owner", {"message_id": MID, "text": "free words"}).status_code == 422, "there is no field for the words: they are the server's"
    assert w.call("POST", "a_owner", {}).status_code == 422
