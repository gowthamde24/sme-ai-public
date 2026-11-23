"""Job CN on the real stack: the Requirement Analyst of a building-materials workspace. A run started through OUR API picks the materials version of the requirement agent from the workspace's modules (not from a pack
id), the scripted model proposes areas, thicknesses, the product and the site, deterministic code types the values, and the DATABASE stores them as unreviewed proposals after checking every quote against the stored
text and every key against the workspace's own vocabulary. A saree workspace keeps its own version and is refused the materials fields. Synthetic data only."""

# ruff: noqa: E501, S608

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from conftest import bearer
from crm_support import Tenant, World
from evidence_support import pg, uid
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import build_runtime, create_app

BODY = "Hello,\nNeed about 1,000 sq ft of 80 mm paver blocks for a driveway. Site is at Kukatpally Hyderabad. Laying also needed. Need it by 25 October 2026. 50% advance is fine."
SAREE_BODY = "Need 20 kanjivaram sarees in red. Deliver to Hyderabad."


@pytest.fixture(scope="module")
def api(eval_world: World) -> Iterator[tuple[TestClient, World]]:
    w = eval_world
    saved = operator_sql.snapshot_switches()
    saved_allowed = operator_sql.sql("select coalesce(array_to_string(allowed_tenants, ','), '') from public.agent_definitions where agent_name = 'requirement'")
    saved_rate = operator_sql.sql("select limit_value from public.agent_limits where limit_key = 'max_runs_per_hour'")
    operator_sql.sql("update public.agent_limits set limit_value = 100000 where limit_key = 'max_runs_per_hour'")
    operator_sql.sql(
        f"update packs.workspace_pack set pack_code = 'construction_materials', pack_version = (select max(version) from packs.pack_versions where code = 'construction_materials'), source = 'operator' where tenant_id = '{w.a.id}'"
    )
    operator_sql.sql(f"select app.apply_pack_fields('{w.a.id}', 'construction_materials', (select max(version) from packs.pack_versions where code = 'construction_materials'), '{w.a.users['owner'].id}')")
    for t in (w.a, w.b):
        operator_sql.sql(f"select app.operator_enable_requirement((select slug from public.tenants where id = '{t.id}'))")
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, api_env="development", supabase_url=w.stack.url, supabase_anon_key=w.stack.anon_key, agents_enabled=True, llm_provider="fake",
    )  # fmt: skip
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.agents is not None and runtime.enquiries is not None and runtime.packs is not None
    try:
        with TestClient(create_app(settings, runtime=runtime)) as client:
            for t in (w.a, w.b):
                r = client.put(f"/v1/tenants/{t.id}/agent-settings", json={"enabled": True}, headers=bearer(t.users["owner"]))
                assert r.status_code == 200, r.text
            yield client, w
    finally:
        operator_sql.restore_switches(saved)
        items = ",".join(f"'{a}'" for a in saved_allowed.split(",") if a)
        operator_sql.sql(f"update public.agent_definitions set allowed_tenants = array[{items}]::uuid[] where agent_name = 'requirement'")
        operator_sql.sql(f"update public.agent_limits set limit_value = {int(saved_rate)} where limit_key = 'max_runs_per_hour'")
        for t in (w.a, w.b):
            operator_sql.sql(f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{t.id}'")


def capture(w: World, t: Tenant, body: str) -> str:
    eid = uid()
    r = pg(w.stack, t.users["sales"], "POST", "/enquiries", json={"id": eid, "tenant_id": t.id, "lead_id": t.rows["leads"]["id"], "channel": "email", "received_at": "2026-10-05T10:00:00+00:00", "body": body}, representation=False)
    assert r.status_code == 201, r.text
    return eid


def run_agent(client: TestClient, t: Tenant, enquiry: str) -> dict[str, Any]:
    started = client.post(f"/v1/tenants/{t.id}/agent-runs", json={"id": uid(), "agent": "requirement", "target_kind": "enquiry", "target_id": enquiry}, headers=bearer(t.users["sales"]))
    assert started.status_code == 202, started.text
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        run = client.get(f"/v1/tenants/{t.id}/agent-runs/{started.json()['id']}", headers=bearer(t.users["sales"])).json()
        if run["status"] != "running":
            return dict(run)
        time.sleep(0.2)
    pytest.fail("the requirement run did not finish")


def stored(w: World, t: Tenant, enquiry: str) -> dict[tuple[int | None, str], dict[str, Any]]:
    reqs = pg(w.stack, t.users["sales"], "GET", f"/requirements?enquiry_id=eq.{enquiry}&status=eq.draft&select=id").json()
    if not reqs:
        return {}
    rows = pg(w.stack, t.users["sales"], "GET", f"/requirement_fields?requirement_id=eq.{reqs[0]['id']}&select=line_no,field_key,value_code,value_int,value_date,value_text,basis,certainty,quote,state,created_via").json()
    return {(r["line_no"], r["field_key"]): r for r in rows}


def test_a_materials_run_stores_typed_unreviewed_proposals_under_the_materials_version(api: tuple[TestClient, World]) -> None:
    client, w = api
    eid = capture(w, w.a, BODY)
    run = run_agent(client, w.a, eid)
    assert run["status"] == "succeeded" and run["error_code"] is None, run
    assert operator_sql.sql(f"select agent_version from public.agent_runs where id = '{run['id']}'") == "requirement-materials-1"
    got = stored(w, w.a, eid)
    area = got[(1, "area")]
    assert (area["value_int"], area["basis"], area["certainty"], area["state"], area["created_via"]) == (100000, "sq_ft", "implied", "proposed", "agent")  # "about": a person confirms
    assert (got[(1, "thickness")]["value_int"], got[(1, "thickness")]["basis"]) == (80, "mm")
    assert got[(1, "product_type")]["value_code"] == "paver_block" and got[(None, "application")]["value_code"] == "driveway"
    assert got[(None, "site_location")]["value_text"] == "Kukatpally Hyderabad" and got[(None, "laying")]["value_code"] == "yes"
    assert got[(None, "deadline")]["value_date"] == "2026-10-25" and got[(None, "payment_terms")]["value_int"] == 5000
    # every quote is words of the stored enquiry; the run is replay-safe and a second run over the same text changes nothing
    for f in got.values():
        assert " ".join(f["quote"].split()) in " ".join(BODY.split())
    again = run_agent(client, w.a, eid)
    assert again["status"] == "succeeded" and len(stored(w, w.a, eid)) == len(got)
    # the review view judges it by the materials rules: nothing is confirmable until a person confirms
    view = client.get(f"/v1/tenants/{w.a.id}/enquiries/{eid}/requirement", headers=bearer(w.a.users["sales"])).json()
    assert view["confirmable"] is False and {"low_certainty"} <= {f["kind"] for f in view["flags"]}
    assert any(q["code"] == "confirm_area" and "1,000 sq ft" in q["text"] for q in view["questions"])


def test_a_saree_workspace_keeps_its_own_version_and_never_stores_a_materials_field(api: tuple[TestClient, World]) -> None:
    client, w = api
    eid = capture(w, w.b, SAREE_BODY)
    run = run_agent(client, w.b, eid)
    assert run["status"] == "succeeded", run
    assert operator_sql.sql(f"select agent_version from public.agent_runs where id = '{run['id']}'") == "requirement-1"
    got = stored(w, w.b, eid)
    assert got[(1, "saree_type")]["value_code"] == "kanjivaram" and got[(None, "delivery_city")]["value_text"] == "Hyderabad"
    # the database itself refuses a materials key in a saree workspace
    refused = pg(w.stack, w.b.users["sales"], "POST", "/rpc/add_requirement_field", json={"p_enquiry_id": eid, "p_line": 1, "p_key": "area", "p_value_code": None, "p_value_int": 100000, "p_value_date": None, "p_value_text": None, "p_basis": "sq_ft", "p_quote": None, "p_start": None, "p_end": None})
    assert refused.status_code >= 400
    assert (1, "area") not in stored(w, w.b, eid)
