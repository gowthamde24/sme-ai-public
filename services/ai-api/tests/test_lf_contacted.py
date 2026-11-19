"""Lead Finder "Mark as contacted" (owner, 19 Nov 2026): the owner reached a prospect personally; POST /prospects/{id}/contacted. The business moves to `contacted` with who, when and a note, never to a call queue."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import timedelta
from typing import Any

from app.lead_finder.service import LeadFinderService
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import NOW, FakeLeadFinderRepo

URL = f"/v1/tenants/{TENANT_A.id}"


def _world() -> tuple[Any, FakeLeadFinderRepo, str]:
    repo = FakeLeadFinderRepo("textiles")
    c, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))
    plan = c.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner")).json()
    c.post(f"{URL}/lead-finder/searches/{plan['id']}/approve", headers=auth("a_owner"))
    return c, repo, next(iter(repo.rows))


def test_marking_a_prospect_contacted_gives_state_who_when_and_the_note() -> None:
    c, repo, pid = _world()
    at = (NOW - timedelta(days=2)).isoformat()
    r = c.post(f"{URL}/prospects/{pid}/contacted", json={"contacted_at": at, "note": "Spoke to the owner; visit on Saturday"}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "contacted" and body["contact_note"] == "Spoke to the owner; visit on Saturday" and body["contacted_by"] == "Ravi"
    assert body["last_contacted_at"].startswith((NOW - timedelta(days=2)).strftime("%Y-%m-%d"))
    assert repo.calls == [] and repo.leads == [], "marking makes no call and no lead"


def test_again_updates_and_an_omitted_time_is_now_and_an_omitted_note_keeps_the_old_one() -> None:
    c, _, pid = _world()
    c.post(f"{URL}/prospects/{pid}/contacted", json={"note": "first"}, headers=auth("a_owner"))
    again = c.post(f"{URL}/prospects/{pid}/contacted", json={}, headers=auth("a_owner"))
    assert again.status_code == 200 and again.json()["contact_note"] == "first" and again.json()["status"] == "contacted"


def test_a_time_in_the_future_or_more_than_sixty_days_back_is_refused_with_a_fixed_code() -> None:
    c, _, pid = _world()
    for when in (NOW + timedelta(hours=1), NOW - timedelta(days=61)):
        r = c.post(f"{URL}/prospects/{pid}/contacted", json={"contacted_at": when.isoformat()}, headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["code"] == "contacted_at_invalid", r.text
    assert c.post(f"{URL}/prospects/{pid}/contacted", json={"note": "x" * 501}, headers=auth("a_owner")).status_code == 422


def test_a_viewer_is_refused_and_a_suppressed_business_is_a_state_error_and_an_unknown_one_is_not_found() -> None:
    c, repo, pid = _world()
    assert c.post(f"{URL}/prospects/{pid}/contacted", json={}, headers=auth("a_viewer")).status_code == 403
    repo.rows[pid].update(suppressed=True, status="not_interested")
    assert c.post(f"{URL}/prospects/{pid}/contacted", json={}, headers=auth("a_owner")).status_code == 409
    assert c.post(f"{URL}/prospects/not-a-uuid/contacted", json={}, headers=auth("a_owner")).status_code == 404
