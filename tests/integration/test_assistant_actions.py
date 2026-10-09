"""Job AG / G2: the assistant's ACTION tools leave drafts and nothing else, through the real application. A draft quote is priced by the quote engine from the owner's own
price list and the confirmed requirement (the model gives no price); a follow-up is a draft; a customer-reply draft is machine text in the customer's language with an English
gloss and no price; a recorded enquiry is cleaned of contact details like any pasted enquiry. Nothing is approved, sent or decided. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from assistant_eval import Scripted, final, respond
from assistant_support import assistant_app, drafts_of, enable_assistant, events, restore
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient
from test_today_api import Scene

from app.agents.llm.interface import ToolCall

HOLDER: dict[str, Any] = {"model": None}


@pytest.fixture(scope="module")
def app(stack: Any) -> Iterator[TestClient]:
    yield from assistant_app(stack, factory=lambda: HOLDER["model"])


@pytest.fixture(scope="module")
def scene(eval_world: World, client: TestClient) -> Iterator[Scene]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield Scene(eval_world, client)
    finally:
        restore(saved)


def run(app: TestClient, scene: Scene, calls: list[ToolCall], reply: str = "Done: drafted. Nothing was sent.", lang: str = "en") -> list[tuple[str, dict[str, Any]]]:
    HOLDER["model"] = Scripted([lambda r: respond(*calls), lambda r: final("answer", reply, lang, ["s1"])])
    r = app.post(
        f"/v1/tenants/{scene.a.id}/assistant/messages",
        json={"message_id": str(uuid.uuid4()), "text": "please draft it"},
        headers=bearer(scene.a.users["owner"]),
    )
    assert r.status_code == 200, r.text
    return events(r)


def test_a_draft_quote_is_priced_by_the_engine_from_the_owners_price_list_and_is_only_a_draft(app: TestClient, scene: Scene) -> None:
    qw = scene.ow.qw
    enquiry, requirement = qw.requirement([("kanjivaram", 12)])
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    evts = run(app, scene, [ToolCall("draft_quote", {"enquiry_id": enquiry, "customer_kind": "new", "delivery_state": "TG"})])
    cards = drafts_of(evts)
    assert [c["kind"] for c in cards] == ["quote"] and cards[0]["status"] == "draft" and cards[0]["target"]["type"] == "quote" and cards[0]["title"] and cards[0]["summary"]
    quote = cards[0]["id"]
    row = operator_sql.sql(f"select status || '|' || coalesce(approved_by::text, '-') || '|' || engine_version || '|' || total_paise from public.quotes where id = '{quote}'").split("|")
    assert row[0] == "draft" and row[1] == "-" and row[2] == "1.1.0" and int(row[3]) > 0
    line = operator_sql.sql(f"select unit_price_applied_paise || '|' || qty from public.quote_lines where quote_id = '{quote}' and line_no = 1").split("|")
    assert line == ["400000", "12"], "the line price is the owner's price list entry (400000 paise), not a number the model gave"
    # the model supplying a price at all is a refused call: nothing was made
    before = operator_sql.sql(f"select count(*) from public.quotes where tenant_id = '{scene.a.id}'")
    evts = run(app, scene, [ToolCall("draft_quote", {"enquiry_id": enquiry, "customer_kind": "new", "delivery_state": "TG", "unit_price_paise": 1})], reply="Could not.", lang="en")
    assert operator_sql.sql(f"select count(*) from public.quotes where tenant_id = '{scene.a.id}'") == before


def test_a_draft_quote_without_a_confirmed_requirement_is_refused_not_guessed(app: TestClient, scene: Scene) -> None:
    lead = scene.a.rows["leads"]["id"]
    enquiry = str(uuid.uuid4())
    r = scene.fa.client.post(
        f"/v1/tenants/{scene.a.id}/leads/{lead}/enquiries",
        json={"id": enquiry, "channel": "other", "received_at": "2026-10-01T09:00:00Z", "text": "Need sarees, no details yet"},
        headers=bearer(scene.a.users["owner"]),
    )
    assert r.status_code in (200, 201), r.text
    before = operator_sql.sql(f"select count(*) from public.quotes where tenant_id = '{scene.a.id}'")
    evts = run(app, scene, [ToolCall("draft_quote", {"enquiry_id": enquiry, "customer_kind": "new", "delivery_state": "TG"}), ToolCall("get_today", {})])
    assert drafts_of(evts) == []
    assert operator_sql.sql(f"select count(*) from public.quotes where tenant_id = '{scene.a.id}'") == before


def test_a_followup_draft_is_a_draft_and_a_retry_makes_the_same_one(app: TestClient, scene: Scene) -> None:
    lead = scene.fa.due_lead("assistant-followup")
    evts = run(app, scene, [ToolCall("draft_followup", {"lead_id": lead.id, "channel": "email"})])
    cards = drafts_of(evts)
    assert [c["kind"] for c in cards] == ["followup_draft"] and cards[0]["target"] == {"type": "lead", "id": lead.id}
    assert operator_sql.sql(f"select status from public.followup_drafts where id = '{cards[0]['id']}'") == "draft"
    assert operator_sql.sql(f"select count(*) from public.lead_touches where lead_id = '{lead.id}' and direction = 'out'") == "1", "no touch was recorded as sent"
    # a lead that is not due is refused plainly
    evts = run(app, scene, [ToolCall("draft_followup", {"lead_id": lead.id, "channel": "email"}), ToolCall("get_today", {})])
    assert drafts_of(evts) == []


def test_a_customer_reply_draft_is_machine_text_in_the_customers_language_with_an_english_gloss(app: TestClient, scene: Scene) -> None:
    lead = scene.a.rows["leads"]["id"]
    text = "నమస్కారం, మీ విచారణకు ధన్యవాదాలు. మేము రేపు మీకు వివరాలు పంపుతాము."
    gloss = "Hello, thank you for your enquiry. We will send you the details tomorrow."
    evts = run(app, scene, [ToolCall("draft_reply", {"lead_id": lead, "language": "te", "text": text, "gloss_en": gloss})])
    card = drafts_of(evts)[0]
    assert card["kind"] == "reply_draft" and card["machine_draft"] is True and card["language"] == "te" and card["summary"] == text and card["gloss_en"] == gloss
    row = operator_sql.sql(f"select machine_draft || '|' || status || '|' || language from public.assistant_reply_drafts where id = '{card['id']}'")
    assert row == "true|draft|te"
    # the text must really be in the stated language, and carry no price
    for bad in (
        {"lead_id": lead, "language": "te", "text": "Thank you for your enquiry.", "gloss_en": "Thank you for your enquiry."},
        {"lead_id": lead, "language": "en", "text": "The price is ₹500 per piece.", "gloss_en": "The price is 500 per piece."},
        {"lead_id": lead, "language": "en", "text": "Price: 500/-", "gloss_en": "Price"},
        {"lead_id": lead, "language": "te", "text": "ధర రూ. 500 ఒక్కొక్కటి", "gloss_en": "The price is five hundred"},
    ):
        before = operator_sql.sql(f"select count(*) from public.assistant_reply_drafts where tenant_id = '{scene.a.id}'")
        run(app, scene, [ToolCall("draft_reply", bad), ToolCall("get_today", {})])
        assert operator_sql.sql(f"select count(*) from public.assistant_reply_drafts where tenant_id = '{scene.a.id}'") == before, bad
    # not another business's lead
    other = scene.b.rows["leads"]["id"]
    before = operator_sql.sql("select count(*) from public.assistant_reply_drafts")
    run(app, scene, [ToolCall("draft_reply", {"lead_id": other, "language": "en", "text": "Hello and thank you", "gloss_en": "Hello and thank you"}), ToolCall("get_today", {})])
    assert operator_sql.sql("select count(*) from public.assistant_reply_drafts") == before


def test_a_recorded_enquiry_is_cleaned_of_contact_details_like_any_pasted_enquiry(app: TestClient, scene: Scene) -> None:
    lead = scene.a.rows["leads"]["id"]
    pasted = "Please call me on +91 98765 43210 or write to buyer@example.test about forty silk sarees for Diwali."
    evts = run(app, scene, [ToolCall("record_enquiry", {"lead_id": lead, "channel": "whatsapp", "text": pasted})])
    card = drafts_of(evts)[0]
    assert card["kind"] == "enquiry" and card["target"]["type"] == "enquiry"
    body = operator_sql.sql(f"select body from public.enquiries where id = '{card['id']}'")
    assert "98765" not in body and "buyer@example.test" not in body and "silk sarees" in body
    # not another business's lead
    before = operator_sql.sql("select count(*) from public.enquiries")
    run(app, scene, [ToolCall("record_enquiry", {"lead_id": scene.b.rows["leads"]["id"], "channel": "other", "text": "x"}), ToolCall("get_today", {})])
    assert operator_sql.sql("select count(*) from public.enquiries") == before


def test_the_run_never_exceeds_its_action_budget(app: TestClient, scene: Scene) -> None:
    lead = scene.a.rows["leads"]["id"]
    calls = [ToolCall("record_enquiry", {"lead_id": lead, "channel": "other", "text": f"enquiry number {i} about sarees"}) for i in range(5)]
    before = int(operator_sql.sql(f"select count(*) from public.enquiries where tenant_id = '{scene.a.id}'"))
    run(app, scene, calls[:5] + [ToolCall("get_today", {})])
    made = int(operator_sql.sql(f"select count(*) from public.enquiries where tenant_id = '{scene.a.id}'")) - before
    assert made <= 4, "at most four actions in one message"
