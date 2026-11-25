"""The ready-made automation templates (data/guides.json): every body that an importable workflow, a recipe, a snippet or a CRM mapping sends is posted to the real inbound lead route, with a fake sender (no network), and must be accepted as a lead. Nothing here
holds a secret; the numbers and addresses are invented (reserved domains, numbers that start 9000)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

import pytest

from app.lead_sources import guides
from app.lead_sources.service import LeadSourcesService
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"
ADDRESS = "https://api.example.test/v1/lead-intake/YOUR-ADDRESS"
WEB_SNIPPETS = Path(__file__).resolve().parents[3] / "apps/web/lib/lead-desk/guide-snippets.json"
CASES = [(g["id"], label, body) for g in map(lambda i: guides.guide(i["id"], ADDRESS), guides.listing()) if g is not None for label, body in guides.bodies(g)]


def world() -> tuple[Any, FakeLeadSourcesRepository, str]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service)
    made = client.post(f"{T}/lead-sources", json={"source_id": str(uuid.uuid4()), "kind": "webhook", "label": "Templates"}, headers=auth("a_owner")).json()
    return client, repo, made["secret"]["url"].rsplit("/", 1)[1]


@pytest.mark.parametrize(("guide_id", "label", "body"), CASES, ids=[f"{g}:{label}" for g, label, _ in CASES])
def test_every_body_a_template_sends_is_accepted_as_a_lead_as_json_and_as_a_form(guide_id: str, label: str, body: dict[str, Any]) -> None:
    client, repo, token = world()
    assert client.post("/v1/lead-intake/" + token, json=body).status_code == 202, f"{guide_id} {label}: JSON refused"
    assert len(repo.sent) == 1 and repo.sent[0].get("phone"), f"{guide_id} {label}: no lead with a number was stored"
    assert repo.sent[0].get("name"), f"{guide_id} {label}: the name was not understood"
    client, repo, token = world()
    assert client.post("/v1/lead-intake/" + token, data={k: str(v) for k, v in body.items()}).status_code == 202, f"{guide_id} {label}: form post refused"
    assert len(repo.sent) == 1 and repo.sent[0].get("phone")


def test_the_same_lead_sent_twice_by_a_tool_is_one_lead() -> None:
    client, repo, token = world()
    body = {"name": "Kiran", "phone": "9700099999", "message": "Price list please", "external_id": "z-1"}
    assert client.post("/v1/lead-intake/" + token, json=body).status_code == 202
    assert client.post("/v1/lead-intake/" + token, json=body).status_code == 202
    assert len(repo.items) == 1


def test_there_is_a_template_a_recipe_or_a_snippet_for_every_tool_the_plan_names() -> None:
    by_id = {g["id"]: guides.guide(g["id"], ADDRESS) or {} for g in guides.listing()}
    assert "template" in by_id["n8n"]
    for tool in ("zapier", "make", "pabbly"):
        assert "recipe" in by_id[tool], tool
    for tool in ("google_forms", "google_sheets", "wordpress", "wix"):
        assert by_id[tool].get("snippet"), tool
    for tool in ("zoho_crm", "leadsquared", "sell_do", "hubspot"):
        assert len(by_id[tool]["mapping"]) >= 5, tool


def test_the_n8n_workflow_is_a_file_n8n_can_import_and_posts_to_the_address() -> None:
    g = guides.guide("n8n", ADDRESS)
    assert g is not None
    flow = g["template"]["workflow"]
    json.loads(json.dumps(flow))   # plain JSON all the way down
    names = {n["name"] for n in flow["nodes"]}
    assert set(flow["connections"]) <= names and all(t["node"] in names for c in flow["connections"].values() for branch in c["main"] for t in branch)
    assert len({n["id"] for n in flow["nodes"]}) == len(flow["nodes"])
    request = next(n for n in flow["nodes"] if n["type"] == "n8n-nodes-base.httpRequest")
    assert request["parameters"]["url"] == ADDRESS and request["parameters"]["method"] == "POST" and "{ADDRESS}" not in json.dumps(flow)
    assert set(guides.n8n_body(flow)) == {"name", "phone", "email", "city", "message"}
    assert g["template"]["filename"].endswith(".json")


def test_a_snippet_names_the_address_and_no_key() -> None:
    for gid in ("wordpress", "wix", "google_forms", "google_sheets"):
        g = guides.guide(gid, ADDRESS)
        assert g is not None and ADDRESS in g["snippet"], gid
        assert not re.search(r"(?i)bearer|api[_-]?key|secret", g["snippet"]), gid


def test_the_texts_on_the_web_guide_page_are_the_ones_in_the_data() -> None:
    web = json.loads(WEB_SNIPPETS.read_text(encoding="utf-8"))
    for key in ("auto", "crm", "web"):
        assert web[key].endswith(guides.web_text(key)), f"apps/web/lib/lead-desk/guide-snippets.json `{key}` is out of date: it must end with guides.web_text('{key}')"
        assert guides.web_text(key)


def test_the_web_texts_hold_no_secret_and_name_the_address_the_page_fills() -> None:
    for key in ("auto", "crm", "web"):
        text = guides.web_text(key)
        assert "YOUR_ADDRESS" in text or key == "crm"
        assert not re.search(r"s19_(live|test)_[0-9a-f]{8}|eyJ[A-Za-z0-9_-]{20,}", text)
