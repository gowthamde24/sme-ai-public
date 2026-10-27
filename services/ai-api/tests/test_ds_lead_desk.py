"""Night 4 extra, part E1: Lead Desk is the core of every business. The closed list of modules and the packs, the calls plans' names, and a school's refusal of money talk through the API. The database's rules are proved in
supabase/tests/database/129_ds_lead_desk_core.test.sql."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.outreach.repository import PostgrestOutreachRepository
from app.outreach.service import OutreachService
from app.tasks.errors import NotForSchoolsError
from tests.dr_outreach_fakes import FakeOutreachRepository
from tests.fakes import TENANT_A, auth, make_client

ROOT = Path(__file__).resolve().parents[3]
BASE = f"/v1/tenants/{TENANT_A.id}/outreach"


def test_lead_desk_is_in_the_closed_list_of_modules_and_no_pack_lists_it() -> None:
    modules = json.loads((ROOT / "packages" / "packs" / "modules.json").read_text(encoding="utf-8"))["modules"]
    desk = [m for m in modules if m["code"] == "lead_desk"]
    assert len(desk) == 1 and desk[0]["exists_today"] is False and desk[0]["guard"] == "flag", "a core module: the database switches it on, no pack version lists it"
    listed = []
    for pack_json in sorted((ROOT / "packages" / "packs").glob("*/pack.json")):
        if "lead_desk" in json.loads(pack_json.read_text(encoding="utf-8")).get("modules", []):
            listed.append(pack_json.parent.name)
    assert listed == [], "pack versions are immutable: the core module is not written into them"


def test_the_calls_plans_carry_the_lead_desk_names_and_the_web_copy_is_the_same_file() -> None:
    plans = json.loads((ROOT / "packages" / "plans" / "plans.json").read_text(encoding="utf-8"))
    names = {p["id"]: p["name"]["en"] for p in plans["plans"]}
    assert plans["version"] == 3
    assert names["calls_payg"] == "Pay as you go" and names["calls_300"] == "Lead Desk 300" and names["calls_1000"] == "Lead Desk 1,000"
    assert names["starter"] == "Starter" and names["growth"] == "Growth" and names["business"] == "Business", "the main plans keep their names"
    assert json.loads((ROOT / "apps" / "web" / "lib" / "plan" / "plans.draft.json").read_text(encoding="utf-8")) == plans


def test_a_schools_refusal_is_the_one_sentence_of_the_tasks_with_no_text_from_the_database() -> None:
    handler = lambda request: httpx.Response(400, json={"code": "SM951", "message": "words that must not travel"})  # noqa: E731
    repo = PostgrestOutreachRepository("http://db/rest/v1", "anon", client=httpx.Client(base_url="http://db/rest/v1", transport=httpx.MockTransport(handler)))
    with pytest.raises(NotForSchoolsError):
        repo.batch_plan("tok", uuid.uuid4(), {})


def test_the_api_answers_422_not_for_schools_on_a_plan_and_on_a_rule() -> None:
    class School(FakeOutreachRepository):
        def batch_plan(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
            raise NotForSchoolsError("SM951")

        def rule_save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
            raise NotForSchoolsError("SM951")

    client, _ = make_client(outreach=OutreachService(School()))
    plan = {"batch_id": str(uuid.uuid4()), "name": "Dues", "goal": "general", "channel": "call", "language": "en", "who": {"contact_ids": [str(uuid.uuid4())]}}
    r = client.post(f"{BASE}/batches", json=plan, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_for_schools" and "words" not in r.text
    rule = {"rule_id": str(uuid.uuid4()), "source": "website_form", "action": "call_within_minutes", "goal": "general", "channel": "call", "language": "en"}
    assert client.post(f"{BASE}/rules", json=rule, headers=auth("a_owner")).status_code == 422
