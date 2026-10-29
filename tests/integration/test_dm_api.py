"""Job DM (C1 part) on the real local stack, through HTTP: outcomes, the AI assistant's settings, the school rule, and the pending trial. Real GoTrue, PostgREST and Postgres; our API in-process with the caller's own
token. All data is synthetic.

What this proves that the pgTAP files (114 to 118) and the unit tests cannot: the database's answers are accepted by the strict response models and conform to the generated contracts
(packages/contracts/outcomes.schema.json and assistant_settings.schema.json); the registered CHANNEL account's recording (the AI's) arrives as `recorded_by: ai`; a person's correction is kept apart from it."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import jsonschema
import operator_sql
import pytest
from conftest import bearer
from test_outbox_api import restore_clock

from app.outcomes.recorder import OutcomeRecorder
from app.outcomes.repository import PostgrestOutcomesRepository
from app.tenancy.repository import RepositoryError

ROOT = Path(__file__).resolve().parents[2]
OUTCOMES = json.loads((ROOT / "packages" / "contracts" / "outcomes.schema.json").read_text(encoding="utf-8"))
ASSISTANT = json.loads((ROOT / "packages" / "contracts" / "assistant_settings.schema.json").read_text(encoding="utf-8"))


def conforms(instance: Any, schema: dict[str, Any], definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": schema["$schema"], "$ref": f"#/$defs/{definition}", "$defs": schema["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


class Scene:
    channel_token = ""
    repo: PostgrestOutcomesRepository


@pytest.fixture(scope="module")
def scene(stack: Any, signup: Any) -> Iterator[Any]:
    restore_clock()
    channel = signup("dm-channel", mfa=False)
    operator_sql.sql(f"select app.operator_register_channel_agent('{channel.email}')")
    Scene.channel_token = channel.token
    Scene.repo = PostgrestOutcomesRepository(stack.rest, stack.anon_key)
    try:
        yield Scene
    finally:
        operator_sql.sql(f"select app.operator_remove_channel_agent('{channel.email}')")
        Scene.repo.close()


def first_lead(client: Any, user: Any, tenant: Any) -> tuple[str, str]:
    """(lead id, contact id) of the world's first lead with a contact."""
    rows = operator_sql.sql(f"select l.id || ',' || l.contact_id from public.leads l where l.tenant_id = '{tenant.id}' and l.contact_id is not null order by l.created_at limit 1").strip()
    lead, contact = rows.split(",")
    return lead, contact


def o(tenant: Any, tail: str = "") -> str:
    return f"/v1/tenants/{tenant.id}/outcomes{tail}"


