# ruff: noqa: E501
"""The Google Maps cap alerts: e-mailed once to the owner, tried again after a failed send, never with personal data."""

from __future__ import annotations

import uuid
from typing import Any

from app.billing.mail import FakeEmailSender
from app.ops.alerts import GoogleCapAlerts

A1, A2 = str(uuid.UUID(int=1)), str(uuid.UUID(int=2))


class FakeRpc:
    def __init__(self, new: list[dict[str, Any]], emails: list[str]) -> None:
        self.new, self.emails = new, emails
        self.marked: list[str] = []

    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        return {"new": self.new} if function == "ops_google_alerts_run" else {"emails": self.emails}

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        assert function == "ops_alert_mark_emailed"
        self.marked += args["p_ids"]


def alert(i: str, severity: str = "warn") -> dict[str, Any]:
    return {"id": i, "severity": severity, "title": "Place Details Enterprise: 80% of the free monthly limit used", "detail": "5600 of 7000 requests this month."}


def test_each_alert_goes_to_the_owner_and_is_marked_sent() -> None:
    rpc, sender = FakeRpc([alert(A1), alert(A2, "over")], ["owner@example.com"]), FakeEmailSender()
    assert GoogleCapAlerts(rpc, sender).run("t") == 2
    assert [m.to for m in sender.sent] == ["owner@example.com"] * 2 and rpc.marked == [A1, A2]
    assert sender.sent[1].subject.startswith("[Stack19] Limit reached") and sender.sent[0].idempotency_key == f"google-cap-{A1}"
    assert "5600 of 7000" in sender.sent[0].body


def test_nothing_new_nothing_sent() -> None:
    rpc, sender = FakeRpc([], ["owner@example.com"]), FakeEmailSender()
    assert GoogleCapAlerts(rpc, sender).run("t") == 0 and not sender.sent


def test_no_owner_account_means_nothing_is_marked_so_it_is_tried_again() -> None:
    rpc, sender = FakeRpc([alert(A1)], []), FakeEmailSender()
    assert GoogleCapAlerts(rpc, sender).run("t") == 0 and not rpc.marked


def test_a_failed_send_stays_unmarked() -> None:
    class Failing(FakeEmailSender):
        def send(self, message: Any) -> bool:
            return False

    rpc = FakeRpc([alert(A1)], ["owner@example.com"])
    assert GoogleCapAlerts(rpc, Failing()).run("t") == 0 and not rpc.marked
