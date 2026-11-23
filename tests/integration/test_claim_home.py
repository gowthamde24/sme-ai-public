"""T007 M2 / 2: THE CLAIM HOME, on the real stack. A claim a run proposes about a LEAD is stored on the lead's company, where the
ICP score looks; it changes the lead's score only after a human ACCEPTS it; a rejected or unreviewed one never does; claims stored
the old way (on the lead) still reach the score. Attacks go straight to PostgREST, skipping our API. The score is the REAL
review-queue score (the real reader and the real pure scorer)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

# `on` (imported below) is the module fixture that turns agents on for the two tenants.
import operator_sql
import pytest
from conftest import bearer
from crm_support import Tenant, World, create_payload
from evidence_support import code_of, pg, uid
from suppression_support import key_contact
from test_agent_direct_postgrest import on, rpc  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]
ICP_TEMPLATE = json.loads(
    (ROOT / "config" / "icp" / "silk-wholesale.v1.json").read_text(encoding="utf-8")
)
PREDICATES = (
    "array['selftest.observation','buyer_type','operating_status','size_band','order_scale']"
)


@pytest.fixture(scope="module")
def scoring(on: World) -> Iterator[World]:  # noqa: F811
    """The selftest agent may propose the scored predicates here (the Research Agent has them for real, in M4);
    an ICP profile is published for tenant A and B."""
    saved = operator_sql.sql(
        "select array_to_string(allowed_predicates, ',') from public.agent_definitions where agent_name = 'selftest'"
    )
    operator_sql.sql(
        f"update public.agent_definitions set allowed_predicates = {PREDICATES} where agent_name = 'selftest'"
    )
    for t in (on.a, on.b):
        r = on.client.post(
            f"/v1/tenants/{t.id}/icp-configs",
            json={"config": ICP_TEMPLATE},
            headers=bearer(t.users["owner"]),
        )
        assert r.status_code == 201, r.text
    try:
        yield on
    finally:
        operator_sql.sql(
            f"update public.agent_definitions set allowed_predicates = string_to_array('{saved}', ',') where agent_name = 'selftest'"
        )


# ------------------------------------------------------------------------------ plumbing
def make_lead(w: World, t: Tenant, *, with_company: bool = True) -> tuple[str, str | None]:
    """A fresh company and a lead on it (so one test's accepted claims never colour another's score)."""
    owner = t.users["owner"]
    company: str | None = None
    if with_company:
        company = w.call(owner, "POST", t, "companies", json=create_payload("companies", t)).json()[
            "id"
        ]
    lead = w.call(
        owner,
        "POST",
        t,
        "leads",
        json=create_payload("leads", t, uid(), company_id=company, contact_id=None),
    )
    assert lead.status_code == 201, lead.text
    return lead.json()["id"], company


def propose(
    w: World, t: Tenant, *, kind: str, target: str, predicate: str, value: str, user: str = "sales"
) -> tuple[str, str]:
    """One run: start, one note, one claim citing it. Returns (run id, claim id). The run is cancelled afterwards."""
    u = t.users[user]
    run = uid()
    r = rpc(
        w,
        u,
        "start_agent_run",
        p_run_id=run,
        p_tenant_id=t.id,
        p_agent_name="selftest",
        p_agent_version="it-1",
        p_target_kind=kind,
        p_target_id=target,
        p_input_sha256="a" * 64,
        p_input_refs={},
    )
    assert r.status_code == 200, r.text
    ev = rpc(
        w,
        u,
        "agent_write_evidence",
        p_run_id=run,
        p_step_key="e1",
        p_kind="note",
        p_snippet="DEMO agent note",
    )
    assert ev.status_code == 200, ev.text
    cl = rpc(
        w,
        u,
        "agent_write_claim",
        p_run_id=run,
        p_step_key="c1",
        p_predicate=predicate,
        p_value=value,
        p_evidence_ids=[ev.json()["evidence_id"]],
        p_stance="supports",
    )
    assert cl.status_code == 200, cl.text
    rpc(w, t.users["owner"], "cancel_agent_run", p_run_id=run)
    return run, str(cl.json()["claim_id"])


def review(
    w: World,
    t: Tenant,
    claim: str,
    decision: str,
    confidence: str | None = "high",
    reason: str | None = None,
) -> Any:
    body: dict[str, Any] = {"p_review_id": uid(), "p_claim_id": claim, "p_decision": decision}
    if confidence:
        body["p_confidence"] = confidence
    if reason:
        body["p_reason_code"] = reason
    return rpc(w, t.users["owner"], "review_claim", **body)


def score(w: World, t: Tenant, lead: str) -> int:
    """The lead's score as the REVIEW QUEUE computes it (unblinded)."""
    cursor: str | None = None
    for _ in range(40):
        r = w.client.get(
            f"/v1/tenants/{t.id}/leads/review-queue",
            params={"blind": "false", "limit": 100, **({"cursor": cursor} if cursor else {})},
            headers=bearer(t.users["sales"]),
        )
        assert r.status_code == 200, r.text
        page = r.json()
        for item in page["items"]:
            if item["lead_id"] == lead:
                assert isinstance(item["score"], int)
                return int(item["score"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    pytest.fail("the lead is not in the review queue")


def row(sql: str) -> str:
    return operator_sql.sql(sql)


# ------------------------------------------------------------------------------ where the claim lives
def test_a_lead_runs_claim_is_stored_on_the_leads_company_with_the_lead_as_provenance(
    scoring: World,
) -> None:
    w, t = scoring, scoring.a
    lead, company = make_lead(w, t)
    run, claim = propose(w, t, kind="lead", target=lead, predicate="buyer_type", value="saree_shop")
    got = row(
        f"select company_id || '|' || coalesce(lead_id::text, 'null') || '|' || source_lead_id || '|' || agent_run_id from public.claims where id = '{claim}'"
    )
    assert got == f"{company}|null|{lead}|{run}"
    assert row(f"select lead_id from public.agent_runs where id = '{run}'") == lead


def test_a_company_runs_claim_is_unchanged(scoring: World) -> None:
    w, t = scoring, scoring.a
    _, company = make_lead(w, t)
    assert company
    _, claim = propose(w, t, kind="company", target=company, predicate="size_band", value="medium")
    assert (
        row(
            f"select company_id || '|' || coalesce(source_lead_id::text, 'null') from public.claims where id = '{claim}'"
        )
        == f"{company}|null"
    )


# ------------------------------------------------------------------------------ the score
def test_a_new_claim_changes_the_score_only_after_a_human_accepts_it_and_never_if_rejected(
    scoring: World,
) -> None:
    w, t = scoring, scoring.a
    lead, _ = make_lead(w, t)
    before = score(w, t, lead)
    _, claim = propose(w, t, kind="lead", target=lead, predicate="buyer_type", value="saree_shop")
    assert score(w, t, lead) == before, "unaccepted: nothing changes"
    assert review(w, t, claim, "rejected", None, "incorrect").status_code == 200
    assert score(w, t, lead) == before, "rejected: nothing changes"
    assert review(w, t, claim, "accepted", "high").status_code == 200
    accepted = score(w, t, lead)
    assert accepted > before, (before, accepted)
    assert review(w, t, claim, "rejected", None, "outdated").status_code == 200
    assert score(w, t, lead) == before, (
        "the newest review wins: rejecting the accepted claim takes it back"
    )


def test_a_rejected_claim_never_reaches_the_score_and_an_accepted_one_does_not_leak_to_another_company(
    scoring: World,
) -> None:
    w, t = scoring, scoring.a
    lead_x, _ = make_lead(w, t)
    lead_y, _ = make_lead(w, t)
    base_y = score(w, t, lead_y)
    _, claim = propose(w, t, kind="lead", target=lead_x, predicate="buyer_type", value="saree_shop")
    assert review(w, t, claim, "accepted", "high").status_code == 200
    assert score(w, t, lead_y) == base_y, (
        "the claim is about one company: another company's lead is untouched"
    )


def test_a_claim_stored_the_old_way_on_the_lead_still_reaches_the_score(scoring: World) -> None:
    w, t = scoring, scoring.a
    lead, _ = make_lead(w, t)
    before = score(w, t, lead)
    run, _ = propose(
        w, t, kind="lead", target=lead, predicate="selftest.observation", value="DEMO"
    )  # a run id for the legacy row
    legacy = uid()
    operator_sql.sql(
        "select set_config('app.created_via', 'agent', false), set_config('app.agent_run_id', "
        f"'{run}', false); insert into public.claims (id, tenant_id, company_id, lead_id, predicate, value, confidence) "
        f"values ('{legacy}', '{t.id}', null, '{lead}', 'buyer_type', 'saree_shop', 'unverified')"
    )
    assert score(w, t, lead) == before, "the legacy row is unreviewed: nothing"
    assert review(w, t, legacy, "accepted", "low").status_code == 200
    assert score(w, t, lead) > before, (
        "an accepted lead-shaped row reaches the score through its lead's company"
    )
    count = pg(
        w.stack, t.users["sales"], "GET", f"/claims_for_scoring?id=eq.{legacy}&select=id,company_id"
    )
    assert count.status_code == 200 and len(count.json()) == 1, "counted once"


def test_a_lead_with_no_company_cannot_start_a_run_at_all(scoring: World) -> None:
    """Refused at START, before any run exists: no fetch and no model call can ever be made for it (T007 follow-up)."""
    w, t = scoring, scoring.a
    made = w.call(
        t.users["owner"],
        "POST",
        t,
        "leads",
        json=create_payload("leads", t, uid(), company_id=None, contact_id=None),
    )
    assert made.status_code == 201, (
        "a lead may exist without a company; the agent refuses it, not the CRM"
    )
    lead = made.json()["id"]
    run = uid()
    r = rpc(
        w,
        t.users["sales"],
        "start_agent_run",
        p_run_id=run,
        p_tenant_id=t.id,
        p_agent_name="selftest",
        p_agent_version="it-1",
        p_target_kind="lead",
        p_target_id=lead,
        p_input_sha256="a" * 64,
        p_input_refs={},
    )
    assert r.status_code in (400, 403, 409) and code_of(r) == "23503", (r.status_code, r.text)
    assert r.json()["message"] == "invalid reference" and lead not in r.text
    assert row(f"select count(*) from public.agent_runs where id = '{run}'") == "0"
    assert (
        row(
            f"select count(*) from public.agent_cost_reservations where tenant_id = '{t.id}' and run_id = '{run}'"
        )
        == "0"
    )
    # identical to an unknown lead
    ghost = rpc(
        w,
        t.users["sales"],
        "start_agent_run",
        p_run_id=uid(),
        p_tenant_id=t.id,
        p_agent_name="selftest",
        p_agent_version="it-1",
        p_target_kind="lead",
        p_target_id=uid(),
        p_input_sha256="a" * 64,
        p_input_refs={},
    )
    assert (ghost.status_code, code_of(ghost), ghost.json()["message"]) == (
        r.status_code,
        "23503",
        "invalid reference",
    )


# ------------------------------------------------------------------------------ erasure still works around source_lead_id
def request_and_execute_erasure(w: World, t: Tenant, scope: str, subject: str) -> None:
    owner, rid = t.users["owner"], uid()
    if scope == "contact":
        key_contact(w, owner, subject)  # ADR 0020: a contact that holds an identifier needs a recorded suppression key
    req = rpc(
        w,
        owner,
        "request_erasure",
        p_request_id=rid,
        p_tenant_id=t.id,
        p_scope=scope,
        p_subject_id=subject,
    )
    assert req.status_code == 200, req.text
    done = rpc(w, owner, "execute_erasure", p_request_id=rid, p_dry_run=False)
    assert done.status_code == 200, done.text


def test_erasing_a_company_whose_lead_runs_left_claims_with_a_source_lead_succeeds(
    scoring: World,
) -> None:
    w, t = scoring, scoring.a
    lead, company = make_lead(w, t)
    assert company
    run, claim = propose(
        w, t, kind="lead", target=lead, predicate="buyer_type", value="saree_shop Qxjv Canary"
    )
    assert review(w, t, claim, "accepted", "high").status_code == 200
    before = row(f"select count(*) from public.claims where tenant_id = '{t.id}'")
    request_and_execute_erasure(w, t, "company", company)
    after = row(
        f"select value || '|' || company_id || '|' || source_lead_id || '|' || agent_run_id from public.claims where id = '{claim}'"
    )
    value, home, source, agent_run = after.split("|")
    assert "Qxjv" not in value and "Canary" not in value, "the claim's free text is anonymised"
    assert (home, source, agent_run) == (company, lead, run), "the ids (provenance) are untouched"
    assert row(f"select count(*) from public.claims where tenant_id = '{t.id}'") == before, (
        "nothing was deleted"
    )
    assert row(f"select count(*) from public.leads where id = '{lead}'") == "1"


def test_erasing_the_contact_of_a_lead_with_agent_claims_succeeds_and_leaves_the_company_claims_alone(
    scoring: World,
) -> None:
    w, t = scoring, scoring.a
    owner = t.users["owner"]
    company = w.call(owner, "POST", t, "companies", json=create_payload("companies", t)).json()[
        "id"
    ]
    contact = w.call(
        owner, "POST", t, "contacts", json=create_payload("contacts", t, company_id=company)
    ).json()["id"]
    lead = w.call(
        owner,
        "POST",
        t,
        "leads",
        json=create_payload("leads", t, uid(), company_id=company, contact_id=contact),
    ).json()["id"]
    _, claim = propose(w, t, kind="lead", target=lead, predicate="buyer_type", value="saree_shop")
    request_and_execute_erasure(w, t, "contact", contact)
    assert (
        row(f"select value || '|' || source_lead_id from public.claims where id = '{claim}'")
        == f"saree_shop|{lead}"
    )


# ------------------------------------------------------------------------------ a real session cannot forge an agent claim
def test_a_signed_in_session_that_sets_the_agent_settings_still_writes_manual_claims_only(
    scoring: World,
) -> None:
    w, t = scoring, scoring.a
    lead, company = make_lead(w, t)
    run, _ = propose(w, t, kind="lead", target=lead, predicate="buyer_type", value="saree_shop")
    owner = str(t.users["owner"].id)
    settings = f"select set_config('app.created_via', 'agent', true), set_config('app.agent_run_id', '{run}', true); "
    # columns a client may not write are refused whatever the settings say
    for columns, values in (
        ("created_via, agent_run_id", f"'agent', '{run}'"),
        ("source_lead_id", f"'{lead}'"),
        ("created_via, agent_run_id, source_lead_id", f"'agent', '{run}', '{lead}'"),
    ):
        code, out, err = operator_sql.sql_result(
            operator_sql.as_user(
                owner,
                settings
                + (
                    f"insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, {columns}) "
                    f"values ('{uid()}', '{t.id}', '{company}', 'buyer_type', 'consumer', 'high', {values});"
                ),
            )
        )
        assert code != 0 and "permission denied" in err, (columns, err[:200])
    # the columns a client may write give a MANUAL claim: no run, no source lead
    forged = uid()
    code, out, err = operator_sql.sql_result(
        operator_sql.as_user(
            owner,
            settings
            + (
                f"insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) "
                f"values ('{forged}', '{t.id}', '{company}', 'buyer_type', 'saree_shop', 'low');"
            ),
        )
    )
    assert code == 0, err
    assert (
        row(
            f"select created_via || '|' || coalesce(agent_run_id::text, 'null') || '|' || coalesce(source_lead_id::text, 'null') from public.claims where id = '{forged}'"
        )
        == "manual|null|null"
    )
    assert (
        row(f"select review_state from public.claims_effective where id = '{forged}'")
        == "not_applicable"
    )


# ------------------------------------------------------------------------------ attacks, straight at PostgREST
def test_another_tenants_lead_id_gets_the_generic_refusal_and_writes_nothing(
    scoring: World,
) -> None:
    w = scoring
    lead_a, _ = make_lead(w, w.a)
    before = row(f"select count(*) from public.claims where tenant_id = '{w.b.id}'")
    for tenant, user in ((w.b, "sales"), (w.b, "owner")):
        r = rpc(
            w,
            tenant.users[user],
            "start_agent_run",
            p_run_id=uid(),
            p_tenant_id=tenant.id,
            p_agent_name="selftest",
            p_agent_version="it-1",
            p_target_kind="lead",
            p_target_id=lead_a,
            p_input_sha256="a" * 64,
            p_input_refs={},
        )
        assert r.status_code in (400, 403, 409) and code_of(r) == "23503", (r.status_code, r.text)
        assert lead_a not in r.text and w.a.id not in r.text
    r = rpc(
        w,
        w.b.users["sales"],
        "start_agent_run",
        p_run_id=uid(),
        p_tenant_id=w.a.id,
        p_agent_name="selftest",
        p_agent_version="it-1",
        p_target_kind="lead",
        p_target_id=lead_a,
        p_input_sha256="a" * 64,
        p_input_refs={},
    )
    assert (
        r.status_code in (401, 403)
        and code_of(r) == "42501"
        and r.json().get("message") == "agent action not permitted"
    )
    assert row(f"select count(*) from public.claims where tenant_id = '{w.b.id}'") == before


def test_a_client_cannot_write_or_rewrite_a_claim_or_name_a_source_lead(scoring: World) -> None:
    w, t = scoring, scoring.a
    lead, company = make_lead(w, t)
    _, claim = propose(w, t, kind="lead", target=lead, predicate="buyer_type", value="saree_shop")
    owner = t.users["owner"]
    forged = {
        "id": uid(),
        "tenant_id": t.id,
        "company_id": company,
        "predicate": "buyer_type",
        "value": "saree_shop",
        "confidence": "high",
        "source_lead_id": lead,
        "created_via": "agent",
    }
    for who in ("owner", "sales"):
        r = pg(w.stack, t.users[who], "POST", "/claims", json=forged, representation=False)
        assert r.status_code in (401, 403), (who, r.status_code, r.text)
    for patch in (
        {"source_lead_id": None},
        {"company_id": w.b.rows["companies"]["id"]},
        {"value": "consumer"},
        {"lead_id": lead},
    ):
        r = pg(w.stack, owner, "PATCH", f"/claims?id=eq.{claim}", json=patch, representation=False)
        assert r.status_code in (401, 403), (patch, r.status_code)
    assert (
        row(
            f"select company_id || '|' || source_lead_id || '|' || value from public.claims where id = '{claim}'"
        )
        == f"{company}|{lead}|saree_shop"
    )
    # the write function has no parameter that names a company, a lead or a source lead
    for extra in ({"p_company_id": company}, {"p_lead_id": lead}, {"p_source_lead_id": lead}):
        run = uid()
        rpc(
            w,
            t.users["sales"],
            "start_agent_run",
            p_run_id=run,
            p_tenant_id=t.id,
            p_agent_name="selftest",
            p_agent_version="it-1",
            p_target_kind="company",
            p_target_id=company,
            p_input_sha256="a" * 64,
            p_input_refs={},
        )
        r = rpc(
            w,
            t.users["sales"],
            "agent_write_claim",
            p_run_id=run,
            p_step_key="x",
            p_predicate="buyer_type",
            p_value="saree_shop",
            p_evidence_ids=[uid()],
            **extra,
        )
        assert r.status_code in (400, 404) and code_of(r) in ("PGRST202", "42883"), (
            extra,
            r.status_code,
            r.text,
        )
        rpc(w, t.users["owner"], "cancel_agent_run", p_run_id=run)


def test_the_views_show_each_tenant_only_its_own_claims(scoring: World) -> None:
    w = scoring
    lead, company = make_lead(w, w.a)
    _, claim = propose(w, w.a, kind="lead", target=lead, predicate="buyer_type", value="saree_shop")
    assert review(w, w.a, claim, "accepted", "high").status_code == 200
    for view in ("claims_effective", "claims_for_scoring"):
        mine = pg(w.stack, w.a.users["sales"], "GET", f"/{view}?id=eq.{claim}&select=id")
        theirs = pg(w.stack, w.b.users["owner"], "GET", f"/{view}?id=eq.{claim}&select=id")
        anon = pg(w.stack, None, "GET", f"/{view}?id=eq.{claim}&select=id")
        assert mine.status_code == 200 and len(mine.json()) == 1, view
        assert theirs.status_code == 200 and theirs.json() == [], view
        assert anon.status_code in (401, 403), view
