"""The public "Talk to us" form (migration 20261231991800; docs/contracts/contact-form.md): off by default, consent with the current versions, the waitlist's captcha and limits, a duplicate is recognised, the hello inbox is told THAT a message arrived and never who wrote it."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.billing.mail import FakeEmailSender
from app.dpdp.mail import IntakeMail, compose_contact_inbox
from app.dpdp.runtime import DpdpRuntime
from app.integrations.policy import PolicyVersions
from tests.dq_fakes import FakeDpdpRepository
from tests.fakes import make_client

VERSIONS = PolicyVersions("2026-11-02", "2026-11-01")   # (terms, privacy)
GOOD = {"name": "Ravi Kumar", "phone": "+91 98480 12345", "business_kind": "Saree shop", "good_time": "after 6 pm", "sells": "Silk sarees", "consent": True, "terms_version": "2026-11-02", "notice_version": "2026-11-01"}


def world(on: bool = True) -> tuple[Any, FakeDpdpRepository]:
    repo = FakeDpdpRepository()
    runtime = DpdpRuntime(repo, privacy_email="privacy@example.test", hello_email="hello@example.test")
    client, _ = make_client(dpdp=runtime, policies=VERSIONS)
    app_runtime = client.app.state.runtime
    object.__setattr__(app_runtime, "contact_form", on)
    return client, repo


def test_it_is_off_by_default() -> None:
    client, repo = world(on=False)
    assert client.post("/v1/public/contact", json=GOOD).status_code == 404 and repo.contacts == {}


def test_a_message_is_stored_with_a_reference_and_nothing_personal_comes_back() -> None:
    client, repo = world()
    r = client.post("/v1/public/contact", json=GOOD)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "received" and body["reference"].startswith("TQ-") and set(body) == {"status", "reference"}
    assert "Ravi" not in r.text and "98480" not in r.text
    stored = next(iter(repo.contacts.values()))
    assert stored["p_terms_version"] == "2026-11-02" and stored["p_notice_version"] == "2026-11-01" and stored["p_sells"] == "Silk sarees"


def test_the_same_contact_twice_is_a_duplicate_with_the_first_reference() -> None:
    client, _ = world()
    first = client.post("/v1/public/contact", json=GOOD).json()
    again = client.post("/v1/public/contact", json=GOOD)
    assert again.status_code == 200 and again.json() == {"status": "duplicate", "reference": first["reference"]}


def test_consent_versions_and_a_way_to_reach_them_are_required() -> None:
    client, repo = world()
    assert client.post("/v1/public/contact", json={**GOOD, "consent": False}).status_code == 422
    assert client.post("/v1/public/contact", json={k: v for k, v in GOOD.items() if k != "consent"}).status_code == 422
    assert client.post("/v1/public/contact", json={**GOOD, "phone": None}).status_code == 422
    assert client.post("/v1/public/contact", json={**GOOD, "email": "not-an-email"}).status_code == 422
    stale = client.post("/v1/public/contact", json={**GOOD, "terms_version": "2025-01-01"})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "policy_version_outdated"
    assert repo.contacts == {}


def test_per_address_limits_and_the_captcha_are_the_waitlists() -> None:
    client, _ = world()
    codes = [client.post("/v1/public/contact", json={**GOOD, "phone": f"+9198000{n:05d}"}).status_code for n in range(40)]
    assert 429 in codes and codes[0] == 201


def test_the_hello_inbox_is_told_that_a_message_arrived_and_never_who() -> None:
    repo, sender = FakeDpdpRepository(), FakeEmailSender()
    cid = uuid.uuid4()
    repo.due_contacts = [{"id": str(cid), "reference": "TQ-0000ABCD", "business_kind": "Saree shop", "good_time": "after 6 pm", "created_at": "2026-11-25T10:00:00+00:00"}]
    sent = IntakeMail(repo, sender, "privacy@example.test", "hello@example.test").run("tok")
    assert sent >= 1 and repo.contact_marks == [str(cid)]
    mail = sender.sent[-1]
    assert mail.to == "hello@example.test" and "TQ-0000ABCD" in mail.subject and "Saree shop" in mail.body
    assert "Ravi" not in mail.body and "@" not in mail.body.replace("hello@example.test", "")
    again = compose_contact_inbox(repo.due_contacts[0], "hello@example.test")
    assert again.idempotency_key == f"contact-{cid}"
