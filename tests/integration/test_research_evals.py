"""`make eval` (research): the Research Agent's containment gate with SCRIPTED models that obey every injection (no key, no network,
no provider), the synthetic fixture sites, and the real local stack. See research_eval.py for the invariants."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import agent_eval as ev
import operator_sql
import pytest
import research_eval as rev
from conftest import bearer
from crm_support import Tenant, World
from evidence_support import pg, uid

from app.agent_runs.repository import PostgrestAgentRunsRepository
from app.agents import runtime
from app.agents.db import AgentDb
from app.agents.inputs import input_sha256, model_input_from_company
from app.agents.registry import AGENTS

CASES = rev.load_cases()
RESEARCH = AGENTS["research"]
NAME, CITY = "Eval Research Target", "Mysuru"


class Ctx:
    def __init__(self, w: World, root: Path) -> None:
        self.w, self.root = w, root
        self.repo = PostgrestAgentRunsRepository(w.stack.rest, w.stack.anon_key)
        self.sales = w.a.users["sales"]
        self.names: dict[str, str] = {"TENANT": w.a.id, "FOREIGN_TENANT": w.b.id}

    def company_and_lead(self, tenant: Tenant, website: str | None) -> tuple[str, str]:
        company, lead = uid(), uid()
        body: dict[str, Any] = {"id": company, "name": NAME, "city": CITY}
        if website:
            body["website"] = website
        owner = tenant.users["owner"]
        r = self.w.client.post(
            f"/v1/tenants/{tenant.id}/companies", json=body, headers=bearer(owner)
        )
        assert r.status_code == 201, r.text
        r = self.w.client.post(
            f"/v1/tenants/{tenant.id}/leads",
            json={"id": lead, "company_id": company},
            headers=bearer(owner),
        )
        assert r.status_code == 201, r.text
        return company, lead

    def start(self, tenant: Tenant, company: str, lead: str, website: str | None) -> str:
        run_id = uid()
        digest = input_sha256(
            model_input_from_company({"name": NAME, "city": CITY, "website": website})
        )
        self.repo.start_run(
            self.sales.token,
            uuid.UUID(tenant.id),
            run_id=uuid.UUID(run_id),
            agent_name="research",
            agent_version="research-1",
            target_kind="lead",
            target_id=uuid.UUID(lead),
            input_sha256=digest,
            input_refs={"lead_id": lead, "company_id": company},
        )
        return run_id


@pytest.fixture(scope="module")
def ctx(crm_world: World, tmp_path_factory: pytest.TempPathFactory) -> Iterator[Ctx]:
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
    for t in (w.a, w.b):
        r = pg(
            w.stack,
            t.users["owner"],
            "POST",
            "/rpc/set_tenant_agents_enabled",
            json={"p_tenant_id": t.id, "p_enabled": True},
        )
        assert r.status_code == 200, r.text
    c = Ctx(w, rev.fixture_root(tmp_path_factory.mktemp("research-fixtures")))
    other_company, _ = c.company_and_lead(w.a, "https://other-eval.test/")
    r = w.client.post(
        f"/v1/tenants/{w.a.id}/companies/{other_company}/evidence",
        json={
            "id": uid(),
            "kind": "note",
            "reference": "note:eval-fixture",
            "snippet": "a person wrote this",
        },
        headers=bearer(w.a.users["owner"]),
    )
    assert r.status_code == 201, r.text
    c.names["MANUAL_EVIDENCE"] = r.json()["evidence"]["id"]
    try:
        yield c
    finally:
        operator_sql.restore_switches(saved)
        operator_sql.sql(
            f"update public.agent_definitions set allowed_tenants = '{saved_research}'::uuid[] where agent_name = 'research'"
        )
        operator_sql.sql(
            f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'"
        )


def run_case(c: Ctx, case: dict[str, Any]) -> list[str]:
    w = c.w
    host = case["host"]
    website = (
        case.get("company_website", f"https://{host}/")
        if "company_website" not in case
        else case["company_website"]
    )
    company, lead = c.company_and_lead(w.a, website)
    run_id = c.start(w.a, company, lead, website)
    names = {**c.names, "RUN": run_id, "OWN_COMPANY": company}
    before_a, before_b = ev.snapshot(w.a.id, run_id), ev.snapshot(w.b.id, rev.RUN_NONE)
    fetcher = rev.make_fetcher(case.get("fetcher", "plain"), c.root)
    violations: list[str] = []
    provider = None
    outcome = None
    try:
        if case["layer"] == "naive":
            violations += ev.run_naive(
                w.stack.rest, w.stack.anon_key, c.sales.token, case["steps"], names
            )
        else:
            provider = ev.build_provider(ev.resolve(case["script"], names))
            db = AgentDb(
                w.stack.rest,
                w.stack.anon_key,
                c.sales.token,
                uuid.UUID(run_id),
                claim_predicate=RESEARCH.claim_predicate,
            )
            try:
                result = runtime.AgentRunner(
                    db=db, llm=provider, spec=RESEARCH, fetcher=fetcher
                ).run()
                outcome = f"{result.status}/{result.error_code}"
            finally:
                db.close()
            violations += rev.request_violations(provider)
        violations += rev.check_research_invariants(
            tenant_a=w.a.id, tenant_b=w.b.id, run_id=run_id, company_id=company, lead_id=lead, host=host,
            before_a=before_a, before_b=before_b, fetcher=fetcher,
        )  # fmt: skip
        if case["layer"] != "naive":
            violations += rev.expectation_violations(
                case,
                run_id=run_id,
                tenant_a=w.a.id,
                before_a=before_a,
                provider=provider,
                fetcher=fetcher,
                outcome=outcome,
            )
        if (
            case.get("must_write")
            and ev.snapshot(w.a.id, run_id).tables["claims"] == before_a.tables["claims"]
        ):
            violations.append("C a legitimate write did not happen")
    finally:
        pg(
            w.stack,
            c.sales,
            "POST",
            "/rpc/cancel_agent_run",
            json={"p_run_id": run_id},
            representation=False,
        )
    return violations


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_the_hard_gate_holds_for_a_research_model_that_obeys(
    ctx: Ctx, case: dict[str, Any]
) -> None:
    violations = run_case(ctx, case)
    assert not violations, f"{case['id']} ({case['title']}):\n  " + "\n  ".join(violations)


def test_the_baseline_covers_every_case_and_the_suite_attacks_both_layers() -> None:
    baseline = json.loads((rev.EVALS / "baseline.json").read_text())["cases"]
    ids = {c["id"] for c in CASES}
    assert set(baseline) <= ids, f"cases were removed: {sorted(set(baseline) - ids)}"
    assert all(v == "pass" for v in baseline.values())
    assert {c["layer"] for c in CASES} == {"runner", "naive"}
    for needed in [f"W{n:02d}" for n in range(1, 12)] + ["L01", "L03", "N20"]:
        assert any(i.startswith(needed) for i in ids), f"{needed} is missing"


def test_the_checker_notices_a_planted_off_host_row_and_a_planted_claim(ctx: Ctx) -> None:
    """The invariants must be able to FAIL: plant what a broken guard would let through, as the trusted role, and they must say so."""
    w = ctx.w
    website = "https://saree-house.test/"
    company, lead = ctx.company_and_lead(w.a, website)
    run_id = ctx.start(w.a, company, lead, website)
    before_a, before_b = ev.snapshot(w.a.id, run_id), ev.snapshot(w.b.id, rev.RUN_NONE)
    fetcher = rev.make_fetcher("plain", ctx.root)
    try:
        assert (
            rev.check_research_invariants(
                tenant_a=w.a.id,
                tenant_b=w.b.id,
                run_id=run_id,
                company_id=company,
                lead_id=lead,
                host="saree-house.test",
                before_a=before_a,
                before_b=before_b,
                fetcher=fetcher,
            )
            == []
        )
        planted = uid()
        operator_sql.sql(
            "select set_config('app.created_via', 'agent', false), set_config('app.agent_run_id', "
            f"'{run_id}', false); insert into public.evidence (id, tenant_id, kind, provider, url, snippet) values "
            f"('{planted}', '{w.a.id}', 'web_page', 'agent.research', 'https://evil.test/x', 'a planted quote that is long enough'); "
            f"insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values ('{uid()}', '{w.a.id}', '{company}', 'buyer_type', 'Free text', 'unverified')"
        )
        bad = rev.check_research_invariants(
            tenant_a=w.a.id,
            tenant_b=w.b.id,
            run_id=run_id,
            company_id=company,
            lead_id=lead,
            host="saree-house.test",
            before_a=before_a,
            before_b=before_b,
            fetcher=fetcher,
        )
        assert {v.split()[0] for v in bad} >= {"I4", "I5"}, bad
    finally:
        pg(
            w.stack,
            ctx.sales,
            "POST",
            "/rpc/cancel_agent_run",
            json={"p_run_id": run_id},
            representation=False,
        )
