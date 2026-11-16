"""Why a message in a chat did not go, and what to try next (owner, 16 Nov 2026). The reasons are stored already; the thread now carries `not_sent` with one fixed sentence each. No network."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import pytest

from app.outbox.models import REASON_TEXT
from app.whatsapp import not_sent
from tests.test_whatsapp_routes import ACCOUNT, T, World

ACTIONS = {"send_template", "open_approvals", "open_templates", "open_consent", "open_settings", "check_number", "wait", "none"}


def out(**over: Any) -> dict[str, Any]:
    return {"direction": "out", "id": "m1", "at": "2026-11-16T10:00:00+00:00", "text": "hello", "status": "sent", "reason": "auto_allowed", "failure_code": None, "delivery": None, "delivery_error": None, **over}


@pytest.mark.parametrize(
    ("item", "code", "action"),
    [
        (out(status="failed", reason="send_failed", failure_code="window_closed"), "window_closed", "send_template"),
        (out(status="failed", reason="send_failed", failure_code="template_required"), "template_required", "open_templates"),
        (out(status="failed", reason="send_failed", failure_code="rejected"), "rejected", "open_settings"),
        (out(status="failed", reason="send_failed", failure_code="recipient_unreachable"), "recipient_unreachable", "check_number"),
        (out(status="failed", reason="send_failed", failure_code="rate_limited"), "rate_limited", "wait"),
        (out(status="failed", reason="send_failed", failure_code="not_configured"), "not_configured", "open_settings"),
        (out(status="failed", reason="send_failed", failure_code="something_new"), "something_new", "send_template"),
        (out(status="blocked", reason="no_inbound_window"), "no_inbound_window", "send_template"),
        (out(status="blocked", reason="stopped"), "stopped", "none"),
        (out(status="blocked", reason="daily_limit"), "daily_limit", "wait"),
        (out(status="blocked", reason="no_opt_in"), "no_opt_in", "open_consent"),
        (out(status="blocked", reason="a_word_we_do_not_know"), "a_word_we_do_not_know", "none"),
        (out(status="needs_approval", reason="money"), "needs_approval", "open_approvals"),
        (out(status="queued", reason="quiet_hours"), "quiet_hours", "wait"),
        (out(status="sent", delivery="failed", delivery_error="window_closed"), "window_closed", "send_template"),
        (out(status="sent", delivery="failed", delivery_error="template_paused"), "template_paused", "open_templates"),
        (out(status="sent", delivery="failed", delivery_error="never_heard_of_it"), "never_heard_of_it", "wait"),
    ],
)
def test_a_message_that_did_not_go_says_why_and_what_to_try(item: dict[str, Any], code: str, action: str) -> None:
    e = not_sent.explain(item)
    assert e is not None and e["code"] == code and e["action"] == action and len(e["text"]) > 10 and len(e["next_step"]) > 5, e


@pytest.mark.parametrize("item", [out(), out(status="sent", delivery="delivered"), out(status="sent", delivery="read"), out(status="queued", reason="auto_allowed"), {"direction": "in", "id": "e1", "text": "hello"}])
def test_a_message_that_went_or_is_on_its_way_has_no_reason(item: dict[str, Any]) -> None:
    assert not_sent.explain(item) is None


def test_every_blocked_reason_of_the_outbox_is_explained_or_is_one_that_is_not_a_failure() -> None:
    not_failures = {"auto_allowed", "owner_approved", "campaign_approved", "quiet_hours", "money", "commitment", "complaint", "model_flagged", "uncertain", "category_other", "auto_off"}
    for reason in REASON_TEXT:
        if reason in not_failures:
            continue
        assert reason in not_sent.BLOCKED, f"{reason} has no sentence for the chat"
    for table in (not_sent.FAILURE, not_sent.DELIVERY, not_sent.BLOCKED):
        assert all(len(v) == 3 and v[2] in ACTIONS for v in table.values())


def test_the_chat_thread_carries_not_sent_on_every_message_and_null_for_the_ones_that_went() -> None:
    w = World()
    w.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    w.repo.thread_items = [
        {"direction": "in", "id": "e1", "at": "2026-11-16T09:00:00+00:00", "text": "price?"},
        out(id="m1", status="failed", reason="send_failed", failure_code="window_closed", at="2026-11-16T10:00:00+00:00"),
        out(id="m2", status="sent", delivery="delivered", at="2026-11-16T11:00:00+00:00"),
    ]
    r = w.call("GET", T + "/conversations/aaaaaaaa-0000-4000-8000-0000000000a1", "a_sales")
    assert r.status_code == 200
    by = {i["id"]: i for i in r.json()["items"]}
    assert by["e1"]["not_sent"] is None and by["m2"]["not_sent"] is None
    assert by["m1"]["not_sent"]["code"] == "window_closed" and by["m1"]["not_sent"]["action"] == "send_template" and "template" in by["m1"]["not_sent"]["next_step"].lower()
