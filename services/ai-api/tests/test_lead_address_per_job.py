"""One lead address per job, what arrived at it, and the test lead (migration 20261231990500). The database's own rules are in the migration; here the routes and the closed activity words."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.lead_sources.service import LeadSourcesService, activity_of
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"


def world() -> tuple[Any, FakeLeadSourcesRepository]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service)
    return client, repo


def test_a_job_gets_one_address_and_the_secret_is_shown_once() -> None:
    client, _ = world()
    assert client.get(f"{T}/jobs/real_estate_enquiries/lead-address", headers=auth("a_owner")).json() is None
    sid = str(uuid.uuid4())
    made = client.post(f"{T}/jobs/real_estate_enquiries/lead-address", json={"source_id": sid}, headers=auth("a_owner"))
    assert made.status_code == 201, made.text
    body = made.json()
    assert body["job_id"] == "real_estate_enquiries" and body["secret"]["shown_once"] is True and body["secret"]["url"].startswith("https://api.example.test/v1/lead-intake/")
    again = client.post(f"{T}/jobs/real_estate_enquiries/lead-address", json={"source_id": str(uuid.uuid4())}, headers=auth("a_owner"))
    assert again.status_code == 200 and again.json()["secret"] is None and again.json()["source_id"] == sid
    got = client.get(f"{T}/jobs/real_estate_enquiries/lead-address", headers=auth("a_owner")).json()
    assert got["source_id"] == sid and got["secret"] is None
    assert client.get(f"{T}/jobs/Bad-Job/lead-address", headers=auth("a_owner")).status_code == 422


def test_only_owner_and_admin_manage_addresses() -> None:
    client, _ = world()
    for who in ("a_sales", "a_viewer"):
        assert client.get(f"{T}/jobs/x_job/lead-address", headers=auth(who)).status_code == 403
        assert client.post(f"{T}/jobs/x_job/lead-address", json={"source_id": str(uuid.uuid4())}, headers=auth(who)).status_code == 403


def test_a_post_leaves_a_closed_activity_row_and_never_its_fields() -> None:
    client, repo = world()
    made = client.post(f"{T}/jobs/shop_enquiries/lead-address", json={"source_id": str(uuid.uuid4())}, headers=auth("a_owner")).json()
    token = made["secret"]["url"].rsplit("/", 1)[1]
    assert client.post("/v1/lead-intake/" + token, data={"name": "Ravi", "phone": "9876543210"}).status_code == 202
    assert client.post("/v1/lead-intake/" + token, data={"name": "Bot", "phone": "9876543210", "_hp": "x"}).status_code == 202
    rows = client.get(f"{T}/lead-sources/{made['source_id']}/activity", headers=auth("a_owner")).json()["items"]
    assert [r["reason"] for r in rows][-2:] != [] and {r["outcome"] for r in rows} <= {"accepted", "duplicate", "refused"}
    assert any(r["reason"] == "bot" and r["outcome"] == "refused" for r in rows)
    assert "Ravi" not in str(rows) and "9876543210" not in str(rows)


def test_the_test_lead_stores_nothing_and_says_what_was_understood() -> None:
    client, repo = world()
    made = client.post(f"{T}/jobs/shop_enquiries/lead-address", json={"source_id": str(uuid.uuid4())}, headers=auth("a_owner")).json()
    before = len(repo.contacts)
    r = client.post(f"{T}/lead-sources/{made['source_id']}/test-lead", json={"sample": {"name": "Test", "phone": "9876543210", "city": "Guntur"}}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["stored"] is False and out["outcome"] == "accepted" and out["mapped"]["phone"] == "set"
    assert len(repo.contacts) == before and "9876543210" not in r.text
    bot = client.post(f"{T}/lead-sources/{made['source_id']}/test-lead", json={"sample": {"phone": "9876543210", "_hp": "x"}}, headers=auth("a_owner")).json()
    assert bot["outcome"] == "refused" and bot["reason"] == "bot"
    items = client.get(f"{T}/lead-sources/{made['source_id']}/activity", headers=auth("a_owner")).json()["items"]
    assert items[0]["test"] is True


def test_the_closed_words_of_an_outcome() -> None:
    assert activity_of({"ready": 1}, 0) == ("accepted", "new_lead")
    assert activity_of({}, 2) == ("accepted", "known_customer")
    assert activity_of({"no_consent": 1}, 0) == ("accepted", "ask_first")
    assert activity_of({"dnd": 1}, 0) == ("accepted", "on_do_not_call")
    assert activity_of({"duplicates_merged": 1}, 0) == ("duplicate", "duplicate")
    assert activity_of({"already_imported": 1}, 0) == ("duplicate", "duplicate")
    assert activity_of({"blocked": 1}, 0) == ("refused", "blocked")
    assert activity_of({"invalid": 1}, 0) == ("refused", "invalid")
    assert activity_of({}, 0) == ("refused", "nothing_taken")
