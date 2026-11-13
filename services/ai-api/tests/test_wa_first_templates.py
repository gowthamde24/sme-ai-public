"""The first message templates (13 Nov 2026): the data holds Meta's and the database's rules, the Owner seeds them as drafts, submits them, and reads Meta's decision back. Fake Graph only, no network."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Any

import pytest

from app.whatsapp import first_templates
from tests.test_whatsapp_routes import ACCOUNT, T, World


def test_every_first_template_obeys_the_rules_of_meta_and_of_the_database() -> None:
    drafts = first_templates.drafts()
    assert len(drafts) == 20 and {d["language"] for d in drafts} == {"en", "te", "hi", "kn"}
    assert {d["name"] for d in drafts} == {"visit_reminder", "visit_confirmation", "followup_nudge", "catalogue_share", "missed_call_followup"}
    for d in drafts:
        b = d["body"]
        assert re.fullmatch(r"[a-z][a-z0-9_]{0,59}", d["name"]) and 10 <= len(b) <= 1024, d
        assert b.count("{{1}}") == 1 and not re.search(r"\{\{[2-9]\}\}", b), d
        assert not re.match(r"^\s*\{\{1\}\}", b) and not re.search(r"\{\{1\}\}\s*$", b), d   # words before and after the variable
        assert not re.search(r"₹|\brs\.?\s?\d|\d\s?%|https?://|www\.|guarantee|promise|discount|offer", b, re.IGNORECASE), "no price, link or promise: " + b
        assert d["category"] in ("utility", "marketing") and d["purpose"] in ("visit", "followup", "info")


def test_the_ids_are_stable_per_workspace_and_differ_between_them() -> None:
    import uuid

    a, b = uuid.UUID("11111111-1111-4111-8111-111111111111"), uuid.UUID("22222222-2222-4222-8222-222222222222")
    assert first_templates.template_id(a, "visit_reminder", "te") == first_templates.template_id(a, "visit_reminder", "te")
    assert first_templates.template_id(a, "visit_reminder", "te") != first_templates.template_id(b, "visit_reminder", "te")
    assert first_templates.template_id(a, "visit_reminder", "te") != first_templates.template_id(a, "visit_reminder", "hi")


@pytest.fixture
def w() -> World:
    world = World()
    world.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    return world


def test_seeding_makes_twenty_drafts_once_and_only_for_owner_and_admin(w: World) -> None:
    assert w.call("POST", T + "/whatsapp/templates/first", "a_sales").status_code == 403
    first = w.call("POST", T + "/whatsapp/templates/first", "a_admin")
    assert first.status_code == 200 and first.json()["created"] == 20 and all(t["status"] == "draft" for t in first.json()["templates"])
    again = w.call("POST", T + "/whatsapp/templates/first", "a_owner")
    assert again.json()["created"] == 0 and len(again.json()["templates"]) == 20
    only = World()
    only.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    assert only.call("POST", T + "/whatsapp/templates/first?languages=en,te", "a_owner").json()["created"] == 10


def test_submit_all_sends_each_draft_to_meta_once_and_sync_reads_its_decision_back(w: World) -> None:
    w.call("POST", T + "/whatsapp/templates/first", "a_owner")
    done = w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()
    assert done["submitted"] == 20 and done["refused"] == 0 and len(w.graph.templates_created) == 20
    assert all(t["status"] == "submitted" for t in done["templates"])
    assert w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()["submitted"] == 0, "nothing is sent twice"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_owner").json()["changed"] == 0, "still in review"
    w.graph.approve_template("visit_reminder", "en")
    w.graph.approve_template("visit_reminder", "te")
    synced = w.call("POST", T + "/whatsapp/templates/sync", "a_owner").json()
    assert synced["changed"] == 2
    status = {(t["name"], t["language"]): t["status"] for t in synced["templates"]}
    assert status[("visit_reminder", "en")] == "approved" and status[("visit_reminder", "te")] == "approved" and status[("visit_reminder", "hi")] == "submitted"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_owner").json()["changed"] == 0, "idempotent"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_sales").status_code == 403


def test_without_a_connected_number_nothing_goes_to_meta() -> None:
    bare = World()
    bare.call("POST", T + "/whatsapp/templates/first", "a_owner")
    r: Any = bare.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner")
    assert r.status_code == 409 and r.json()["error"]["code"] == "whatsapp_not_configured" and bare.graph.templates_created == []
    assert bare.call("POST", T + "/whatsapp/templates/sync", "a_owner").status_code == 409
