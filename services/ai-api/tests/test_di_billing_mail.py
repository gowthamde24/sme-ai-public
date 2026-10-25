"""Job DI: the e-mails of a read-only workspace (day 1, 30, 60, 83), with the FAKE sender (nothing is sent anywhere) and an in-memory repository."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.billing.mail import DAYS, BillingReminders, Email, FakeEmailSender, build_sender, compose
from app.tenancy.repository import TokenRejected

T = uuid.UUID(int=0xA)
TOKEN = "worker-token"  # noqa: S105


class Repo:
    def __init__(self, due: list[dict[str, Any]]) -> None:
        self.due, self.asked = due, 0
        self.marked: list[tuple[uuid.UUID, int]] = []

    def reminders_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        self.asked += 1
        return list(self.due)

    def mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None:
        self.marked.append((tenant_id, day))


def item(day: int = 30, emails: list[str] | None = None) -> dict[str, Any]:
    return {"tenant_id": str(T), "tenant_name": "Synthetic Silks", "day": day, "read_only_since": "2026-10-14", "delete_on": "2027-01-12", "emails": ["owner@example.test"] if emails is None else emails}


def test_a_due_reminder_goes_to_every_owner_and_is_marked_once() -> None:
    sender = FakeEmailSender()
    repo = Repo([item(30, ["a@example.test", "b@example.test"])])
    assert BillingReminders(repo, sender).run(TOKEN) == 1
    assert [m.to for m in sender.sent] == ["a@example.test", "b@example.test"] and repo.marked == [(T, 30)]


@pytest.mark.parametrize("day", DAYS)
def test_each_reminder_says_read_only_what_still_works_and_the_day_of_deletion_and_nothing_else(day: int) -> None:
    mail = compose("Synthetic Silks", day, "2027-01-12", "owner@example.test")
    text = f"{mail.subject}\n{mail.body}"
    assert "read-only" in text.lower() or "deleted" in text.lower()
    assert "2027-01-12" in mail.body and "export" in mail.body and "Synthetic Silks" in mail.body
    assert "sign in" in mail.body and "Sending messages, the AI and calls are paused" in mail.body
    for forbidden in ("Rs", "₹", "password", "http"):
        assert forbidden not in text, forbidden


def test_day_one_and_day_83_have_their_own_words() -> None:
    assert "now read-only" in compose("X", 1, "2027-01-12", "a@example.test").subject
    assert "7 days" in compose("X", 83, "2027-01-12", "a@example.test").subject
    assert "30 days" in compose("X", 30, "2027-01-12", "a@example.test").subject


def test_an_owner_with_no_address_is_not_marked_and_a_failed_send_is_not_marked() -> None:
    sender, repo = FakeEmailSender(), Repo([item(30, [])])
    assert BillingReminders(repo, sender).run(TOKEN) == 0 and repo.marked == []

    class Failing(FakeEmailSender):
        def send(self, message: Email) -> bool:
            return False

    repo = Repo([item(60)])
    assert BillingReminders(repo, Failing()).run(TOKEN) == 0 and repo.marked == [], "offered again on the next tick"


def test_an_unexpected_item_is_skipped_and_the_others_go() -> None:
    sender, repo = FakeEmailSender(), Repo([{"tenant_id": "not-a-uuid", "day": 30}, item(1), {**item(), "day": 45}])
    assert BillingReminders(repo, sender).run(TOKEN) == 1 and repo.marked == [(T, 1)]


def test_a_refused_token_is_raised_for_the_worker_to_sign_in_again() -> None:
    class Refusing(Repo):
        def reminders_due(self, token: str, limit: int) -> list[dict[str, Any]]:
            raise TokenRejected("401")

    with pytest.raises(TokenRejected):
        BillingReminders(Refusing([]), FakeEmailSender()).run(TOKEN)


def test_only_the_fake_sender_exists_and_it_logs_no_address_or_text(caplog: pytest.LogCaptureFixture) -> None:
    assert build_sender("fake").name == "fake"
    for name in ("smtp", "sendgrid", ""):
        with pytest.raises(ValueError, match="fake"):
            build_sender(name)
    with caplog.at_level("INFO", logger="app.billing.mail"):
        FakeEmailSender().send(compose("Synthetic Silks", 30, "2027-01-12", "owner@example.test"))
    assert "owner@example.test" not in caplog.text and "Synthetic" not in caplog.text