def test_a_person_records_an_outcome_and_the_customer_page_and_totals_show_it(client: Any, eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    lead, contact = first_lead(client, a.users["owner"], a)
    source = str(uuid.uuid4())
    body = {"contact_id": contact, "lead_id": lead, "kind": "call", "source_id": source, "outcome": "positive", "category": "visit_booked", "reason": "Will visit on Saturday.", "occurred_at": datetime.now(UTC).isoformat()}
    r = client.post(o(a), json=body, headers=bearer(a.users["sales"]))
    assert r.status_code == 201, r.text
    conforms(r.json(), OUTCOMES, "OutcomeRecordedOut")
    assert r.json()["recorded_by"] == "person" and r.json()["replayed"] is False
    assert client.post(o(a), json=body, headers=bearer(a.users["sales"])).json()["replayed"] is True
    assert client.post(o(a), json=body, headers=bearer(a.users["viewer"])).status_code == 403
    page = client.get(f"/v1/tenants/{a.id}/customers/{lead}/outcomes", headers=bearer(a.users["sales"]))
    assert page.status_code == 200, page.text
    for item in page.json():
        conforms(item, OUTCOMES, "CustomerOutcomeOut")
    assert page.json()[0]["channel"] == "call" and page.json()[0]["result"] == "positive" and page.json()[0]["corrected"] is False
    assert client.get(f"/v1/tenants/{a.id}/customers/{lead}/outcomes", headers=bearer(a.users["viewer"])).status_code == 403
    listing = client.get(o(a), params={"contact_id": contact}, headers=bearer(a.users["viewer"]))
    conforms(listing.json(), OUTCOMES, "OutcomeListOut")
    totals = client.get(o(a, "/totals"), params={"day": datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()}, headers=bearer(a.users["viewer"]))
    conforms(totals.json(), OUTCOMES, "OutcomeTotalsOut")
    assert totals.json()["total"]["positive"] >= 1
    assert client.get(o(a), headers=bearer(eval_world.b.users["owner"])).status_code == 404, "another business"


def test_the_owner_corrects_and_what_the_ai_said_is_kept(client: Any, eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    lead, contact = first_lead(client, a.users["owner"], a)
    # the AI (the registered channel account) records a call outcome
    ai = scene.repo.record(scene.channel_token, a.id, {"contact_id": uuid.UUID(contact), "lead_id": uuid.UUID(lead), "kind": "call", "source_id": uuid.uuid4(), "outcome": "unclear", "category": "call_back_later", "reason": None, "occurred_at": datetime.now(UTC)})
    assert ai["recorded_by"] == "ai" and ai["ai_outcome"] == "unclear"
    fixed = client.post(o(a, f"/{ai['id']}/correct"), json={"result": "negative", "category": "too_costly"}, headers=bearer(a.users["admin"]))
    assert fixed.status_code == 200, fixed.text
    conforms(fixed.json(), OUTCOMES, "OutcomeOut")
    assert fixed.json()["corrected"] is True and fixed.json()["ai_outcome"] == "unclear" and fixed.json()["outcome"] == "negative"
    assert client.post(o(a, f"/{ai['id']}/correct"), json={"result": "unclear"}, headers=bearer(a.users["sales"])).status_code == 403
    # an Owner cannot record as the AI would for a follow-up nobody sent: the AI path needs a sent message
    with pytest.raises(RepositoryError):
        scene.repo.record(scene.channel_token, a.id, {"contact_id": uuid.UUID(contact), "lead_id": None, "kind": "whatsapp_followup", "source_id": uuid.uuid4(), "outcome": "positive", "category": "interested", "reason": None, "occurred_at": datetime.now(UTC)})


def test_the_reply_reader_records_through_the_registered_account(client: Any, eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    lead, contact = first_lead(client, a.users["owner"], a)
    operator_sql.sql(
        f"insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by) select '{uuid.uuid4()}', '{a.id}', '{lead}', '{contact}', 'whatsapp', 'Synthetic follow-up', 'en', 'followup', 'queued', 'auto_allowed', repeat('a', 64), id from auth.users where email = '{a.users['owner'].email}'"
    )
    operator_sql.sql(f"update public.outbox_messages set status = 'sent', sent_at = now() - interval '1 day', adapter = 'fake', adapter_message_id = 'dm-int-1' where tenant_id = '{a.id}' and body = 'Synthetic follow-up'")
    recorder = OutcomeRecorder(scene.repo)
    stored = {"tenant_id": str(a.id), "contact_id": contact, "lead_id": lead, "enquiry_id": str(uuid.uuid4())}
    assert recorder.after_inbound(scene.channel_token, stored, "Interested, please send photos", datetime.now(UTC) - timedelta(minutes=5)) is True
    rows = client.get(o(a), params={"contact_id": contact}, headers=bearer(a.users["owner"])).json()["items"]
    mine = [r for r in rows if r["source_id"] == stored["enquiry_id"]]
    assert len(mine) == 1 and mine[0]["recorded_by"] == "ai" and mine[0]["category"] == "interested" and mine[0]["reason"] == "Showed interest or asked for details."
    # a later "stop" in the same conversation turns the AI's positive word into a negative one
    stored2 = {**stored, "enquiry_id": str(uuid.uuid4())}
    assert recorder.after_inbound(scene.channel_token, stored2, "STOP", datetime.now(UTC)) is True
    again = client.get(o(a), params={"contact_id": contact}, headers=bearer(a.users["owner"])).json()["items"]
    changed = [r for r in again if r["source_id"] == stored["enquiry_id"]]
    assert len(changed) == 1 and changed[0]["outcome"] == "negative" and changed[0]["category"] == "not_interested"


def test_the_assistant_settings_defaults_save_preview_and_the_simulated_test_call(client: Any, eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    url = f"/v1/tenants/{a.id}/ai-assistant"
    got = client.get(url, headers=bearer(a.users["owner"]))
    assert got.status_code == 200, got.text
    conforms(got.json(), ASSISTANT, "AssistantOut")
    assert got.json()["saved"] is False and got.json()["settings"] == got.json()["defaults"]
    assert all("AI" in line for line in got.json()["intro"].values()), "the words AI assistant are always said"
    assert client.get(url, headers=bearer(a.users["sales"])).status_code == 403
    body = {**got.json()["settings"], "name": "Priya", "speed": 1.1, "max_discount_percent": 7}
    assert client.put(url, json=body, headers=bearer(a.users["admin"])).status_code == 403, "the Owner saves"
    saved = client.put(url, json=body, headers=bearer(a.users["owner"]))
    assert saved.status_code == 200, saved.text
    conforms(saved.json(), ASSISTANT, "AssistantOut")
    assert saved.json()["saved"] is True and saved.json()["settings"]["name"] == "Priya"
    bad = client.put(url, json={**body, "name": "<b>x</b>"}, headers=bearer(a.users["owner"]))
    assert bad.status_code == 422
    pre = client.get(f"{url}/preview", params={"language": "te", "style": "warm"}, headers=bearer(a.users["admin"]))
    conforms(pre.json(), ASSISTANT, "PreviewOut")
    assert "Priya" in pre.json()["text"] and "AI" in pre.json()["text"]
    call = client.post(f"{url}/test-call", headers=bearer(a.users["owner"]))
    conforms(call.json(), ASSISTANT, "TestCallOut")
    assert call.json()["mode"] == "fake"


def test_the_school_rule_a_schools_assistant_never_talks_about_dues_fees_or_marks(client: Any, eval_world: Any, scene: Any) -> None:
    w = eval_world.b
    url = f"/v1/tenants/{w.id}/ai-assistant"
    operator_sql.sql(
        f"insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select '{w.id}', 'education', max(version), 'operator' from packs.pack_versions where code = 'education' "
        "on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version"
    )
    try:
        got = client.get(url, headers=bearer(w.users["owner"])).json()
        conforms(got, ASSISTANT, "AssistantOut")
        assert got["business_type"] == "education" and got["locked"] == {"may_talk_dues": False, "may_answer_prices": False, "max_discount_percent": 0, "handover_order_above_paise": None}
        assert got["settings"]["name"] == "" and got["saved"] is False, "no name is made up: the Owner names the assistant before saving"
        base = {**got["settings"], "name": "Meena"}
        for over in ({"may_talk_dues": True}, {"may_answer_prices": True}, {"max_discount_percent": 3}, {"handover_order_above_paise": 500}):
            r = client.put(url, json={**base, **over}, headers=bearer(w.users["owner"]))
            assert r.status_code == 422 and r.json()["error"]["code"] == "locked_for_business_type", over
        assert client.put(url, json=base, headers=bearer(w.users["owner"])).status_code == 200
        # an outcome in a school never keeps a reason (no child can slip in through a sentence)
        contact = operator_sql.sql(f"select id from public.contacts where tenant_id = '{w.id}' and erased_at is null order by created_at limit 1").strip()
        r = client.post(o(w), json={"contact_id": contact, "kind": "call", "source_id": str(uuid.uuid4()), "outcome": "positive", "category": "visit_booked", "reason": "Mother of a Class 5 pupil asked about a visit", "occurred_at": datetime.now(UTC).isoformat()}, headers=bearer(w.users["owner"]))
        assert r.status_code == 201 and r.json()["reason"] is None, r.text
    finally:
        operator_sql.sql(f"delete from packs.workspace_pack where tenant_id = '{w.id}' and source = 'operator'")
