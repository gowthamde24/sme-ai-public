"""Job RESEND: the app's e-mails. The Resend sender (HTTP API, key never shown), the reminder texts in English, Telugu and Hindi (plain text and simple HTML), the day-11 and day-13 trial reminders, and the choice
of sender at start. No real send is ever made here: the HTTP client is a stub."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import httpx
import pytest

from app.billing import mail
from app.billing.mail import (
    FakeEmailSender,
    TrialReminders,
    build_sender,
    compose_pending,
    compose_trial,
    mail_language,
)
from app.billing.resend_sender import ResendEmailSender

KEY = "re_TESTKEY_not_a_real_key_0123456789"
FROM = "noreply@mail.example.test"
REPLY = "help@mail.example.test"
TENANT = uuid.UUID(int=0xB)


def stub(status: int = 200, seen: list[httpx.Request] | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, json={"id": "x"})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_the_sender_posts_to_resend_with_the_key_the_from_the_reply_to_and_both_bodies() -> None:
    seen: list[httpx.Request] = []
    sender = ResendEmailSender(KEY, FROM, REPLY, client=stub(200, seen))
    message = compose_trial("Sri Lakshmi Silks", 11, "owner@example.test", "te", str(TENANT))
    assert sender.send(message) is True
    request = seen[0]
    body = json.loads(request.content)
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert request.headers["idempotency-key"] == message.idempotency_key
    assert body["from"] == f"Stack19 <{FROM}>"
    assert body["reply_to"] == REPLY
    assert body["to"] == ["owner@example.test"] and body["subject"] == message.subject
    assert body["text"] == message.body and body["html"] == message.html
    assert "tracking" not in json.dumps(body).lower()


@pytest.mark.parametrize("status", [400, 401, 422, 429, 500])
def test_a_refusal_is_false_and_logs_only_the_status(status: int, caplog: pytest.LogCaptureFixture) -> None:
    sender = ResendEmailSender(KEY, FROM, REPLY, client=stub(status))
    with caplog.at_level(logging.INFO):
        assert sender.send(compose_trial("Synthetic Silks", 13, "owner@example.test", "en")) is False
    assert str(status) in caplog.text
    for secret in (KEY, "owner@example.test", "Synthetic"):
        assert secret not in caplog.text


def test_an_unreachable_resend_is_false_and_logs_no_address(caplog: pytest.LogCaptureFixture) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    sender = ResendEmailSender(KEY, FROM, REPLY, client=httpx.Client(transport=httpx.MockTransport(boom)))
    with caplog.at_level(logging.INFO):
        assert sender.send(compose_trial("Synthetic Silks", 13, "owner@example.test", "en")) is False
    assert "owner@example.test" not in caplog.text and KEY not in caplog.text


def test_the_addresses_must_be_plain_addresses_and_none_is_written_into_the_code() -> None:
    for bad in ("not an address", "a@b", "Stack19 <a@b.test>", "a@b.test, c@d.test", ""):
        with pytest.raises(ValueError, match="plain address"):
            ResendEmailSender(KEY, bad, REPLY)
    with pytest.raises(ValueError, match="plain address"):
        ResendEmailSender(KEY, FROM, "x y@z.test")
    seen: list[httpx.Request] = []
    only_from = ResendEmailSender(KEY, FROM, None, client=stub(200, seen))
    assert only_from.send(compose_trial("X", 11, "o@example.test", "en")) is True
    assert "reply_to" not in json.loads(seen[0].content)
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "app" / "billing" / "resend_sender.py").read_text()
    assert "@stack19" not in source and "stack19.com" not in source


def test_the_key_is_never_in_a_repr_or_a_log(caplog: pytest.LogCaptureFixture) -> None:
    sender = ResendEmailSender(KEY, FROM, REPLY, client=stub())
    assert KEY not in repr(sender) and KEY not in str(sender)
    with caplog.at_level(logging.DEBUG):
        sender.send(compose_trial("Synthetic Silks", 11, "owner@example.test", "hi"))
    assert KEY not in caplog.text


def test_the_sender_is_chosen_at_start() -> None:
    assert build_sender("fake").name == "fake"
    assert build_sender("resend", KEY, FROM, REPLY).name == "resend"
    for key, sender in ((None, FROM), ("", FROM), (KEY, None), (KEY, "")):
        with pytest.raises(ValueError, match="RESEND_API_KEY"):
            build_sender("resend", key, sender)
    for name in ("smtp", "sendgrid", ""):
        with pytest.raises(ValueError, match="fake"):
            build_sender(name)


@pytest.mark.parametrize("language", ["en", "te", "hi"])
def test_the_trial_reminder_is_in_each_language_with_plain_text_and_html(language: str) -> None:
    for day, left in ((11, "3"), (13, "1")):
        m = compose_trial("Sri Lakshmi Silks", day, "owner@example.test", language)
        assert "Sri Lakshmi Silks" in m.body and "{" not in m.body and "{" not in m.subject
        assert m.html is not None and "Sri Lakshmi Silks" in m.html and "#c2410c" in m.html
        assert left in m.subject and m.subject != ""
        assert "Stack19" in m.body and "Stack19" in m.html
        # job DT (the owner's decision, 28 Oct): the three-bar mark is the ONE image, a static file of our own domain; still no link, no tracking pixel, no third party
        assert m.html.count("<img") == 1 and "<a " not in m.html, "one logo, no link, no tracking"
        assert m.html.count("http") == 1 and "https://stack19.com/brand/stack19-mark-email.png" in m.html


@pytest.mark.parametrize("language", ["en", "te", "hi"])
def test_the_pending_reminder_is_in_each_language_and_says_nothing_was_charged(language: str) -> None:
    m = compose_pending("Sri Lakshmi Silks", 30, "owner@example.test", language)
    assert "30" in m.body and "14" in m.body and m.html is not None and "WhatsApp" in m.body
    assert "{" not in m.body


def test_an_unknown_language_falls_back_to_english_and_a_business_name_is_escaped_in_html() -> None:
    assert mail_language("kn") == "en" and mail_language(None) == "en" and mail_language("te") == "te"
    m = compose_trial("<b>Evil</b> & {days_left} Co", 11, "owner@example.test", "kn")
    assert m.html is not None and "<b>Evil</b>" not in m.html and "&lt;b&gt;Evil&lt;/b&gt; &amp;" in m.html
    assert "{days_left} Co" in m.body, "a name with braces stays text"
    assert compose_trial("X", 11, "a@b.test", "en").subject == "Your Stack19 trial: 3 days left"
    assert compose_trial("X", 13, "a@b.test", "en").subject == "Your Stack19 trial: 1 day left"


def test_the_texts_have_the_same_shape_in_every_language() -> None:
    texts = mail._texts()
    for kind in ("trial", "pending"):
        counts = {lang: len(texts[kind]["lines"][lang]) for lang in ("en", "te", "hi")}
        assert len(set(counts.values())) == 1, counts
        assert set(texts[kind]["subject"]) == {"en", "te", "hi"}
    assert set(texts["signoff"]) == {"en", "te", "hi"}


class Repo:
    def __init__(self, due: list[dict[str, Any]]) -> None:
        self.due = due
        self.marked: list[tuple[uuid.UUID, int]] = []

    def pending_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return []

    def pending_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...

    def trial_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self.due

    def trial_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None:
        self.marked.append((tenant_id, day))


def item(day: int = 11, **extra: Any) -> dict[str, Any]:
    return {"tenant_id": str(TENANT), "tenant_name": "Synthetic Silks", "day": day, "language": "te", "emails": ["a@example.test", "b@example.test"], **extra}


def test_the_trial_reminder_goes_to_every_owner_in_their_language_and_is_then_marked() -> None:
    repo, sender = Repo([item(11), item(13)]), FakeEmailSender()
    assert TrialReminders(repo, sender).run("t") == 2
    assert len(sender.sent) == 4 and {m.to for m in sender.sent} == {"a@example.test", "b@example.test"}
    assert all("Stack19" in m.body for m in sender.sent) and sender.sent[0].subject == compose_trial("x", 11, "a@b.test", "te").subject
    assert repo.marked == [(TENANT, 11), (TENANT, 13)]


def test_a_failed_send_is_not_marked_so_it_is_offered_again() -> None:
    class Failing:
        name = "failing"

        def send(self, message: mail.Email) -> bool:
            return False

    repo = Repo([item(11)])
    assert TrialReminders(repo, Failing()).run("t") == 0 and repo.marked == []


def test_an_owner_with_no_address_or_an_odd_day_is_skipped_not_marked() -> None:
    repo = Repo([item(11, emails=[]), item(12), {"day": 11}])
    assert TrialReminders(repo, FakeEmailSender()).run("t") == 0 and repo.marked == []


def test_the_idempotency_key_is_stable_per_reminder_and_address() -> None:
    a = compose_trial("X", 11, "a@b.test", "en", str(TENANT)).idempotency_key
    assert a == compose_trial("X", 11, "a@b.test", "en", str(TENANT)).idempotency_key
    assert a != compose_trial("X", 13, "a@b.test", "en", str(TENANT)).idempotency_key
    assert a != compose_trial("X", 11, "c@b.test", "en", str(TENANT)).idempotency_key
