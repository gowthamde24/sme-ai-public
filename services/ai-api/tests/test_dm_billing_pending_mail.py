"""Job DM: the reminder to a workspace still waiting for WhatsApp (30, 60, 90 days after it chose a plan). The FAKE sender sends nothing."""

from __future__ import annotations

import uuid
from typing import Any

from app.billing.mail import BillingReminders, FakeEmailSender, compose_pending
from app.tenancy.repository import UpstreamError

T = uuid.UUID(int=7)


class Repo:
    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.items, self.marked, self.fail = items, [], False

    def reminders_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return []

    def mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...

    def pending_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        if self.fail:
            raise UpstreamError("down")
        return self.items

    def pending_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None:
        self.marked.append((tenant_id, day))


def item(day: int = 30, emails: list[str] | None = None) -> dict[str, Any]:
    return {"tenant_id": str(T), "tenant_name": "Sri Lakshmi Silks", "day": day, "emails": ["owner@example.test"] if emails is None else emails}


def test_the_words_say_nothing_was_charged_and_where_the_14_days_begin() -> None:
    m = compose_pending("Sri Lakshmi Silks", 30, "owner@example.test")
    assert "nothing has been charged" in m.body and "14 days begin on the day your WhatsApp is connected" in m.body and "Sri Lakshmi Silks" in m.body
    assert "₹" not in m.body and "child" not in m.body.lower()


def test_a_due_reminder_is_sent_through_the_fake_sender_and_marked() -> None:
    repo, sender = Repo([item(30), item(60)]), FakeEmailSender()
    assert BillingReminders(repo, sender).run_pending("t") == 2  # type: ignore[arg-type]
    assert len(sender.sent) == 2 and repo.marked == [(T, 30), (T, 60)]


def test_an_owner_with_no_address_is_not_marked_and_a_bad_day_is_skipped() -> None:
    repo, sender = Repo([item(30, []), item(45)]), FakeEmailSender()
    assert BillingReminders(repo, sender).run_pending("t") == 0  # type: ignore[arg-type]
    assert repo.marked == [] and sender.sent == []


def test_a_failure_of_the_data_layer_is_raised_for_the_worker_to_log() -> None:
    repo = Repo([])
    repo.fail = True
    try:
        BillingReminders(repo, FakeEmailSender()).run_pending("t")  # type: ignore[arg-type]
    except UpstreamError:
        return
    raise AssertionError("expected UpstreamError")
