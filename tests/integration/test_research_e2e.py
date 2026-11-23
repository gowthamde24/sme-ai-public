"""T007: THE END-TO-END SCORE TEST, on the real stack. A research run (scripted model, synthetic fixture sites) started through OUR API
proposes claims; they change a lead's score only after a human ACCEPTS them, a rejected or unreviewed one never does, the newest
review wins, and two leads of ONE company see the same accepted claim. The score is the REAL review-queue score (the real reader and
the real pure scorer)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import operator_sql
import pytest
from conftest import bearer
from crm_support import Tenant, World
from evidence_support import pg, uid
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import build_runtime, create_app

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "web"
ICP_TEMPLATE = json.loads(
    (ROOT / "config" / "icp" / "silk-wholesale.v1.json").read_text(encoding="utf-8")
)


@pytest.fixture(scope="module")
def api(crm_world: World) -> Iterator[tuple[TestClient, World]]:
    """The application with agents on, the scripted model, and the research agent on the synthetic sites; the operator turns the
    research switches on for tenant A and B and restores them afterwards."""
    w = crm_world
    saved = operator_sql.snapshot_switches()
    saved_research = operator_sql.sql(
        "select allowed_tenants from public.agent_definitions where agent_name = 'research'"
    )
    saved_rate = operator_sql.sql(
        "select limit_value from public.agent_limits where limit_key = 'max_runs_per_hour'"
    )
    operator_sql.sql(
        "update public.agent_limits set limit_value = 100000 where limit_key = 'max_runs_per_hour'"
    )
    tenants = ",".join(f"'{t.id}'" for t in (w.a, w.b))
    operator_sql.sql(
        "update public.platform_flags set enabled = true; "
        f"update public.agent_definitions set allowed_tenants = coalesce(allowed_tenants, '{{}}') || array[{tenants}]::uuid[] where agent_name in ('research', 'selftest')"
    )
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=w.stack.url,
        supabase_anon_key=w.stack.anon_key,
        agents_enabled=True,
        llm_provider="fake",
        research_fixture_dir=str(FIXTURES),
    )
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.agents is not None and runtime.agents.research_available
    try:
        with TestClient(create_app(settings, runtime=runtime)) as client:
            for t in (w.a, w.b):
                r = client.put(
                    f"/v1/tenants/{t.id}/agent-settings",
                    json={"enabled": True},
                    headers=bearer(t.users["owner"]),
                )
                assert r.status_code == 200, r.text
                r = client.post(
                    f"/v1/tenants/{t.id}/icp-configs",
                    json={"config": ICP_TEMPLATE},
                    headers=bearer(t.users["owner"]),
                )
                assert r.status_code == 201, r.text
            yield client, w
    finally:
        operator_sql.restore_switches(saved)
        operator_sql.sql(
            f"update public.agent_definitions set allowed_tenants = '{saved_research}'::uuid[] where agent_name = 'research'"
        )
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )


def company(client: TestClient, t: Tenant, name: str, website: str | None) -> str:
    cid = uid()
    body: dict[str, Any] = {"id": cid, "name": name, "city": "Chennai"}
    if website:
        body["website"] = website
    r = client.post(f"/v1/tenants/{t.id}/companies", json=body, headers=bearer(t.users["owner"]))
    assert r.status_code == 201, r.text
    return cid


def lead(client: TestClient, t: Tenant, company_id: str | None) -> str:
    lid = uid()
    body: dict[str, Any] = {"id": lid}
    if company_id:
        body["company_id"] = company_id
    r = client.post(f"/v1/tenants/{t.id}/leads", json=body, headers=bearer(t.users["owner"]))
    assert r.status_code == 201, r.text
    return lid


def queue_item(client: TestClient, t: Tenant, lead_id: str) -> dict[str, Any]:
    cursor: str | None = None
    for _ in range(60):
        r = client.get(
            f"/v1/tenants/{t.id}/leads/review-queue",
            params={"blind": "false", "limit": 100, **({"cursor": cursor} if cursor else {})},
            headers=bearer(t.users["sales"]),
        )
        assert r.status_code == 200, r.text
        page = r.json()
        for item in page["items"]:
            if item["lead_id"] == lead_id:
                return dict(item)
        cursor = page["next_cursor"]
        if not cursor:
            break
    pytest.fail("the lead is not in the review queue")


def score(client: TestClient, t: Tenant, lead_id: str) -> int:
    value = queue_item(client, t, lead_id)["score"]
    assert isinstance(value, int)
    return value


def flags(client: TestClient, t: Tenant, lead_id: str) -> set[str]:
    snapshot = queue_item(client, t, lead_id)["snapshot"] or {}
    found = snapshot.get("flags") or snapshot.get("exclusion_flags") or []
    return {str(f["id"] if isinstance(f, dict) else f) for f in found}


def research(client: TestClient, t: Tenant, lead_id: str) -> dict[str, Any]:
    r = client.post(
        f"/v1/tenants/{t.id}/agent-runs",
        json={"id": uid(), "agent": "research", "target_kind": "lead", "target_id": lead_id},
        headers=bearer(t.users["sales"]),
    )
    assert r.status_code == 202, r.text
    run_id = r.json()["id"]
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        run = client.get(
            f"/v1/tenants/{t.id}/agent-runs/{run_id}", headers=bearer(t.users["sales"])
        ).json()
        if run["status"] != "running":
            return dict(run)
        time.sleep(0.2)
    pytest.fail("the research run did not finish")


def suggestions(client: TestClient, t: Tenant, lead_id: str) -> dict[str, dict[str, Any]]:
    r = client.get(f"/v1/tenants/{t.id}/leads/{lead_id}/claims", headers=bearer(t.users["sales"]))
    assert r.status_code == 200, r.text
    return {c["predicate"]: dict(c) for c in r.json()}


def review(
    client: TestClient,
    t: Tenant,
    claim_id: str,
    decision: str,
    confidence: str | None = None,
    reason: str | None = None,
) -> None:
    body: dict[str, Any] = {"id": uid(), "decision": decision}
    if confidence:
        body["confidence"] = confidence
    if reason:
        body["reason_code"] = reason
    r = client.post(
        f"/v1/tenants/{t.id}/claims/{claim_id}/reviews", json=body, headers=bearer(t.users["owner"])
    )
    assert r.status_code in (200, 201), r.text


# ------------------------------------------------------------------------------ the score
def factors(client: TestClient, t: Tenant, lead_id: str) -> dict[str, tuple[int, bool]]:
    snapshot = queue_item(client, t, lead_id)["snapshot"] or {}
    return {f["id"]: (f["points"], f["unknown"]) for f in snapshot["factors"]}


def test_an_accepted_claim_changes_the_score_a_rejected_one_does_not_and_two_leads_of_one_company_agree(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    c1 = company(client, t, "Saree House", "https://saree-house.test/")
    lead_a, lead_b = lead(client, t, c1), lead(client, t, c1)  # TWO leads at ONE company
    base_a, base_b = score(client, t, lead_a), score(client, t, lead_b)
    assert base_a == base_b
    assert factors(client, t, lead_a)["buyer_type_fit"] == (0, True), (
        "nothing is known about the buyer type yet"
    )

    run = research(client, t, lead_a)
    assert run["status"] == "succeeded" and run["error_code"] is None, run
    assert run["lead_id"] == lead_a
    found = suggestions(client, t, lead_a)
    assert {p: found[p]["value"] for p in ("buyer_type", "order_scale")} == {
        "buyer_type": "wholesaler",
        "order_scale": "five_or_more_per_order",
    }
    assert all(
        c["review_state"] == "unreviewed" and c["confidence"] == "unverified"
        for c in found.values()
    )
    assert score(client, t, lead_a) == base_a and score(client, t, lead_b) == base_b, (
        "unreviewed: nothing moves, for either lead"
    )

    # ACCEPT the buyer type: its factor is exactly the profile's points for "wholesaler" (20 of 20), for BOTH leads of the company
    review(client, t, found["buyer_type"]["id"], "accepted", "high")
    fa, fb = factors(client, t, lead_a), factors(client, t, lead_b)
    assert fa["buyer_type_fit"] == fb["buyer_type_fit"] == (20, False), (
        "two leads of one company see the same accepted claim"
    )
    # the evidence a lead run writes stays linked to THAT lead (ADR 0013): only its evidence-quality factor differs
    assert score(client, t, lead_b) == base_b + 20
    assert score(client, t, lead_a) == base_a + 20 + fa["evidence_quality"][0]
    after_buyer_a, after_buyer_b = score(client, t, lead_a), score(client, t, lead_b)

    review(client, t, found["order_scale"]["id"], "accepted", "high")
    fa, fb = factors(client, t, lead_a), factors(client, t, lead_b)
    assert fa["business_scale"] == fb["business_scale"] == (15, False)
    assert (
        score(client, t, lead_a) > after_buyer_a and score(client, t, lead_b) == after_buyer_b + 15
    )

    review(client, t, found["order_scale"]["id"], "rejected", None, "outdated")
    assert (
        factors(client, t, lead_b)["business_scale"] == (0, True)
        and score(client, t, lead_b) == after_buyer_b
    ), "the newest review wins: rejecting takes it back"
    review(client, t, found["buyer_type"]["id"], "rejected", None, "incorrect")
    assert score(client, t, lead_b) == base_b, (
        "everything rejected: the other lead's score is exactly where it started"
    )
    assert factors(client, t, lead_a)["buyer_type_fit"] == (0, True)


def test_a_rejected_claim_never_moves_the_score_and_a_closed_business_raises_the_flag_only_when_accepted(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    cid = company(client, t, "Old Silk Emporium", "https://closed-shop.test/")
    lid = lead(client, t, cid)
    base, base_flags = score(client, t, lid), flags(client, t, lid)
    run = research(client, t, lid)
    assert run["status"] == "succeeded", run
    found = suggestions(client, t, lid)
    assert found["operating_status"]["value"] == "closed"
    assert score(client, t, lid) == base and flags(client, t, lid) == base_flags, (
        "unreviewed: no flag"
    )
    review(client, t, found["operating_status"]["id"], "rejected", None, "incorrect")
    assert score(client, t, lid) == base and "closed_or_inactive" not in flags(client, t, lid), (
        "rejected: no flag, no change"
    )
    review(client, t, found["operating_status"]["id"], "accepted", "high")
    assert "closed_or_inactive" in flags(client, t, lid), (
        "accepted: the business-closed flag is raised"
    )
    review(client, t, found["operating_status"]["id"], "rejected", None, "outdated")
    assert "closed_or_inactive" not in flags(client, t, lid) and score(client, t, lid) == base, (
        "the newest review wins"
    )


def test_a_site_that_says_nothing_gives_no_suggestion_and_no_score_change(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    cid = company(
        client, t, "Plain Silks", "https://fabricate.test/"
    )  # a page that says nothing the profile reads
    lid = lead(client, t, cid)
    base = score(client, t, lid)
    run = research(client, t, lid)
    assert run["status"] == "succeeded" and suggestions(client, t, lid) == {}
    assert score(client, t, lid) == base


def test_the_research_runs_evidence_is_the_leads_own_page_and_a_verbatim_quote(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    cid = company(client, t, "Saree House", "https://saree-house.test/")
    lid = lead(client, t, cid)
    research(client, t, lid)
    rows = operator_sql.sql(
        "select coalesce(json_agg(json_build_array(e.kind, e.provider, e.url, e.snippet, e.created_via)), '[]') "
        f"from public.evidence e where e.tenant_id = '{t.id}' and e.agent_run_id in (select id from public.agent_runs where lead_id = '{lid}')"
    )
    evidence = json.loads(rows)
    assert evidence, "the run recorded evidence"
    page = (FIXTURES / "saree-house.test" / "index.html").read_text() + (
        FIXTURES / "saree-house.test" / "about.html"
    ).read_text()
    for kind, provider, url, snippet, via in evidence:
        assert (kind, provider, via) == ("web_page", "agent.research", "agent")
        assert url.startswith("https://saree-house.test/") and "?" not in url
        assert snippet in page.replace("\n", " ") or snippet.split(" - ")[0] in page


# ------------------------------------------------------------------------------ refused before any run
def test_a_lead_with_no_company_and_a_company_with_no_website_are_refused_before_any_run(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    orphan = lead(client, t, None)
    r = client.post(
        f"/v1/tenants/{t.id}/agent-runs",
        json={"id": uid(), "agent": "research", "target_kind": "lead", "target_id": orphan},
        headers=bearer(t.users["sales"]),
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "lead_has_no_company", r.text
    nosite = company(client, t, "No Site Ltd", None)
    r = client.post(
        f"/v1/tenants/{t.id}/agent-runs",
        json={"id": uid(), "agent": "research", "target_kind": "company", "target_id": nosite},
        headers=bearer(t.users["sales"]),
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "company_has_no_website", r.text
    assert (
        operator_sql.sql(
            f"select count(*) from public.agent_runs where tenant_id = '{t.id}' and company_id = '{nosite}'"
        )
        == "0"
    )


def test_the_research_agent_is_off_for_a_tenant_the_operator_did_not_allow(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.b
    cid = company(client, t, "Saree House", "https://saree-house.test/")
    lid = lead(client, t, cid)
    operator_sql.sql(
        f"update public.agent_definitions set allowed_tenants = array_remove(allowed_tenants, '{t.id}'::uuid) where agent_name = 'research'"
    )
    try:
        r = client.post(
            f"/v1/tenants/{t.id}/agent-runs",
            json={"id": uid(), "agent": "research", "target_kind": "lead", "target_id": lid},
            headers=bearer(t.users["sales"]),
        )
        assert r.status_code == 409 and r.json()["error"]["code"] == "agents_disabled", r.text
    finally:
        operator_sql.sql(
            f"update public.agent_definitions set allowed_tenants = allowed_tenants || '{t.id}'::uuid where agent_name = 'research'"
        )


def test_a_second_tenant_never_sees_the_first_tenants_research(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    cid = company(client, w.a, "Saree House", "https://saree-house.test/")
    lid = lead(client, w.a, cid)
    research(client, w.a, lid)
    leak = pg(
        w.stack, w.b.users["owner"], "GET", "/evidence?provider=eq.agent.research&select=id,url"
    )
    assert leak.status_code == 200
    mine = {e["id"] for e in leak.json()}
    ours = operator_sql.sql(
        f"select coalesce(json_agg(id), '[]') from public.evidence where tenant_id = '{w.a.id}' and provider = 'agent.research'"
    )
    assert not (mine & set(json.loads(ours))), "tenant B reads none of tenant A's research evidence"


_ = dataclasses


# ------------------------------------------------------------------------------ the reviewer's screen (T007 M3): the API behind it
HOSTILE_QUOTE = (
    '<img src=x onerror=alert(1)> <script>alert(2)</script> javascript:alert(3) "q" &lt;b&gt;'
)


def agent_claims(
    client: TestClient, t: Tenant, user: str = "owner", state: str = "unreviewed"
) -> list[dict[str, Any]]:
    r = client.get(
        f"/v1/tenants/{t.id}/agent-claims",
        params={"state": state, "limit": 100},
        headers=bearer(t.users[user]),
    )
    assert r.status_code == 200, r.text
    return [dict(c) for c in r.json()]


def plant_agent_claim(
    t: Tenant, run_id: str, company_id: str, lead_id: str, predicate: str, value: str, quote: str
) -> str:
    """A second agent claim (a different value) and its evidence, written the way the agent function writes them (the trusted role with
    the agent settings), so that a reviewer sees two suggestions that disagree."""
    evidence, claim, link = uid(), uid(), uid()
    operator_sql.sql(
        "select set_config('app.created_via', 'agent', false), set_config('app.agent_run_id', "
        f"'{run_id}', false); "
        f"insert into public.evidence (id, tenant_id, kind, provider, url, snippet) values ('{evidence}', '{t.id}', 'web_page', 'agent.research', 'https://saree-house.test/about', $q${quote}$q$); "
        f"insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, source_lead_id) values ('{claim}', '{t.id}', '{company_id}', '{predicate}', '{value}', 'unverified', '{lead_id}'); "
        f"insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) values ('{link}', '{t.id}', '{evidence}', '{claim}', 'supports')"
    )
    return claim


def test_the_reviewers_list_shows_each_claim_with_its_company_the_quote_and_the_source(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    cid = company(client, t, "Saree House Review", "https://saree-house.test/")
    lid = lead(client, t, cid)
    run = research(client, t, lid)
    assert run["status"] == "succeeded"
    mine = [c for c in agent_claims(client, t) if c["company_name"] == "Saree House Review"]
    assert {c["predicate"] for c in mine} == {"buyer_type", "order_scale", "size_band"}
    buyer = next(c for c in mine if c["predicate"] == "buyer_type")
    assert (
        buyer["review_state"] == "unreviewed"
        and buyer["created_via"] == "agent"
        and buyer["counts_toward_score"] is True
    )
    (e,) = buyer["evidence"]
    assert (e["kind"], e["provider"], e["stance"]) == ("web_page", "agent.research", "supports")
    assert e["host"] == "saree-house.test" and e["path"] == "/"
    assert "url" not in e, "a host and a path, never a link"
    page = (FIXTURES / "saree-house.test" / "index.html").read_text()
    assert (
        " ".join(e["quote"].split()) in " ".join(page.replace("<", " <").split())
        or e["quote"].split(" - ")[0] in page
    )
    # every member sees them (a viewer too); the list is the caller's own view, per tenant
    assert {c["id"] for c in agent_claims(client, t, "viewer")} >= {c["id"] for c in mine}
    assert all(c["id"] not in {x["id"] for x in agent_claims(client, w.b, "owner")} for c in mine)
    assert client.get(f"/v1/tenants/{t.id}/agent-claims").status_code == 401


def test_a_hostile_quote_comes_back_verbatim_as_json_data(api: tuple[TestClient, World]) -> None:
    client, w = api
    t = w.a
    cid = company(client, t, "Hostile Quote Co", "https://saree-house.test/")
    lid = lead(client, t, cid)
    run = research(client, t, lid)
    plant_agent_claim(t, run["id"], cid, lid, "buyer_type", "boutique", HOSTILE_QUOTE)
    listed = [c for c in agent_claims(client, t) if c["company_name"] == "Hostile Quote Co"]
    quotes = {e["quote"] for c in listed for e in c["evidence"]}
    assert HOSTILE_QUOTE in quotes, "the exact characters, as data"
    raw = client.get(
        f"/v1/tenants/{t.id}/agent-claims", params={"limit": 100}, headers=bearer(t.users["owner"])
    )
    assert raw.headers["content-type"].startswith("application/json")


def test_two_suggestions_that_disagree_are_both_listed_and_the_newest_review_wins(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    cid = company(client, t, "Conflict Co", "https://saree-house.test/")
    lid = lead(client, t, cid)
    base = score(client, t, lid)
    run = research(client, t, lid)
    plant_agent_claim(t, run["id"], cid, lid, "buyer_type", "consumer", "We sell to shoppers.")
    mine = [
        c
        for c in agent_claims(client, t)
        if c["company_name"] == "Conflict Co" and c["predicate"] == "buyer_type"
    ]
    assert {c["value"] for c in mine} == {"wholesaler", "consumer"}, (
        "side by side: both are in the list"
    )
    wholesaler = next(c for c in mine if c["value"] == "wholesaler")
    consumer = next(c for c in mine if c["value"] == "consumer")
    # accept one with a confidence; reject the other with NO reason (one tap)
    review(client, t, wholesaler["id"], "accepted", "high")
    r = client.post(
        f"/v1/tenants/{t.id}/claims/{consumer['id']}/reviews",
        json={"id": uid(), "decision": "rejected"},
        headers=bearer(t.users["owner"]),
    )
    assert r.status_code == 201, r.text
    states = {
        c["value"]: c["review_state"]
        for c in agent_claims(client, t, state="all")
        if c["company_name"] == "Conflict Co" and c["predicate"] == "buyer_type"
    }
    assert states == {"wholesaler": "accepted", "consumer": "rejected"}
    assert score(client, t, lid) > base
    # the newest review wins: reject the accepted one, accept the other
    r = client.post(
        f"/v1/tenants/{t.id}/claims/{wholesaler['id']}/reviews",
        json={"id": uid(), "decision": "rejected"},
        headers=bearer(t.users["owner"]),
    )
    assert r.status_code == 201, r.text
    states = {
        c["value"]: c["review_state"]
        for c in agent_claims(client, t, state="all")
        if c["company_name"] == "Conflict Co" and c["predicate"] == "buyer_type"
    }
    assert states["wholesaler"] == "rejected"
    # and the reason is OPTIONAL but, when given, a closed code
    r = client.post(
        f"/v1/tenants/{t.id}/claims/{consumer['id']}/reviews",
        json={"id": uid(), "decision": "rejected", "reason_code": "free text"},
        headers=bearer(t.users["owner"]),
    )
    assert r.status_code == 422
    r = client.post(
        f"/v1/tenants/{t.id}/claims/{consumer['id']}/reviews",
        json={"id": uid(), "decision": "rejected", "reason_code": "duplicate"},
        headers=bearer(t.users["owner"]),
    )
    assert r.status_code == 201, r.text


def test_only_an_owner_or_admin_can_review_and_a_rejection_alone_changes_nothing_else(
    api: tuple[TestClient, World],
) -> None:
    client, w = api
    t = w.a
    cid = company(client, t, "Role Co", "https://saree-house.test/")
    lid = lead(client, t, cid)
    base = score(client, t, lid)
    research(client, t, lid)
    claim_id = next(
        c["id"]
        for c in agent_claims(client, t)
        if c["company_name"] == "Role Co" and c["predicate"] == "buyer_type"
    )
    for role in ("sales", "viewer"):
        r = client.post(
            f"/v1/tenants/{t.id}/claims/{claim_id}/reviews",
            json={"id": uid(), "decision": "rejected"},
            headers=bearer(t.users[role]),
        )
        assert r.status_code == 403, (role, r.text)
    stranger = client.post(
        f"/v1/tenants/{t.id}/claims/{claim_id}/reviews",
        json={"id": uid(), "decision": "rejected"},
        headers=bearer(w.b.users["owner"]),
    )
    assert stranger.status_code in (403, 404)
    r = client.post(
        f"/v1/tenants/{t.id}/claims/{claim_id}/reviews",
        json={"id": uid(), "decision": "rejected"},
        headers=bearer(t.users["admin"]),
    )
    assert r.status_code == 201, r.text
    assert score(client, t, lid) == base, "a rejection moves no score"
