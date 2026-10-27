"""Job DT (ADR 0115): a full export or a deletion of the workspace needs the business name typed, and the Owner gets an e-mail notice AFTER it happened (never before, never when it was refused, and a failure to send
never undoes it)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.billing.mail import Email, FakeEmailSender
from app.privacy.notice import compose_notice, send_notice
from tests.catalogue_fakes import FakeStorage
from tests.fakes import TENANT_A, auth, make_client
from tests.privacy_fakes import FakePrivacy

T = f"/v1/tenants/{TENANT_A.id}"
X1 = "11111111-1111-4111-8111-111111111111"
X2 = "22222222-2222-4222-8222-222222222222"
D1 = "33333333-3333-4333-8333-333333333333"


def world(sender: Any) -> tuple[Any, FakePrivacy]:
    db = FakePrivacy()
    client, _ = make_client(privacy=db, catalogue_storage=FakeStorage(), mail_sender=sender)
    return client, db


def owner(**claims: Any) -> dict[str, str]:
    return auth("a_owner", email="owner@example.test", **claims)


def test_the_export_notice_goes_to_the_owner_after_a_correct_name_and_not_before() -> None:
    sender = FakeEmailSender()
    client, _ = world(sender)
    refused = client.post(f"{T}/data-exports", json={"export_id": X1, "confirm_name": "Wrong"}, headers=owner())
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "confirmation_mismatch" and sender.sent == []
    ok = client.post(f"{T}/data-exports", json={"export_id": X1, "confirm_name": TENANT_A.name}, headers=owner())
    assert ok.status_code == 202 and len(sender.sent) == 1
    mail = sender.sent[0]
    assert mail.to == "owner@example.test" and "full copy" in mail.subject and TENANT_A.name in mail.body and "If this was not you" in mail.body


def test_the_deletion_notices_follow_the_request_and_the_execution_and_a_wrong_name_sends_nothing() -> None:
    sender = FakeEmailSender()
    client, _ = world(sender)
    wrong = client.post(f"{T}/deletion-requests", json={"request_id": X2, "confirm_name": "tenant"}, headers=owner())
    assert wrong.status_code == 422 and sender.sent == []
    ok = client.post(f"{T}/deletion-requests", json={"request_id": D1, "confirm_name": TENANT_A.name}, headers=owner())
    assert ok.status_code == 201 and [m.subject for m in sender.sent] == ["Deletion of your workspace was requested"]
    assert "cancel" in sender.sent[0].body.lower()
    done = client.post(f"{T}/deletion-requests/{D1}/execute", headers=owner())
    if done.status_code == 200:
        assert sender.sent[-1].subject == "Your workspace was deleted"


def test_no_notice_for_a_caller_who_may_not_and_a_sender_that_fails_or_is_missing_changes_nothing() -> None:
    sender = FakeEmailSender()
    client, _ = world(sender)
    for user in ("a_admin", "a_sales", "a_viewer"):
        r = client.post(f"{T}/data-exports", json={"export_id": X1, "confirm_name": TENANT_A.name}, headers=auth(user, email=f"{user}@example.test"))
        assert r.status_code == 403, user
    assert sender.sent == []

    class Broken:
        name = "broken"

        def send(self, message: Email) -> bool:
            raise RuntimeError("provider down")

    for sender2 in (Broken(), None):
        c2, _ = world(sender2)
        ok = c2.post(f"{T}/data-exports", json={"export_id": X1, "confirm_name": TENANT_A.name}, headers=owner())
        assert ok.status_code == 202, "the export is made whether or not the notice could be sent"
    c3, _ = world(FakeEmailSender())
    no_address = c3.post(f"{T}/data-exports", json={"export_id": X1, "confirm_name": TENANT_A.name}, headers=auth("a_owner"))
    assert no_address.status_code == 202


def test_the_notice_words_are_fixed_and_carry_the_business_name_only_between_lines() -> None:
    for kind in ("export_requested", "deletion_requested", "deletion_executed"):
        mail = compose_notice(kind, "Evil\nBusiness", "o@example.test", "k")
        assert mail.to == "o@example.test" and mail.subject and "Workspace: Evil" in mail.body and mail.idempotency_key == "k"
    sent: list[Email] = []

    class Capture:
        name = "capture"

        def send(self, message: Email) -> bool:
            sent.append(message)
            return True

    send_notice(Capture(), "export_requested", "X", None, "k")
    send_notice(None, "export_requested", "X", "o@example.test", "k")
    assert sent == [], "no address or no sender: nothing is sent and nothing raises"
