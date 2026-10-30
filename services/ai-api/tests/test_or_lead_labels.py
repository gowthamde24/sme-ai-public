"""Job OR (owner, 30 Oct 2026): the forwarding address has its own source tag, so its leads read "Forwarded e-mail" and not "Webhook (Zapier, n8n)"; a lead is never shown by an internal id.
Offline, against fakes."""

# ruff: noqa: E501

from __future__ import annotations

from typing import get_args

import pytest

from app.lead_sources import cards
from app.lead_sources.models import SourceTag
from app.lead_sources.service import LeadSourcesService, tag_of
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"


@pytest.mark.parametrize(
    ("kind", "portal", "tag"),
    [("email_forward", None, "email_forward"), ("email_forward", "justdial", "justdial"), ("email_forward", "indiamart", "indiamart"), ("webhook", None, "webhook"), ("website_form", None, "website_form"), ("meta_lead_ads", None, "meta_lead_ads")],
)
def test_a_forwarding_address_without_a_portal_has_its_own_tag(kind: str, portal: str | None, tag: str) -> None:
    assert tag_of(kind, portal) == tag
    assert tag in get_args(SourceTag)


def test_the_address_the_owner_is_shown_makes_a_source_tagged_email_forward() -> None:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service)
    assert client.get(T + "/lead-sources/email-address", headers=auth("a_owner")).status_code == 200
    made = [s for s in repo.sources_.values() if s["kind"] == "email_forward"]
    assert len(made) == 1 and made[0]["tag"] == "email_forward"
    listed = client.get(T + "/lead-sources", headers=auth("a_owner")).json()
    items = listed["items"] if isinstance(listed, dict) else listed
    assert [s["tag"] for s in items if s["kind"] == "email_forward"] == ["email_forward"]


def test_the_forwarded_email_card_counts_what_came_through_the_address() -> None:
    assert "email_forward" in cards.EMAIL_TAGS and "email_forward" not in cards.WEBSITE_TAGS and "webhook" not in cards.EMAIL_TAGS
