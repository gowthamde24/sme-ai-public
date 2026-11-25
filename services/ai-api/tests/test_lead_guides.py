"""The connector guides (data/guides.json): every sample body is understood by the REAL intake, the address is written in, nothing secret is in the data."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from typing import Any

import pytest

from app.lead_sources import guides
from app.lead_sources.service import _FORM_ALIASES, LeadSourcesService
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"
IDS = [g["id"] for g in guides.listing()]
OURS = set(_FORM_ALIASES) | {"consent"}


def world() -> tuple[Any, FakeLeadSourcesRepository]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service)
    return client, repo


def test_the_twelve_tools_the_plan_names_are_there() -> None:
    assert set(IDS) == {"zoho_crm", "leadsquared", "sell_do", "hubspot", "zapier", "make", "n8n", "pabbly", "google_forms", "wordpress", "wix", "google_sheets"}
    assert {g["group"] for g in guides.listing()} == {"crm", "automation", "website", "sheet"}


@pytest.mark.parametrize("guide_id", IDS)
def test_each_guide_is_complete_and_its_sample_is_understood_by_the_real_intake(guide_id: str) -> None:
    g = guides.guide(guide_id, "https://api.example.test/v1/lead-intake/YOUR-ADDRESS")
    assert g is not None and len(g["steps"]) >= 3 and all(isinstance(s, str) and s for s in g["steps"])
    assert "{ADDRESS}" not in json.dumps(g) and "YOUR-ADDRESS" in json.dumps(g)
    row = LeadSourcesService.form_row(dict(g["sample"]))
    assert row is not None and "phone" in row and "name" in row, f"{guide_id}: the sample is not understood"
    assert set(g["mapping"].values()) <= OURS, f"{guide_id}: maps to a field we do not have"
    client, _ = world()
    made = client.post(f"{T}/lead-sources", json={"source_id": str(uuid.uuid4()), "kind": "webhook", "label": f"Guide {guide_id}"}, headers=auth("a_owner")).json()
    token = made["secret"]["url"].rsplit("/", 1)[1]
    assert client.post("/v1/lead-intake/" + token, json=g["sample"]).status_code == 202


def test_a_script_snippet_posts_json_to_the_address_and_names_no_secret() -> None:
    for gid in ("google_forms", "google_sheets"):
        g = guides.guide(gid, "https://api.example.test/v1/lead-intake/YOUR-ADDRESS")
        assert g is not None
        assert "UrlFetchApp.fetch('https://api.example.test/v1/lead-intake/YOUR-ADDRESS'" in g["snippet"] and "application/json" in g["snippet"]


def test_the_routes_list_and_show_guides_to_owner_and_admin_only() -> None:
    client, _ = world()
    listed = client.get(f"{T}/lead-sources/guides", headers=auth("a_admin")).json()
    assert len(listed["guides"]) == 12 and "consent_text" in listed["note"]
    one = client.get(f"{T}/lead-sources/guides/zapier", headers=auth("a_owner")).json()
    assert one["name"] == "Zapier" and "https://api.example.test/v1/lead-intake/YOUR-ADDRESS" in " ".join(one["steps"])
    assert client.get(f"{T}/lead-sources/guides/nothing", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{T}/lead-sources/guides", headers=auth("a_sales")).status_code == 403


def test_no_guide_carries_a_key_a_token_or_a_real_looking_number() -> None:
    text = (guides.PATH).read_text(encoding="utf-8")
    assert not re.search(r"(?i)api[_-]?key|secret|token=|bearer ", text.replace("the address is the key", ""))
